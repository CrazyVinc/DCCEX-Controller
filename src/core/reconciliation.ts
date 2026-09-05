import { blockWorldSegments } from '../../shared/src/layout/blockGeometry.ts';
import type { LayoutIndex } from '../../shared/src/layout/index.ts';
import type { TrackBlock } from '../../shared/src/layout/schema.ts';
import type { Interlocking } from './interlocking.ts';
import type { SafetyMonitor } from './safety.ts';
import type { SensorBus } from './sensorBus.ts';
import type { TrainStateManager } from './trainState.ts';
import type { TurnoutStateStore } from './turnoutState.ts';

interface Deps {
  getIndex: () => LayoutIndex;
  trainState: TrainStateManager;
  sensors: SensorBus;
  interlocking: Interlocking;
  safety: SafetyMonitor;
  turnouts: TurnoutStateStore;
  /** Emergency stop every train (hardware + simulation). */
  emergencyStop: () => void;
}

/** Sensor readings lag the estimate by at most this much before the train counts as lost. */
const MISMATCH_GRACE_MS = 2500;

/**
 * Compares what the server expects (poses → block occupancy) with what the hardware
 * reports (block sensors, turnout feedback) and adjusts confidence and safety level.
 *
 * - Sensor goes active where exactly one train is expected/claimed → position confirmed.
 * - Sensor goes active where no train is expected → unknown object → EMERGENCY.
 * - Sensor goes inactive while a train is still estimated inside → DEGRADED after a grace period.
 * - Turnout feedback contradicting a locked state → EMERGENCY.
 */
export class Reconciliation {
  private readonly deps: Deps;
  private readonly pendingMismatch = new Map<number, NodeJS.Timeout>();

  constructor(deps: Deps) {
    this.deps = deps;
  }

  start(): void {
    this.deps.sensors.on('changed', (s) => {
      if (s.source !== 'hardware') return;
      void this.onSensor(s.sensorId, s.active);
    });
  }

  private blockForSensor(index: LayoutIndex, sensorId: number): TrackBlock | undefined {
    return index.doc.trackBlocks.find((b) => b.sensorId === sensorId);
  }

  private blockPieces(index: LayoutIndex, block: TrackBlock): Set<string> {
    return new Set(blockWorldSegments(index, block).map((s) => s.pieceId));
  }

  /** Trains that occupy or have claimed a piece of the block. */
  private trainsFor(index: LayoutIndex, block: TrackBlock): { occupying: string[]; claiming: string[] } {
    const pieces = this.blockPieces(index, block);
    const occupying: string[] = [];
    for (const live of this.deps.trainState.list()) {
      if (live.occupiedPieceIds.some((id) => pieces.has(id))) occupying.push(live.consistId);
    }
    const claiming: string[] = [];
    for (const claim of this.deps.interlocking.snapshot()) {
      if (!occupying.includes(claim.consistId) && claim.pieceIds.some((id) => pieces.has(id))) claiming.push(claim.consistId);
    }
    return { occupying, claiming };
  }

  async onSensor(sensorId: number, active: boolean): Promise<void> {
    const index = this.deps.getIndex();
    const block = this.blockForSensor(index, sensorId);
    if (!block) return;
    const reasonKey = `sensor ${sensorId} (block ${block.id})`;

    if (active) {
      const { occupying, claiming } = this.trainsFor(index, block);
      if (occupying.length === 1) {
        await this.deps.trainState.setConfidence(occupying[0]!, 1);
        this.deps.safety.clear(`${reasonKey}: no confirmation`);
        return;
      }
      if (occupying.length === 0 && claiming.length === 1) {
        // The train arrived slightly earlier than estimated: it is at the block entrance now.
        await this.deps.trainState.setConfidence(claiming[0]!, 0.9);
        return;
      }
      if (occupying.length === 0 && claiming.length === 0) {
        this.deps.safety.raise(`${reasonKey}: unexpected occupancy`, 'EMERGENCY');
        this.deps.emergencyStop();
        return;
      }
      this.deps.safety.raise(`${reasonKey}: ambiguous (${[...occupying, ...claiming].join(', ')})`, 'DEGRADED');
      return;
    }

    // Sensor released.
    const timer = this.pendingMismatch.get(sensorId);
    if (timer) clearTimeout(timer);
    this.pendingMismatch.set(
      sensorId,
      setTimeout(() => {
        this.pendingMismatch.delete(sensorId);
        const now = this.deps.getIndex();
        const b = this.blockForSensor(now, sensorId);
        if (!b) return;
        const { occupying } = this.trainsFor(now, b);
        if (occupying.length > 0 && !this.deps.sensors.isActive(sensorId)) {
          for (const id of occupying) void this.deps.trainState.setConfidence(id, 0.5);
          this.deps.safety.raise(`${reasonKey}: no confirmation`, 'DEGRADED');
        } else {
          this.deps.safety.clear(`${reasonKey}: no confirmation`);
        }
      }, MISMATCH_GRACE_MS),
    );
  }

  /** Hardware reported a turnout position. */
  onTurnoutFeedback(pieceId: string, state: string): void {
    const locked = this.deps.interlocking.lockedState(pieceId);
    const reason = `turnout ${pieceId} in wrong position under a claim`;
    if (locked && locked !== state) {
      this.deps.safety.raise(reason, 'EMERGENCY');
      this.deps.emergencyStop();
      return;
    }
    this.deps.safety.clear(reason);
  }

  /**
   * Restart / reconnect: compare active sensors with the expected occupancy of restored
   * poses. Confirmed trains get confidence 0.8, unconfirmed ones stay unknown.
   */
  async recover(): Promise<{ confirmed: string[]; unconfirmed: string[]; unexpectedSensors: number[] }> {
    const index = this.deps.getIndex();
    const confirmed: string[] = [];
    const unconfirmed: string[] = [];
    const unexpectedSensors: number[] = [];
    const expectedBySensor = new Map<number, string[]>();
    for (const live of this.deps.trainState.list()) {
      if (!live.pose) continue;
      let hit = false;
      for (const blockId of live.occupiedBlockIds) {
        const block = index.doc.trackBlocks.find((b) => b.id === blockId);
        if (block?.sensorId == null) continue;
        expectedBySensor.set(block.sensorId, [...(expectedBySensor.get(block.sensorId) ?? []), live.consistId]);
        if (this.deps.sensors.isActive(block.sensorId)) hit = true;
      }
      if (hit) {
        confirmed.push(live.consistId);
        await this.deps.trainState.setConfidence(live.consistId, 0.8);
      } else {
        unconfirmed.push(live.consistId);
      }
    }
    for (const s of this.deps.sensors.snapshot()) {
      if (s.active && !expectedBySensor.has(s.sensorId)) unexpectedSensors.push(s.sensorId);
    }
    if (unexpectedSensors.length) this.deps.safety.raise(`unexpected occupancy on sensors ${unexpectedSensors.join(', ')} after restart`, 'DEGRADED');
    if (unconfirmed.length) this.deps.safety.raise(`${unconfirmed.length} train(s) need position confirmation`, 'DEGRADED');
    else this.deps.safety.clear(`${unconfirmed.length} train(s) need position confirmation`);
    return { confirmed, unconfirmed, unexpectedSensors };
  }
}
