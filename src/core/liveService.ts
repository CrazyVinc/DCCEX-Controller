import EventEmitter from 'node:events';
import { locoDirectionBit } from '../../shared/src/domain/pose.ts';
import { speedForStep, stepForSpeed, type SpeedCalibration } from '../../shared/src/domain/speedModel.ts';
import type { Consist, TrainPose } from '../../shared/src/domain/train.ts';
import { blockWorldSegments } from '../../shared/src/layout/blockGeometry.ts';
import type { ConsistStore } from '../services/consistStore.ts';
import type { LayoutStore } from '../services/layoutStore.ts';
import type { RollingStockService } from '../services/rollingStock.ts';
import { CommandGate } from './commandGate.ts';
import type { DccEngine } from './dccEngine.ts';
import type { Interlocking } from './interlocking.ts';
import { Reconciliation } from './reconciliation.ts';
import { SafetyMonitor } from './safety.ts';
import type { SensorBus } from './sensorBus.ts';
import { Simulation } from './simulation.ts';
import type { TrainStateManager } from './trainState.ts';
import type { TurnoutStateStore } from './turnoutState.ts';

export interface LiveServiceEvents {
  /** Simulation mode toggled (no DCC-EX connection = trains move virtually). */
  mode: [{ simulationMode: boolean }];
  /** Track power changed on the command station (every train is halted on power off). */
  power: [{ power: boolean }];
  /** The operator took a train under automatic control over by hand: its job must be dropped. */
  manualOverride: [{ consistId: string }];
}

interface Deps {
  layoutStore: LayoutStore;
  consistStore: ConsistStore;
  rollingStock: RollingStockService;
  trainState: TrainStateManager;
  turnouts: TurnoutStateStore;
  sensors: SensorBus;
  dccEngine: DccEngine;
  interlocking: Interlocking;
}

/** Speed cap applied to every train while the layout is DEGRADED (fraction of the commanded step). */
const DEGRADED_SPEED_FACTOR = 0.4;
/** Minimum spacing between throttle commands that mirror the simulated speed curve to the hardware. */
const MIRROR_INTERVAL_MS = 150;

/**
 * Ties the pieces together: the simulation integrates motion for every placed consist,
 * the train state manager stores/broadcasts poses, virtual sensors mirror occupancy when
 * no command station is connected, hardware sensors are reconciled against the estimate,
 * and every outgoing command passes the command gate.
 */
export class LiveService extends EventEmitter<LiveServiceEvents> {
  readonly simulation: Simulation;
  readonly safety = new SafetyMonitor();
  readonly gate: CommandGate;
  readonly reconciliation: Reconciliation;
  private readonly deps: Deps;
  private sensorTimer: NodeJS.Timeout | null = null;
  /** Consists whose hardware speed follows the simulation (automatic runs). */
  private readonly mirrored = new Set<string>();
  private readonly lastMirror = new Map<string, { step: number; at: number }>();
  /** > 0 while this service is sending throttle commands itself (their echo is not a manual command). */
  private ownThrottleDepth = 0;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
    this.gate = new CommandGate(this.safety);
    this.simulation = new Simulation({
      getIndex: () => deps.layoutStore.getIndex(),
      turnoutStates: deps.turnouts.resolver,
      getConsist: (id) => deps.consistStore.get(id),
      getLength: (id) => {
        const c = deps.consistStore.get(id);
        return c ? deps.consistStore.totalLengthMm(c) : 0;
      },
      getCalibration: (id) => this.calibrationFor(id),
    });
    this.reconciliation = new Reconciliation({
      getIndex: () => deps.layoutStore.getIndex(),
      trainState: deps.trainState,
      sensors: deps.sensors,
      interlocking: deps.interlocking,
      safety: this.safety,
      turnouts: deps.turnouts,
      emergencyStop: () => this.emergencyStop(),
    });
  }

  get simulationMode(): boolean {
    return !this.deps.dccEngine.dccClient.connected;
  }

  start(): void {
    const { trainState, dccEngine, turnouts, sensors } = this.deps;

    for (const live of trainState.list()) {
      if (live.pose) this.simulation.track(live.consistId, live.pose, live.state);
    }
    trainState.on('train', (live) => {
      if (!live.pose) return;
      const sim = this.simulation.trains.get(live.consistId);
      if (!sim || sim.pose !== live.pose) {
        const t = this.simulation.track(live.consistId, live.pose, live.state);
        if (sim && live.pose.movement === 'stopped' && live.pose.speedMmS === 0) t.targetMmS = 0;
      }
    });
    trainState.on('removed', (consistId) => this.simulation.untrack(consistId));

    this.simulation.on('moved', ({ consistId, pose, state }) => {
      trainState.updateFromSimulation(consistId, pose, state);
      this.mirrorToHardware(consistId, pose);
    });
    this.simulation.on('blocked', ({ consistId, reason }) => {
      this.safety.raise(`train ${consistId} ran into ${reason}`, 'EMERGENCY');
      this.emergencyStop();
    });
    this.simulation.on('collision', ({ consistIds }) => {
      this.safety.raise(`collision between ${consistIds[0]} and ${consistIds[1]}`, 'EMERGENCY');
      this.emergencyStop();
    });

    // Hardware feeds.
    dccEngine.dccClient.on('sensor', ({ id, active }) => sensors.set(id, active, 'hardware'));
    dccEngine.dccClient.on('turnout', ({ id, thrown }) => {
      const pieceId = turnouts.pieceForAutomationId(String(id));
      if (!pieceId) return;
      const view = this.deps.layoutStore.getIndex().pieces.get(pieceId);
      const states = view?.geom.states;
      if (!states) return;
      const state = thrown ? (states.find((s) => s.id !== view!.geom.defaultState)?.id ?? states[0]!.id) : (view!.geom.defaultState ?? states[0]!.id);
      turnouts.set(pieceId, state);
      this.reconciliation.onTurnoutFeedback(pieceId, state);
    });
    // Turnout commands go out whenever the server-side state changes (from any source).
    turnouts.on('changed', ({ pieceId, state, automationId }) => {
      if (this.simulationMode || !automationId) return;
      const view = this.deps.layoutStore.getIndex().pieces.get(pieceId);
      const isDefault = state === view?.geom.defaultState;
      const id = Number(automationId);
      if (!Number.isInteger(id)) return;
      if (isDefault) dccEngine.dccClient.turnoutClose(id);
      else dccEngine.dccClient.turnoutThrow(id);
    });
    this.reconciliation.start();

    let wasConnected = false;
    dccEngine.on('connect', () => {
      wasConnected = true;
      this.safety.clear('DCC-EX connection lost');
      this.emit('mode', { simulationMode: false });
      // Give the command station a moment to answer <S>/<T>, then reconcile restored poses.
      setTimeout(() => void this.reconciliation.recover(), 1500);
    });
    dccEngine.on('disconnect', () => {
      // Losing an established connection is a safety concern; never having had one is plain simulation mode.
      if (wasConnected) this.safety.raise('DCC-EX connection lost', 'DEGRADED');
      this.emit('mode', { simulationMode: true });
    });

    // Cab throttle (Home page / hardware handset) drives the consist that contains the loco.
    dccEngine.on('throttle', ({ cab, speed, dir }) => this.onCabThrottle(String(cab), speed, dir));
    dccEngine.on('power', ({ power }) => this.onTrackPower(power));

    this.safety.on('changed', (state) => {
      for (const t of this.simulation.trains.values()) {
        const step = this.commandedStep(t.consistId);
        const cal = this.calibrationFor(t.consistId);
        t.externalLimitMmS = state.level === 'DEGRADED' ? speedForStep(cal, Math.max(6, Math.round(step * DEGRADED_SPEED_FACTOR))) : Infinity;
      }
    });

    this.simulation.start();
    this.sensorTimer = setInterval(() => this.updateVirtualSensors(), 100);
  }

  stop(): void {
    this.simulation.stopClock();
    if (this.sensorTimer) clearInterval(this.sensorTimer);
    this.sensorTimer = null;
  }

  /** Track power is known to be off on a connected command station. */
  get trackPowerOff(): boolean {
    return !this.simulationMode && this.deps.dccEngine.dccClient.getPower() === false;
  }

  /**
   * Power off: the real trains stand still, so the model stops too and the poses are saved at
   * once. Every loco gets speed 0 so the command station does not resume the old speeds when
   * power returns; on power on that is repeated so hardware and model agree (all stopped).
   */
  private onTrackPower(power: boolean): void {
    if (!power) this.simulation.haltAll();
    for (const live of this.deps.trainState.list()) {
      const consist = this.deps.consistStore.get(live.consistId);
      if (consist && live.pose) this.sendThrottles(consist, 'forward', 0);
    }
    this.emit('power', { power });
    if (!power) void this.deps.trainState.flush({ cleanShutdown: false, trackPower: false });
  }

  /**
   * Orderly shutdown: halt every train in the model, put the layout to rest (speed 0 for all
   * locos, track power off) and write the poses with a "clean" marker so they are restored
   * as trustworthy on the next start.
   */
  async shutdown(): Promise<void> {
    this.stop();
    this.simulation.haltAll();
    const connected = !this.simulationMode;
    if (connected) {
      for (const live of this.deps.trainState.list()) {
        const consist = this.deps.consistStore.get(live.consistId);
        if (consist && live.pose) this.sendThrottles(consist, 'forward', 0);
      }
      this.deps.dccEngine.powerOff();
      await this.deps.dccEngine.dccClient.drain();
    }
    await this.deps.trainState.flush({ cleanShutdown: true, trackPower: connected ? false : null });
    await this.deps.turnouts.flush();
  }

  /**
   * Drive a consist: movement direction + DCC speed step (0…126). A manual command always
   * wins: a train under automatic control is handed over (its job is dropped) as soon as the
   * command differs from what the automation asked for.
   */
  drive(consistId: string, movement: 'forward' | 'reverse', speedStep: number, source: 'manual' | 'dispatcher' = 'manual'): { ok: true } | { ok: false; reason: string } {
    const consist = this.deps.consistStore.get(consistId);
    const live = this.deps.trainState.get(consistId);
    if (!consist || !live?.pose) return { ok: false, reason: 'Train has no position yet' };
    if (this.trackPowerOff && speedStep > 0) return { ok: false, reason: 'Track power is off' };
    if (source === 'manual' && this.gate.underAutomaticControl(consistId) && !this.takeOver(consistId, movement, speedStep)) {
      return { ok: true }; // same command as the automation: nothing to change
    }
    const verdict = this.gate.checkThrottle(consistId, speedStep, source);
    if (!verdict.ok) return verdict;
    const cal = this.calibrationFor(consistId);
    const target = speedForStep(cal, speedStep);
    if (!this.simulation.trains.has(consistId)) this.simulation.track(consistId, live.pose, live.state);
    this.simulation.drive(consistId, movement, target);
    if (source === 'dispatcher') {
      // The simulation is the authority for automatic runs: the hardware follows its speed curve.
      this.mirrored.add(consistId);
      this.lastMirror.delete(consistId);
    } else {
      this.mirrored.delete(consistId);
      this.sendThrottles(consist, movement, speedStep);
    }
    return { ok: true };
  }

  stopTrain(consistId: string, source: 'manual' | 'dispatcher' = 'manual'): void {
    if (source === 'manual' && this.gate.underAutomaticControl(consistId)) this.takeOver(consistId, null, 0);
    this.simulation.stop(consistId);
    if (this.mirrored.has(consistId)) return; // the mirror brakes the hardware along the simulated curve
    const consist = this.deps.consistStore.get(consistId);
    if (consist) this.sendThrottles(consist, 'forward', 0);
  }

  emergencyStop(consistId?: string): void {
    if (consistId && this.gate.underAutomaticControl(consistId)) this.takeOver(consistId, null, 0);
    this.simulation.emergencyStop(consistId);
    if (!consistId) {
      if (!this.simulationMode) this.deps.dccEngine.emergencyStop();
      return;
    }
    this.mirrored.delete(consistId);
    const consist = this.deps.consistStore.get(consistId);
    if (consist) this.sendThrottles(consist, 'forward', 0);
  }

  /**
   * Hand a train under automatic control over to the operator when the manual command really
   * changes something (speed step or direction). Returns false when the command equals what
   * the automation is driving, so a redundant throttle touch does not cancel the run.
   */
  private takeOver(consistId: string, movement: 'forward' | 'reverse' | null, speedStep: number): boolean {
    const t = this.simulation.trains.get(consistId);
    const currentMovement = t?.pose.movement === 'reverse' ? 'reverse' : 'forward';
    if (speedStep === this.commandedStep(consistId) && (movement === null || movement === currentMovement)) return false;
    this.mirrored.delete(consistId);
    this.gate.revoke(consistId);
    this.emit('manualOverride', { consistId });
    return true;
  }

  /** Hardware follows the simulated speed of automatically driven trains (rate-limited, 0 always sent at once). */
  private mirrorToHardware(consistId: string, pose: TrainPose): void {
    if (!this.mirrored.has(consistId) || this.simulationMode) return;
    const consist = this.deps.consistStore.get(consistId);
    if (!consist) return;
    const step = stepForSpeed(this.calibrationFor(consistId), pose.speedMmS);
    const last = this.lastMirror.get(consistId);
    const now = this.simulation.simTimeMs; // runs at wall-clock speed in live mode
    if (last && last.step === step) return;
    if (step > 0 && last && now - last.at < MIRROR_INTERVAL_MS) return;
    this.sendThrottles(consist, pose.movement === 'reverse' ? 'reverse' : 'forward', step);
    this.lastMirror.set(consistId, { step, at: now });
  }

  resetEmergency(consistId: string): void {
    this.simulation.reset(consistId);
  }

  /** Operator acknowledged the emergency: safety back to NORMAL/DEGRADED, trains stay stopped. */
  resetSafety(): void {
    this.safety.reset();
    for (const t of this.simulation.trains.values()) this.simulation.reset(t.consistId);
  }

  /** Operator confirms that a restored/uncertain pose is correct. */
  async confirmPosition(consistId: string): Promise<boolean> {
    const live = this.deps.trainState.get(consistId);
    if (!live?.pose) return false;
    await this.deps.trainState.setConfidence(consistId, 1);
    const t = this.simulation.trains.get(consistId);
    if (t) t.actor.send({ type: 'CONFIRMED' });
    await this.deps.trainState.setPose(consistId, { ...live.pose, confidence: 1 }, 'stopped');
    const unconfirmed = this.deps.trainState.list().filter((x) => x.pose && x.pose.confidence < 0.8).length;
    if (!unconfirmed) {
      for (const reason of this.safety.state.reasons) {
        if (reason.includes('need position confirmation')) this.safety.clear(reason);
      }
    }
    return true;
  }

  /**
   * Cab throttle from the Home page or a hardware handset (the command already went to the
   * loco): the simulation follows it at once, and a train under automatic control is handed
   * over when the command differs from the automation's.
   */
  private onCabThrottle(cab: string, speed: number, dir: number): void {
    if (this.ownThrottleDepth > 0) return; // echo of a command this service sent itself
    // Without track power a handset cannot move anything; the speed 0 sent on power on keeps hardware and model aligned.
    if (this.trackPowerOff) return;
    for (const consist of this.deps.consistStore.list()) {
      const loco = consist.units.find((u) => u.kind === 'loco' && u.dccId === cab);
      if (!loco || loco.kind !== 'loco') continue;
      const live = this.deps.trainState.get(consist.id);
      if (!live?.pose) continue;
      const movement: 'forward' | 'reverse' = locoDirectionBit('forward', loco.orientation) === (dir === 0 ? 0 : 1) ? 'forward' : 'reverse';
      if (this.gate.underAutomaticControl(consist.id) && !this.takeOver(consist.id, movement, speed)) continue;
      this.mirrored.delete(consist.id);
      if (!this.simulation.trains.has(consist.id)) this.simulation.track(consist.id, live.pose, live.state);
      this.simulation.drive(consist.id, movement, speedForStep(this.calibrationFor(consist.id), speed));
      // Double traction: the other locos of the consist follow the hand-driven one.
      if (this.deps.consistStore.locos(consist).length > 1) this.sendThrottles(consist, movement, speed);
    }
  }

  /** Send the same speed to every loco of the consist with the direction bit per orientation. */
  private sendThrottles(consist: Consist, movement: 'forward' | 'reverse', speedStep: number): void {
    if (this.simulationMode) return;
    this.ownThrottleDepth++;
    try {
      for (const loco of this.deps.consistStore.locos(consist)) {
        this.deps.dccEngine.setThrottle({ cab: Number(loco.dccId), speed: speedStep, dir: locoDirectionBit(movement, loco.orientation) });
      }
    } finally {
      this.ownThrottleDepth--;
    }
  }

  calibrationFor(consistId: string): SpeedCalibration | undefined {
    const consist = this.deps.consistStore.get(consistId);
    const loco = consist?.units.find((u) => u.kind === 'loco');
    if (!loco || loco.kind !== 'loco') return undefined;
    return this.deps.rollingStock.getTrainById(loco.dccId)?.Speed;
  }

  /** Speed step currently commanded for a consist (for the UI). */
  commandedStep(consistId: string): number {
    const t = this.simulation.trains.get(consistId);
    return t ? stepForSpeed(this.calibrationFor(consistId), t.targetMmS) : 0;
  }

  /** In simulation mode the block sensors mirror the simulated occupancy. */
  private updateVirtualSensors(): void {
    if (!this.simulationMode) return;
    const index = this.deps.layoutStore.getIndex();
    const occupiedPieces = new Set<string>();
    for (const live of this.deps.trainState.list()) {
      for (const id of live.occupiedPieceIds) occupiedPieces.add(id);
    }
    const active = new Set<number>();
    const known: number[] = [];
    for (const block of index.doc.trackBlocks) {
      if (block.sensorId == null) continue;
      known.push(block.sensorId);
      if (blockWorldSegments(index, block).some((s) => occupiedPieces.has(s.pieceId))) active.add(block.sensorId);
    }
    this.deps.sensors.setActiveSet(active, known, 'virtual');
  }
}
