import type { ConnectorId } from '../geometry/pieceGeometry.ts';
import type { ElectricalSystem, TrackDef } from './types.ts';

export interface ConnectorFamily {
  brand: string;
  system: string;
  electrical: ElectricalSystem;
}

/**
 * Track family presented at a connector. Transition pieces present their own family at
 * connector A and the `transitionTo` family at connector B.
 */
export function familyAtConnector(def: TrackDef, connectorId: ConnectorId): ConnectorFamily {
  if (def.transitionTo && connectorId === 'B') return def.transitionTo;
  return { brand: def.brand, system: def.system, electrical: def.electrical };
}

export type CompatIssue = 'electrical' | 'mechanical';

/**
 * Whether two connectors can be coupled directly. Different electrical systems (3-rail
 * AC vs 2-rail DC) never couple; different mechanical families need a transition piece.
 */
export function connectorCompatibility(a: ConnectorFamily, b: ConnectorFamily): CompatIssue | null {
  if (a.electrical !== b.electrical) return 'electrical';
  if (a.brand !== b.brand || a.system !== b.system) return 'mechanical';
  return null;
}

export function describeCompatIssue(issue: CompatIssue, a: ConnectorFamily, b: ConnectorFamily): string {
  const fa = `${a.brand} ${a.system}`;
  const fb = `${b.brand} ${b.system}`;
  return issue === 'electrical'
    ? `${fa} (${a.electrical === 'ac3' ? '3-rail AC' : '2-rail DC'}) cannot be coupled to ${fb} (${b.electrical === 'ac3' ? '3-rail AC' : '2-rail DC'})`
    : `${fa} and ${fb} need a transition piece`;
}
