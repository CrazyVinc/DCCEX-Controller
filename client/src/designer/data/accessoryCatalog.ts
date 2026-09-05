/**
 * Track "additions" — accessories placed on or beside the rail. On-rail accessories
 * reference an exact `TrackPosition`; aside accessories store a free world position.
 */
export type AccessoryPlacement = 'onTrack' | 'aside';

export interface AccessoryDef {
  id: string;
  label: string;
  placement: AccessoryPlacement;
  /** Supports a DCC-EX automation id (signals / decouplers). */
  dccCapable: boolean;
  hint: string;
}

export const ACCESSORY_CATALOG: AccessoryDef[] = [
  { id: 'signal-2', label: 'Signal · 2-aspect', placement: 'onTrack', dccCapable: true, hint: 'Red / green signal beside the rail.' },
  { id: 'signal-3', label: 'Signal · 3-aspect', placement: 'onTrack', dccCapable: true, hint: 'Red / yellow / green signal beside the rail.' },
  { id: 'decoupler', label: 'Decoupler', placement: 'onTrack', dccCapable: true, hint: 'Uncoupler ramp on the rail.' },
  { id: 'buffer-stop', label: 'Buffer stop', placement: 'onTrack', dccCapable: false, hint: 'Marks where the track terminates.' },
  { id: 'platform', label: 'Platform', placement: 'aside', dccCapable: false, hint: 'Station platform beside the track.' },
  { id: 'lamp', label: 'Lamp', placement: 'aside', dccCapable: false, hint: 'Scenery light.' },
];

const byId = new Map(ACCESSORY_CATALOG.map((a) => [a.id, a]));

export function getAccessoryDef(id: string): AccessoryDef | undefined {
  return byId.get(id);
}
