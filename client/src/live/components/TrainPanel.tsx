import { useState } from 'react';
import type { ConsistInput, LiveTrain } from '@shared/domain/train.ts';
import { RAIL_TYPE_LABEL } from '@shared/layout/schema.ts';
import { scaleKmh } from '../canvas/TrainLayer.ts';
import {
  useDeleteConsistMutation,
  useDriveMutation,
  useEmergencyStopMutation,
  usePlaceTrainMutation,
  useRemoveTrainPositionMutation,
  useSaveConsistMutation,
  useSetMovementMutation,
  useTrainCommandMutation,
  type ConsistWithLength,
} from '../api/liveApi.ts';
import { placementTraversal, useLiveStore } from '../store/liveStore.ts';

interface RosterTrain {
  DCC_ID: string;
  Name: string;
  Length: number;
}
interface RosterWagon {
  id: string;
  Name: string;
  Length: number;
}

function stateLabel(train: LiveTrain | undefined): string {
  if (!train?.pose) return 'not on the layout';
  const conf = train.pose.confidence < 1 ? ` · ${Math.round(train.pose.confidence * 100)}% sure` : '';
  const speed = train.pose.speedMmS > 0 ? ` · ${scaleKmh(train.pose.speedMmS).toFixed(0)} km/h` : '';
  return `${train.state} · ${train.pose.movement}${speed}${conf}`;
}

function ConsistEditor({ consist, roster, onDone }: { consist: ConsistWithLength | null; roster: { trains: RosterTrain[]; wagons: RosterWagon[] }; onDone: () => void }) {
  const save = useSaveConsistMutation();
  const [name, setName] = useState(consist?.name ?? 'New train');
  const [units, setUnits] = useState<ConsistInput['units']>(consist?.units ?? []);
  const [error, setError] = useState<string | null>(null);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= units.length) return;
    const next = [...units];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setUnits(next);
  };

  const submit = async () => {
    if (!units.length) {
      setError('Add at least one locomotive or wagon');
      return;
    }
    try {
      await save.mutateAsync({ id: consist?.id, input: { name, units, couplingGapMm: consist?.couplingGapMm ?? 6, accelerationMmS2: consist?.accelerationMmS2 ?? 120, brakingMmS2: consist?.brakingMmS2 ?? 180 } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="live-editor">
      <label className="designer-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="designer-field">
        <span>Units (front first)</span>
        <ol className="live-units">
          {units.map((u, i) => (
            <li key={i}>
              <span>
                {u.kind === 'loco'
                  ? `🚂 ${roster.trains.find((t) => t.DCC_ID === u.dccId)?.Name ?? u.dccId} (#${u.dccId})`
                  : `▭ ${roster.wagons.find((w) => w.id === u.wagonId)?.Name ?? u.wagonId}`}
              </span>
              {u.kind === 'loco' && (
                <button type="button" title="Cab 1 toward the consist front?" onClick={() => setUnits(units.map((x, k) => (k === i && x.kind === 'loco' ? { ...x, orientation: x.orientation === 'forward' ? 'reverse' : 'forward' } : x)))}>
                  {u.orientation === 'forward' ? '→' : '←'}
                </button>
              )}
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move toward front">
                ▲
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === units.length - 1} aria-label="Move toward rear">
                ▼
              </button>
              <button type="button" onClick={() => setUnits(units.filter((_, k) => k !== i))} aria-label="Remove unit">
                ×
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="designer-actions">
        <select value="" onChange={(e) => e.target.value && setUnits([...units, { kind: 'loco', dccId: e.target.value, orientation: 'forward' }])} aria-label="Add locomotive">
          <option value="">+ locomotive…</option>
          {roster.trains.map((t) => (
            <option key={t.DCC_ID} value={t.DCC_ID}>
              {t.Name} (#{t.DCC_ID}, {t.Length} mm)
            </option>
          ))}
        </select>
        <select value="" onChange={(e) => e.target.value && setUnits([...units, { kind: 'wagon', wagonId: e.target.value }])} aria-label="Add wagon">
          <option value="">+ wagon…</option>
          {roster.wagons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.Name} ({w.Length} mm)
            </option>
          ))}
        </select>
      </div>
      {error && <p className="designer-error">{error}</p>}
      <div className="designer-actions">
        <button type="button" onClick={submit} disabled={save.isPending}>
          {consist ? 'Save' : 'Create'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DriveControls({ consistId, live }: { consistId: string; live: LiveTrain }) {
  const drive = useDriveMutation();
  const command = useTrainCommandMutation();
  const [step, setStep] = useState(30);
  const movement = live.pose?.movement === 'reverse' ? 'reverse' : 'forward';
  return (
    <div className="live-drive">
      <label className="designer-field">
        <span>Speed step {step} / 126</span>
        <input type="range" min={0} max={126} value={step} onChange={(e) => setStep(Number(e.target.value))} />
      </label>
      <div className="designer-actions">
        <button type="button" onClick={() => drive.mutate({ consistId, movement: 'forward', speedStep: step })} title="Drive nose first">
          ▶ Forward
        </button>
        <button type="button" onClick={() => drive.mutate({ consistId, movement: 'reverse', speedStep: step })} title="Drive tail first (facing stays the same)">
          ◀ Reverse
        </button>
        <button type="button" onClick={() => command.mutate({ consistId, command: 'stop' })}>
          ■ Stop
        </button>
        {live.state === 'emergency' && (
          <button type="button" onClick={() => command.mutate({ consistId, command: 'reset' })}>
            Reset emergency
          </button>
        )}
        {live.pose && live.pose.confidence < 0.8 && (
          <button type="button" onClick={() => command.mutate({ consistId, command: 'confirm' })} title="The train really stands here">
            ✓ Confirm position
          </button>
        )}
      </div>
      <p className="designer-muted">
        Currently {live.state}, {movement}
        {live.pose && live.pose.speedMmS > 0 ? ` at ${scaleKmh(live.pose.speedMmS).toFixed(0)} km/h` : ''}.
      </p>
      {drive.isError && <p className="designer-muted live-drive-error">Not driving: {drive.error.message}</p>}
    </div>
  );
}

/** "275 + 125 + 6 coupling" — where a consist's length comes from. */
function lengthBreakdown(c: ConsistWithLength, roster: { trains: RosterTrain[]; wagons: RosterWagon[] }): string {
  const parts = c.units.map((u) =>
    u.kind === 'loco'
      ? `${roster.trains.find((t) => t.DCC_ID === u.dccId)?.Name ?? u.dccId} ${roster.trains.find((t) => t.DCC_ID === u.dccId)?.Length ?? '?'}`
      : `${roster.wagons.find((w) => w.id === u.wagonId)?.Name ?? 'wagon'} ${roster.wagons.find((w) => w.id === u.wagonId)?.Length ?? '?'}`,
  );
  const gaps = c.units.length > 1 ? ` + ${(c.units.length - 1) * c.couplingGapMm} coupling` : '';
  return `${parts.join(' + ')}${gaps} = ${c.totalLengthMm} mm`;
}

export function TrainPanel({ consists, roster }: { consists: ConsistWithLength[]; roster: { trains: RosterTrain[]; wagons: RosterWagon[] } }) {
  const emergency = useEmergencyStopMutation();
  const trains = useLiveStore((s) => s.trains);
  const selectedConsistId = useLiveStore((s) => s.selectedConsistId);
  const selectConsist = useLiveStore((s) => s.selectConsist);
  const placement = useLiveStore((s) => s.placement);
  const startPlacement = useLiveStore((s) => s.startPlacement);
  const flipPlacementDir = useLiveStore((s) => s.flipPlacementDir);
  const cancelPlacement = useLiveStore((s) => s.cancelPlacement);
  const place = usePlaceTrainMutation();
  const removePosition = useRemoveTrainPositionMutation();
  const setMovement = useSetMovementMutation();
  const deleteConsist = useDeleteConsistMutation();
  const [editing, setEditing] = useState<ConsistWithLength | null | 'new'>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (editing) {
    return (
      <section className="designer-inspector-section">
        <h3>{editing === 'new' ? 'New train' : `Edit ${editing.name}`}</h3>
        <ConsistEditor consist={editing === 'new' ? null : editing} roster={roster} onDone={() => setEditing(null)} />
      </section>
    );
  }

  const confirmPlacement = async () => {
    if (!placement) return;
    const front = placementTraversal(placement);
    if (!front) {
      setMessage('Click on the track where the nose of the train stands.');
      return;
    }
    try {
      await place.mutateAsync({ consistId: placement.consistId, front });
      setMessage(null);
      cancelPlacement();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <section className="designer-inspector-section">
      <h3>
        Trains <small>{consists.length}</small>
      </h3>
      {placement && (
        <div className="live-placement">
          <p>
            Placing <b>{consists.find((c) => c.id === placement.consistId)?.name}</b>: click the rail where the <b>nose</b> stands, then check the facing.
          </p>
          <div className="designer-actions">
            <button type="button" onClick={flipPlacementDir}>
              Flip facing ({placement.dir === 1 ? 'along path' : 'against path'})
            </button>
            <button type="button" onClick={confirmPlacement} disabled={!placement.front || place.isPending}>
              Confirm position
            </button>
            <button type="button" onClick={cancelPlacement}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className="designer-error">{message}</p>}
      <ul className="live-trains">
        {consists.map((c) => {
          const live = trains.get(c.id);
          const selected = c.id === selectedConsistId;
          return (
            <li key={c.id} className={selected ? 'is-selected' : ''}>
              <button type="button" className="live-train-head" onClick={() => selectConsist(selected ? null : c.id)}>
                <span className="live-train-name">{c.name}</span>
                <span className="live-train-meta" title={lengthBreakdown(c, roster)}>
                  {c.totalLengthMm} mm ({c.units.length === 1 ? 'loco only' : `${c.units.length} units`}) · {stateLabel(live)}
                </span>
              </button>
              {selected && live?.pose && <DriveControls consistId={c.id} live={live} />}
              {selected && (
                <div className="designer-actions">
                  {live?.pose ? (
                    <>
                      <button type="button" onClick={() => setMovement.mutate({ consistId: c.id, movement: live.pose!.movement === 'forward' ? 'reverse' : 'forward' })} title="Flip the standing movement direction; the physical front stays the same">
                        Change direction
                      </button>
                      <button type="button" onClick={() => startPlacement(c.id)}>
                        Re-place
                      </button>
                      <button type="button" onClick={() => removePosition.mutate(c.id)}>
                        Take off layout
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => startPlacement(c.id)}>
                      Place on layout
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button type="button" className="is-danger" onClick={() => deleteConsist.mutate(c.id)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="designer-actions">
        <button type="button" onClick={() => setEditing('new')}>
          + New train
        </button>
        <button type="button" className="is-danger" onClick={() => emergency.mutate()} title="Stop every train immediately">
          ⛔ Emergency stop all
        </button>
      </div>
      <p className="designer-muted">Service classes on track: {Object.values(RAIL_TYPE_LABEL).join(', ')}.</p>
    </section>
  );
}
