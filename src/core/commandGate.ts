import type { SafetyMonitor } from './safety.ts';

export interface Approval {
  consistId: string;
  /** Highest speed step the validated plan allows. */
  maxSpeedStep: number;
  /** Wall-clock validity window. */
  validUntil: number;
}

export type GateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Last check before anything reaches the command station. Automatic movements must be
 * covered by an approval issued from a validated dry-run; manual driving is allowed
 * unless the consist is under automatic control or the layout is in EMERGENCY.
 */
export class CommandGate {
  private readonly approvals = new Map<string, Approval>();
  private readonly safety: SafetyMonitor;
  private readonly log: { at: number; command: string; verdict: GateVerdict }[] = [];

  constructor(safety: SafetyMonitor) {
    this.safety = safety;
  }

  approve(approval: Approval): void {
    this.approvals.set(approval.consistId, approval);
  }

  revoke(consistId: string): void {
    this.approvals.delete(consistId);
  }

  underAutomaticControl(consistId: string): boolean {
    const a = this.approvals.get(consistId);
    return !!a && a.validUntil > Date.now();
  }

  checkThrottle(consistId: string, speedStep: number, source: 'manual' | 'dispatcher'): GateVerdict {
    let verdict: GateVerdict = { ok: true };
    if (this.safety.level === 'EMERGENCY' && speedStep > 0) {
      verdict = { ok: false, reason: 'Layout is in EMERGENCY; reset first' };
    } else if (source === 'dispatcher') {
      const a = this.approvals.get(consistId);
      if (!a) verdict = { ok: false, reason: 'No validated plan for this train' };
      else if (a.validUntil < Date.now()) verdict = { ok: false, reason: 'Validated plan has expired' };
      else if (speedStep > a.maxSpeedStep) verdict = { ok: false, reason: `Speed step ${speedStep} exceeds the validated ${a.maxSpeedStep}` };
    } else if (this.underAutomaticControl(consistId) && speedStep > 0) {
      verdict = { ok: false, reason: 'Train is under automatic control' };
    }
    this.record(`throttle ${consistId} ${speedStep}`, verdict);
    return verdict;
  }

  checkTurnout(pieceId: string, lockedByOther: boolean): GateVerdict {
    const verdict: GateVerdict = lockedByOther ? { ok: false, reason: 'Turnout is locked by a claimed route' } : { ok: true };
    this.record(`turnout ${pieceId}`, verdict);
    return verdict;
  }

  recent(): { at: number; command: string; verdict: GateVerdict }[] {
    return this.log.slice(-50);
  }

  private record(command: string, verdict: GateVerdict): void {
    this.log.push({ at: Date.now(), command, verdict });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    if (!verdict.ok) console.warn(`[gate] refused ${command}: ${verdict.reason}`);
  }
}
