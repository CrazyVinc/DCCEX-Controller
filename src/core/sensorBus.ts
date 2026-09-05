import EventEmitter from 'node:events';
import type { SensorState } from '../../shared/src/events/live.ts';

export type SensorSource = 'hardware' | 'virtual';

export interface SensorBusEvents {
  changed: [SensorState & { source: SensorSource }];
}

/**
 * Occupancy sensor states from either DCC-EX (`<Q id>` / `<q id>`) or, in simulation
 * mode, derived from the simulated train positions. Consumers (reconciliation, live
 * map) do not care where a reading came from.
 */
export class SensorBus extends EventEmitter<SensorBusEvents> {
  private readonly states = new Map<number, SensorState>();

  get(sensorId: number): SensorState | undefined {
    return this.states.get(sensorId);
  }

  isActive(sensorId: number): boolean {
    return this.states.get(sensorId)?.active ?? false;
  }

  snapshot(): SensorState[] {
    return [...this.states.values()];
  }

  set(sensorId: number, active: boolean, source: SensorSource): void {
    const prev = this.states.get(sensorId);
    if (prev && prev.active === active) return;
    const next: SensorState = { sensorId, active, updatedAt: Date.now() };
    this.states.set(sensorId, next);
    this.emit('changed', { ...next, source });
  }

  /** Replace the whole set of active sensors (virtual feed). */
  setActiveSet(activeIds: Set<number>, knownIds: Iterable<number>, source: SensorSource): void {
    for (const id of knownIds) this.set(id, activeIds.has(id), source);
  }
}
