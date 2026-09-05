import EventEmitter from 'node:events';
import type { Claim } from '../../shared/src/events/live.ts';

export interface ClaimRequest {
  consistId: string;
  pieceIds: string[];
  turnoutStates: { pieceId: string; state: string }[];
}

export type ClaimResult = { ok: true } | { ok: false; conflicts: { pieceId: string; heldBy: string }[] };

export interface InterlockingEvents {
  changed: [Claim[]];
}

interface Held {
  pieces: Set<string>;
  turnouts: Map<string, string>;
}

/**
 * Path claiming and turnout locking. A piece (and therefore a turnout) can be claimed by
 * at most one consist at a time; claims are released piece by piece as the train's rear
 * clears them. A turnout stays locked in its required state as long as it is claimed.
 */
export class Interlocking extends EventEmitter<InterlockingEvents> {
  private readonly held = new Map<string, Held>();
  /** Consists waiting for pieces held by others (for deadlock detection). */
  private readonly waitingFor = new Map<string, Set<string>>();

  holderOf(pieceId: string): string | null {
    for (const [consistId, h] of this.held) {
      if (h.pieces.has(pieceId)) return consistId;
    }
    return null;
  }

  claimsOf(consistId: string): Held | undefined {
    return this.held.get(consistId);
  }

  snapshot(): Claim[] {
    return [...this.held.entries()].map(([consistId, h]) => ({ consistId, pieceIds: [...h.pieces], turnoutIds: [...h.turnouts.keys()] }));
  }

  /** Pieces held by anyone except `consistId`. */
  foreignPieces(consistId: string): Set<string> {
    const out = new Set<string>();
    for (const [id, h] of this.held) {
      if (id === consistId) continue;
      for (const p of h.pieces) out.add(p);
    }
    return out;
  }

  /** Atomically claim every piece and turnout of a path, or nothing. */
  tryClaim(request: ClaimRequest): ClaimResult {
    const conflicts: { pieceId: string; heldBy: string }[] = [];
    for (const pieceId of request.pieceIds) {
      const holder = this.holderOf(pieceId);
      if (holder && holder !== request.consistId) conflicts.push({ pieceId, heldBy: holder });
    }
    for (const t of request.turnoutStates) {
      const holder = this.holderOf(t.pieceId);
      if (holder && holder !== request.consistId && !conflicts.some((c) => c.pieceId === t.pieceId)) conflicts.push({ pieceId: t.pieceId, heldBy: holder });
    }
    if (conflicts.length) {
      this.waitingFor.set(request.consistId, new Set(conflicts.map((c) => c.heldBy)));
      return { ok: false, conflicts };
    }
    this.waitingFor.delete(request.consistId);
    const held = this.held.get(request.consistId) ?? { pieces: new Set<string>(), turnouts: new Map<string, string>() };
    for (const pieceId of request.pieceIds) held.pieces.add(pieceId);
    for (const t of request.turnoutStates) held.turnouts.set(t.pieceId, t.state);
    this.held.set(request.consistId, held);
    this.emit('changed', this.snapshot());
    return { ok: true };
  }

  /** Change the locked position of a turnout the consist already holds (reversing over it). */
  setTurnoutState(consistId: string, pieceId: string, state: string): boolean {
    const held = this.held.get(consistId);
    if (!held || !held.pieces.has(pieceId)) return false;
    held.turnouts.set(pieceId, state);
    this.emit('changed', this.snapshot());
    return true;
  }

  /** Release pieces the train has fully cleared. */
  release(consistId: string, pieceIds: Iterable<string>): void {
    const held = this.held.get(consistId);
    if (!held) return;
    let changed = false;
    for (const id of pieceIds) {
      if (held.pieces.delete(id)) changed = true;
      if (held.turnouts.delete(id)) changed = true;
    }
    if (!held.pieces.size && !held.turnouts.size) this.held.delete(consistId);
    if (changed) this.emit('changed', this.snapshot());
  }

  releaseAll(consistId: string): void {
    if (this.held.delete(consistId)) this.emit('changed', this.snapshot());
    this.waitingFor.delete(consistId);
  }

  /** A turnout may only be thrown by (or for) the consist holding it. */
  canThrow(pieceId: string, byConsistId?: string): boolean {
    const holder = this.holderOf(pieceId);
    return holder === null || holder === byConsistId;
  }

  /** Required (locked) state of a turnout, if claimed. */
  lockedState(pieceId: string): string | undefined {
    for (const h of this.held.values()) {
      const s = h.turnouts.get(pieceId);
      if (s) return s;
    }
    return undefined;
  }

  /**
   * Deadlock detection on the wait-for graph: returns cycles of consists that each wait
   * for a piece held by the next one.
   */
  detectDeadlocks(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    for (const start of this.waitingFor.keys()) {
      if (visited.has(start)) continue;
      const path: string[] = [];
      let cur: string | undefined = start;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        path.push(cur);
        const next: Set<string> | undefined = this.waitingFor.get(cur);
        cur = next ? [...next][0] : undefined;
      }
      if (cur && path.includes(cur)) {
        cycles.push(path.slice(path.indexOf(cur)));
      }
      for (const p of path) visited.add(p);
    }
    return cycles;
  }
}
