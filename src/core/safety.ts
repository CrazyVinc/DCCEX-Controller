import EventEmitter from 'node:events';
import type { SafetyLevel, SafetyState } from '../../shared/src/events/live.ts';

export interface SafetyEvents {
  changed: [SafetyState];
}

/**
 * Global safety level with the reasons behind it.
 * NORMAL: everything matches. DEGRADED: uncertainty → speeds are capped.
 * EMERGENCY: unexpected state → all trains stop until an operator resets.
 */
export class SafetyMonitor extends EventEmitter<SafetyEvents> {
  private reasons = new Map<string, SafetyLevel>();
  private latched = false;

  get state(): SafetyState {
    return { level: this.level, reasons: [...this.reasons.keys()], updatedAt: Date.now() };
  }

  get level(): SafetyLevel {
    if (this.latched) return 'EMERGENCY';
    let level: SafetyLevel = 'NORMAL';
    for (const l of this.reasons.values()) {
      if (l === 'EMERGENCY') return 'EMERGENCY';
      if (l === 'DEGRADED') level = 'DEGRADED';
    }
    return level;
  }

  raise(reason: string, level: Exclude<SafetyLevel, 'NORMAL'>): void {
    const before = this.level;
    this.reasons.set(reason, level);
    if (level === 'EMERGENCY') this.latched = true;
    if (before !== this.level || level === 'EMERGENCY') this.emit('changed', this.state);
  }

  clear(reason: string): void {
    const before = this.level;
    if (this.reasons.delete(reason) && before !== this.level) this.emit('changed', this.state);
  }

  /** Operator acknowledged the emergency; DEGRADED reasons stay until they resolve. */
  reset(): void {
    this.latched = false;
    for (const [reason, level] of this.reasons) {
      if (level === 'EMERGENCY') this.reasons.delete(reason);
    }
    this.emit('changed', this.state);
  }
}
