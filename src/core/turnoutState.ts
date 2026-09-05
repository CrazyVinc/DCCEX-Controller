import EventEmitter from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { LayoutIndex } from '../../shared/src/layout/index.ts';

export interface TurnoutStateEvents {
  changed: [{ pieceId: string; state: string; automationId?: string }];
}

/** Shape of `data/automation/turnouts.json`. */
const PersistedTurnoutsSchema = z.object({
  version: z.literal(1),
  states: z.record(z.string(), z.string()),
});

/**
 * Current position of every turnout as known by the server. Defaults to each piece's
 * catalogue default state until a command is sent or feedback arrives from DCC-EX.
 * Positions survive a restart (a turnout under a standing train must not silently
 * fall back to its default), written atomically like the train poses.
 */
export class TurnoutStateStore extends EventEmitter<TurnoutStateEvents> {
  private states = new Map<string, string>();
  private readonly getIndex: () => LayoutIndex;
  /** Where the positions are persisted; omitted = in memory only (tests). */
  private readonly file: string | null;
  private persistTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(getIndex: () => LayoutIndex, persistence?: { file: string }) {
    super();
    this.getIndex = getIndex;
    this.file = persistence?.file ?? null;
  }

  /** Restore the last known positions; unknown pieces or states are dropped. */
  async load(): Promise<void> {
    if (!this.file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.file, 'utf-8'));
    } catch {
      return;
    }
    const parsed = PersistedTurnoutsSchema.safeParse(raw);
    if (!parsed.success) return;
    const index = this.getIndex();
    for (const [pieceId, state] of Object.entries(parsed.data.states)) {
      if (index.pieces.get(pieceId)?.geom.states?.some((s) => s.id === state)) this.states.set(pieceId, state);
    }
  }

  get(pieceId: string): string | undefined {
    const known = this.states.get(pieceId);
    if (known) return known;
    return this.getIndex().pieces.get(pieceId)?.geom.defaultState;
  }

  /** Resolver in the shape the traversal helpers expect. */
  readonly resolver = (pieceId: string): string | undefined => this.get(pieceId);

  /** All turnouts in the layout with their current state. */
  snapshot(): { pieceId: string; state: string; automationId?: string; states: { id: string; label: string }[] }[] {
    const out: { pieceId: string; state: string; automationId?: string; states: { id: string; label: string }[] }[] = [];
    for (const view of this.getIndex().pieces.values()) {
      if (!view.geom.states) continue;
      out.push({
        pieceId: view.piece.id,
        state: this.get(view.piece.id) ?? view.geom.states[0]!.id,
        automationId: view.piece.automationId,
        states: view.geom.states.map((s) => ({ id: s.id, label: s.label })),
      });
    }
    return out;
  }

  /** Set a turnout position (validated against the piece's available states). */
  set(pieceId: string, state: string): boolean {
    const view = this.getIndex().pieces.get(pieceId);
    if (!view?.geom.states?.some((s) => s.id === state)) return false;
    if (this.states.get(pieceId) === state) return true;
    this.states.set(pieceId, state);
    this.emit('changed', { pieceId, state, automationId: view.piece.automationId });
    this.schedulePersist();
    return true;
  }

  /** Find the turnout piece that carries a DCC-EX id. */
  pieceForAutomationId(automationId: string): string | undefined {
    for (const view of this.getIndex().pieces.values()) {
      if (view.geom.states && view.piece.automationId === automationId) return view.piece.id;
    }
    return undefined;
  }

  /** Write the positions right now (shutdown). */
  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.persist();
  }

  private schedulePersist(): void {
    if (!this.file || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 250);
  }

  private persist(): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    const json = JSON.stringify({ version: 1, states: Object.fromEntries(this.states) }, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, json, 'utf-8');
      await rename(tmp, file);
    });
    return this.writeChain;
  }
}
