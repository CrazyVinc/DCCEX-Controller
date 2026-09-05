import EventEmitter from 'node:events';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { facingDegOf, occupiedPieces, poseFromFront, reverseMovement, type PlacementError } from '../../shared/src/domain/pose.ts';
import {
  TrainPoseSchema,
  type LiveTrain,
  type PositionCorrection,
  type TrainPose,
  type TrainStateId,
  type Traversal,
} from '../../shared/src/domain/train.ts';
import { blockWorldSegments } from '../../shared/src/layout/blockGeometry.ts';
import type { LayoutIndex } from '../../shared/src/layout/index.ts';
import type { TurnoutStates } from '../../shared/src/layout/traverse.ts';
import { CORRECTIONS_FILE, LIVE_STATE_FILE } from '../paths.ts';

export interface TrainStateEvents {
  train: [LiveTrain];
  removed: [string];
}

/** How the last save came about; decides how much the restored poses can be trusted. */
export interface PersistMeta {
  /** True when written by the orderly shutdown (all trains halted first). */
  cleanShutdown: boolean;
  /** Track power at the time of saving; null when no command station was connected. */
  trackPower: boolean | null;
}

/** Shape of `data/automation/state.json`. */
const PersistedStateSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().optional(),
  /** Missing (file written while running, process killed) counts as an unclean shutdown. */
  meta: z.object({ cleanShutdown: z.boolean(), trackPower: z.boolean().nullable() }).optional(),
  trains: z.record(
    z.string(),
    z.object({
      pose: TrainPoseSchema.nullable(),
      state: z.enum(['unknown', 'stopped', 'accelerating', 'running', 'braking', 'emergency']),
    }),
  ),
});

/** Confidence of poses restored after an orderly shutdown with the track power off: nothing could have moved. */
const RESTORED_CLEAN_CONFIDENCE = 0.8;
/** Confidence of poses restored after a crash/kill: the operator or sensors must confirm them. */
const RESTORED_UNCLEAN_CONFIDENCE = 0.4;

interface Entry {
  pose: TrainPose | null;
  state: TrainStateId;
  updatedAt: number;
}

/** Live poses are pushed to clients at most 10× per second per train. */
const BROADCAST_INTERVAL_MS = 100;

interface TrainStateDeps {
  getIndex: () => LayoutIndex;
  getLength: (consistId: string) => number;
  turnoutStates: TurnoutStates;
  /** Where poses and corrections are persisted; `false` keeps everything in memory (tests). */
  persistence?: { stateFile: string; correctionsFile: string } | false;
}

/**
 * Server-side source of truth for where every consist is. Poses are exact track
 * positions; occupancy is derived from them, never the other way around.
 */
export class TrainStateManager extends EventEmitter<TrainStateEvents> {
  private entries = new Map<string, Entry>();
  private persistTimer: NodeJS.Timeout | null = null;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** Set by the clean-shutdown flush: no further writes. */
  private sealed = false;
  private readonly pendingBroadcast = new Set<string>();
  private readonly deps: TrainStateDeps;

  constructor(deps: TrainStateDeps) {
    super();
    this.deps = deps;
  }

  private get files(): { stateFile: string; correctionsFile: string } | null {
    if (this.deps.persistence === false) return null;
    return this.deps.persistence ?? { stateFile: LIVE_STATE_FILE, correctionsFile: CORRECTIONS_FILE };
  }

  async load(): Promise<void> {
    const files = this.files;
    if (!files) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(files.stateFile, 'utf-8'));
    } catch {
      return;
    }
    const parsed = PersistedStateSchema.safeParse(raw);
    if (!parsed.success) return;
    // Trains were halted and the track power was off (or no command station existed) when the
    // file was written, so nothing moved since: keep the poses usable. Otherwise the operator or
    // the sensors have to confirm them first.
    const clean = parsed.data.meta?.cleanShutdown === true && parsed.data.meta.trackPower !== true;
    const cap = clean ? RESTORED_CLEAN_CONFIDENCE : RESTORED_UNCLEAN_CONFIDENCE;
    for (const [consistId, entry] of Object.entries(parsed.data.trains)) {
      const pose = entry.pose ? { ...entry.pose, movement: 'stopped' as const, speedMmS: 0, confidence: Math.min(entry.pose.confidence, cap) } : null;
      this.entries.set(consistId, { pose, state: pose && clean ? 'stopped' : 'unknown', updatedAt: Date.now() });
    }
  }

  /**
   * Write the current poses right now (cancels the pending debounced write). A clean-shutdown
   * flush is final: nothing may overwrite that record afterwards.
   */
  async flush(meta: PersistMeta = { cleanShutdown: false, trackPower: null }): Promise<void> {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
      for (const id of this.pendingBroadcast) {
        const live = this.live(id);
        if (live) this.emit('train', live);
      }
      this.pendingBroadcast.clear();
    }
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (meta.cleanShutdown) this.sealed = true;
    await this.persist(meta);
  }

  list(): LiveTrain[] {
    return [...this.entries.keys()].map((id) => this.live(id)!);
  }

  get(consistId: string): Entry | undefined {
    return this.entries.get(consistId);
  }

  live(consistId: string): LiveTrain | null {
    const entry = this.entries.get(consistId);
    if (!entry) return null;
    const index = this.deps.getIndex();
    const length = this.deps.getLength(consistId);
    let occupiedPieceIds: string[] = [];
    let facingDeg: number | null = null;
    if (entry.pose && index.pieces.has(entry.pose.front.pos.pieceId) && index.pieces.has(entry.pose.rear.pos.pieceId)) {
      occupiedPieceIds = occupiedPieces(index, entry.pose, length, this.deps.turnoutStates);
      facingDeg = facingDegOf(index, entry.pose);
    }
    return {
      consistId,
      pose: entry.pose,
      state: entry.state,
      occupiedPieceIds,
      occupiedBlockIds: this.blocksCovering(index, occupiedPieceIds),
      facingDeg,
      totalLengthMm: length,
      updatedAt: entry.updatedAt,
    };
  }

  /** Blocks that share at least one piece with the occupied pieces. */
  blocksCovering(index: LayoutIndex, pieceIds: string[]): string[] {
    const set = new Set(pieceIds);
    const out: string[] = [];
    for (const block of index.doc.trackBlocks) {
      const segments = blockWorldSegments(index, block);
      if (segments.some((s) => set.has(s.pieceId))) out.push(block.id);
    }
    return out;
  }

  /**
   * Place a consist with its front at `front`; the rear is derived from the length.
   * Returns a reason when the train does not fit.
   */
  async place(consistId: string, front: Traversal, reason: PositionCorrection['reason'] = 'manual-placement'): Promise<{ ok: true; train: LiveTrain } | { ok: false; error: PlacementError | 'overlap'; fits?: number }> {
    const index = this.deps.getIndex();
    const length = this.deps.getLength(consistId);
    const result = poseFromFront(index, front, length, this.deps.turnoutStates);
    if ('error' in result) return { ok: false, error: result.error, fits: result.fits };
    const overlap = this.overlaps(consistId, result.occupiedPieceIds);
    if (overlap) return { ok: false, error: 'overlap' };
    const old = this.entries.get(consistId)?.pose ?? null;
    await this.setPose(consistId, result.pose, 'stopped');
    await this.logCorrection({ consistId, oldPose: old, newPose: result.pose, reason, at: new Date().toISOString() });
    return { ok: true, train: this.live(consistId)! };
  }

  async remove(consistId: string): Promise<void> {
    const old = this.entries.get(consistId);
    if (!old) return;
    this.entries.delete(consistId);
    await this.logCorrection({ consistId, oldPose: old.pose, newPose: null, reason: 'removed', at: new Date().toISOString() });
    this.emit('removed', consistId);
    this.schedulePersist();
  }

  async setPose(consistId: string, pose: TrainPose, state: TrainStateId): Promise<void> {
    this.entries.set(consistId, { pose, state, updatedAt: Date.now() });
    this.emit('train', this.live(consistId)!);
    this.schedulePersist();
  }

  /**
   * High-frequency update from the simulation: stored immediately, broadcast at most
   * every `BROADCAST_INTERVAL_MS` per train so the WebSocket is not flooded.
   */
  updateFromSimulation(consistId: string, pose: TrainPose, state: TrainStateId): void {
    if (!this.entries.has(consistId)) return;
    this.entries.set(consistId, { pose, state, updatedAt: Date.now() });
    this.pendingBroadcast.add(consistId);
    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        for (const id of this.pendingBroadcast) {
          const live = this.live(id);
          if (live) this.emit('train', live);
        }
        this.pendingBroadcast.clear();
        this.schedulePersist();
      }, BROADCAST_INTERVAL_MS);
    }
  }

  async setMovement(consistId: string, movement: TrainPose['movement']): Promise<LiveTrain | null> {
    const entry = this.entries.get(consistId);
    if (!entry?.pose) return null;
    const pose: TrainPose = movement === 'stopped' ? { ...entry.pose, movement, speedMmS: 0 } : { ...entry.pose, movement };
    await this.setPose(consistId, pose, movement === 'stopped' ? 'stopped' : entry.state);
    return this.live(consistId);
  }

  async toggleMovement(consistId: string): Promise<LiveTrain | null> {
    const entry = this.entries.get(consistId);
    if (!entry?.pose) return null;
    const pose = entry.pose.movement === 'stopped' ? { ...entry.pose, movement: 'forward' as const } : reverseMovement(entry.pose);
    await this.setPose(consistId, pose, entry.state);
    return this.live(consistId);
  }

  async setConfidence(consistId: string, confidence: number): Promise<void> {
    const entry = this.entries.get(consistId);
    if (!entry?.pose) return;
    await this.setPose(consistId, { ...entry.pose, confidence }, entry.state);
  }

  /** Whether the given pieces are already occupied by another consist. */
  overlaps(consistId: string, pieceIds: string[]): string | null {
    const index = this.deps.getIndex();
    const mine = new Set(pieceIds);
    for (const [otherId, entry] of this.entries) {
      if (otherId === consistId || !entry.pose) continue;
      if (!index.pieces.has(entry.pose.front.pos.pieceId)) continue;
      const theirs = occupiedPieces(index, entry.pose, this.deps.getLength(otherId), this.deps.turnoutStates);
      if (theirs.some((id) => mine.has(id))) return otherId;
    }
    return null;
  }

  /** Called when the layout changed: poses referencing missing pieces are invalidated. */
  async onLayoutChanged(): Promise<void> {
    const index = this.deps.getIndex();
    for (const [id, entry] of this.entries) {
      if (!entry.pose) continue;
      if (!index.pieces.has(entry.pose.front.pos.pieceId) || !index.pieces.has(entry.pose.rear.pos.pieceId)) {
        await this.setPose(id, { ...entry.pose, confidence: 0 }, 'unknown');
      } else if (entry.pose.confidence > 0.4) {
        await this.setPose(id, { ...entry.pose, confidence: 0.4 }, entry.state);
      }
    }
  }

  private schedulePersist(): void {
    if (this.sealed || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 250);
  }

  /**
   * Writes are queued one after another and land atomically (temp file + rename), so a
   * kill halfway or two overlapping writes can never leave a corrupt state file.
   */
  private persist(meta: PersistMeta = { cleanShutdown: false, trackPower: null }): Promise<void> {
    const files = this.files;
    if (!files) return Promise.resolve();
    const trains: Record<string, { pose: TrainPose | null; state: TrainStateId }> = {};
    for (const [id, entry] of this.entries) trains[id] = { pose: entry.pose, state: entry.state };
    const json = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), meta, trains }, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(files.stateFile), { recursive: true });
      const tmp = `${files.stateFile}.tmp`;
      await writeFile(tmp, json, 'utf-8');
      await rename(tmp, files.stateFile);
    });
    return this.writeChain;
  }

  private async logCorrection(entry: PositionCorrection): Promise<void> {
    const files = this.files;
    if (!files) return;
    await mkdir(path.dirname(files.correctionsFile), { recursive: true });
    await appendFile(files.correctionsFile, `${JSON.stringify(entry)}\n`, 'utf-8');
  }
}
