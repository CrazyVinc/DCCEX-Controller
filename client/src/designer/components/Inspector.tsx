import { useState } from 'react';
import { radToDeg } from '@shared/geometry/frame.ts';
import { pathLength } from '@shared/geometry/primitives.ts';
import { blockLengthMm } from '@shared/layout/blockGeometry.ts';
import { unresolvedGaps } from '@shared/layout/index.ts';
import { DRIVING_CONSTRAINTS, RAIL_TYPES, RAIL_TYPE_LABEL, SPEED_STEP_MAX, SPEED_STEP_MIN, type RailType } from '@shared/layout/schema.ts';
import { getAccessoryDef } from '../data/accessoryCatalog.ts';
import { useEditorStore, type BlockKind } from '../store/editorStore.ts';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="designer-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function PieceInspector({ pieceIds }: { pieceIds: string[] }) {
  const index = useEditorStore((s) => s.index);
  const update = useEditorStore((s) => s.updateSelectedPiece);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const solveFlexToPort = useEditorStore((s) => s.solveFlexToPort);
  const setFlexLength = useEditorStore((s) => s.setFlexLength);
  const select = useEditorStore((s) => s.select);
  const [flexMessage, setFlexMessage] = useState<string | null>(null);
  const views = pieceIds.map((id) => index.pieces.get(id)).filter((v): v is NonNullable<typeof v> => !!v);
  const first = views[0];
  if (!first) return null;
  const piece = first.piece;
  const def = first.def;
  const many = views.length > 1;

  const openPortsElsewhere = index.openPorts.filter((p) => p.pieceId !== piece.id && !index.pieces.get(p.pieceId)!.geom.connectors.find((c) => c.id === p.connectorId)!.blocked);

  // Stations, blocks and speed restrictions that run over the selected piece(s).
  const selected = new Set(pieceIds);
  const memberships: { kind: BlockKind; id: string; label: string }[] = [
    ...index.doc.destinations.filter((d) => d.pieceIds.some((id) => selected.has(id))).map((d) => ({ kind: 'destination' as BlockKind, id: d.id, label: `${d.isStation ? 'Station' : 'Destination'} ${d.name}` })),
    ...index.doc.trackBlocks.filter((b) => b.pieceIds.some((id) => selected.has(id))).map((b) => ({ kind: 'block' as BlockKind, id: b.id, label: b.sensorId != null ? `Block S${b.sensorId}` : 'Block' })),
    ...index.doc.speedRestrictions.filter((r) => r.pieceIds.some((id) => selected.has(id))).map((r) => ({ kind: 'speed' as BlockKind, id: r.id, label: `Speed ≤ ${r.maxSpeedStep}` })),
  ];

  return (
    <section className="designer-inspector-section">
      <h3>
        {many ? `${views.length} pieces` : `${def.brand} ${def.system} ${def.artNo}`}
        {!many && def.label && <small> {def.label}</small>}
      </h3>
      {!many && (
        <dl className="designer-kv">
          <dt>Kind</dt>
          <dd>{def.kind}</dd>
          <dt>Length</dt>
          <dd>{first.geom.paths.map((p) => `${p.id} ${pathLength(p.primitives).toFixed(1)} mm`).join(' · ')}</dd>
          <dt>Position</dt>
          <dd>
            {piece.frame.x.toFixed(1)}, {piece.frame.y.toFixed(1)} mm · {radToDeg(piece.frame.theta).toFixed(1)}°
          </dd>
          <dt>Level</dt>
          <dd>
            L{piece.level} · z {piece.zMm} mm
          </dd>
        </dl>
      )}
      <div className="designer-actions">
        <button type="button" onClick={() => rotateSelected(-15)}>
          ⟲ 15°
        </button>
        <button type="button" onClick={() => rotateSelected(15)}>
          ⟳ 15°
        </button>
        <button type="button" className="is-danger" onClick={deleteSelected}>
          Delete
        </button>
      </div>
      <Field label="Grade (%)">
        <input
          type="number"
          step={0.1}
          value={piece.gradePercent ?? 0}
          onChange={(e) => update({ gradePercent: Number(e.target.value) || undefined })}
        />
      </Field>
      {(def.kind === 'turnout' || !many) && def.kind === 'turnout' && (
        <>
          <Field label="DCC-EX turnout id">
            <input value={piece.automationId ?? ''} placeholder="manual" onChange={(e) => update({ automationId: e.target.value.trim() || undefined })} />
          </Field>
          <Field label="Switch time (ms)">
            <input type="number" min={50} step={50} value={piece.switchTimeMs ?? 400} onChange={(e) => update({ switchTimeMs: Number(e.target.value) || undefined })} />
          </Field>
          <p className="designer-muted">
            States: {first.geom.states?.map((s) => `${s.label} (${s.paths.join(', ')})`).join(' · ')}
          </p>
        </>
      )}
      <Field label="Driving direction">
        <select value={piece.drivingConstraint ?? 'both'} onChange={(e) => update({ drivingConstraint: e.target.value === 'both' ? undefined : (e.target.value as 'forward' | 'reverse') })}>
          {DRIVING_CONSTRAINTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="designer-field">
        <span>Service restriction</span>
        {RAIL_TYPES.map((rt: RailType) => (
          <label key={rt} className="designer-check">
            <input
              type="checkbox"
              checked={piece.railTypes?.includes(rt) ?? false}
              onChange={(e) => {
                const cur = new Set(piece.railTypes ?? []);
                if (e.target.checked) cur.add(rt);
                else cur.delete(rt);
                update({ railTypes: [...cur] });
              }}
            />
            {RAIL_TYPE_LABEL[rt]}
          </label>
        ))}
      </fieldset>
      {def.kind === 'flex' && !many && (
        <div className="designer-flex">
          <Field label="Straight length (mm)">
            <input
              type="number"
              min={40}
              max={def.maxLengthMm}
              value={Math.round(pathLength(first.geom.paths[0]!.primitives))}
              onChange={(e) => setFlexLength(piece.id, Number(e.target.value))}
            />
          </Field>
          <Field label="Bend to reach open end">
            <select
              value=""
              onChange={(e) => {
                const [pieceId, connectorId] = e.target.value.split(':');
                if (!pieceId) return;
                setFlexMessage(solveFlexToPort(piece.id, { pieceId, connectorId: connectorId as 'A' | 'B' | 'C' | 'D' }));
              }}
            >
              <option value="">Choose target port…</option>
              {openPortsElsewhere.map((p) => {
                const v = index.pieces.get(p.pieceId)!;
                const f = v.connectorWorld.get(p.connectorId)!;
                const d = Math.hypot(f.x - first.frame.x, f.y - first.frame.y);
                return (
                  <option key={`${p.pieceId}:${p.connectorId}`} value={`${p.pieceId}:${p.connectorId}`}>
                    {v.def.artNo} · {p.connectorId} · {d.toFixed(0)} mm away
                  </option>
                );
              })}
            </select>
          </Field>
          {flexMessage && <p className="designer-error">{flexMessage}</p>}
          <p className="designer-muted">
            Shape: {piece.flexShape?.map((p) => (p.kind === 'line' ? `line ${p.length.toFixed(0)}` : `arc R${p.radius.toFixed(0)} ${radToDeg(p.sweep).toFixed(1)}°`)).join(' + ') ?? 'straight'}
          </p>
        </div>
      )}
      {memberships.length > 0 && (
        <div className="designer-field">
          <span>Part of</span>
          <div className="designer-actions">
            {memberships.map((m) => (
              <button key={`${m.kind}:${m.id}`} type="button" onClick={() => select({ block: { kind: m.kind, id: m.id } })} title="Edit">
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function JointInspector({ jointId }: { jointId: string }) {
  const index = useEditorStore((s) => s.index);
  const breakJoint = useEditorStore((s) => s.breakJoint);
  const forceJoint = useEditorStore((s) => s.forceJoint);
  const joint = index.doc.joints.find((j) => j.id === jointId);
  if (!joint) return null;
  const gap = index.jointGaps.get(jointId);
  const unresolved = unresolvedGaps(index).some((g) => g.jointId === jointId);
  const label = (ref: typeof joint.a) => `${index.pieces.get(ref.pieceId)?.def.artNo ?? '?'} · ${ref.connectorId}`;
  return (
    <section className="designer-inspector-section">
      <h3>Joint</h3>
      <dl className="designer-kv">
        <dt>Between</dt>
        <dd>
          {label(joint.a)} ↔ {label(joint.b)}
        </dd>
        <dt>Fit</dt>
        <dd>{gap ? `${gap.gapMm.toFixed(2)} mm / ${gap.gapDeg.toFixed(2)}° off${joint.forced ? ' (accepted)' : ''}` : 'exact'}</dd>
      </dl>
      {gap && (
        <p className={unresolved ? 'designer-error' : 'designer-muted'}>
          This joint closes a loop that does not fit exactly. Bend a flex rail into the loop, change a piece, or accept the mismatch.
        </p>
      )}
      <div className="designer-actions">
        {gap && (
          <button type="button" onClick={() => forceJoint(jointId, !joint.forced)}>
            {joint.forced ? 'Un-accept mismatch' : 'Accept mismatch'}
          </button>
        )}
        <button type="button" className="is-danger" onClick={() => breakJoint(jointId)}>
          Break joint
        </button>
      </div>
    </section>
  );
}

function BlockInspector({ kind, id }: { kind: BlockKind; id: string }) {
  const index = useEditorStore((s) => s.index);
  const updateBlock = useEditorStore((s) => s.updateBlock);
  const removeBlock = useEditorStore((s) => s.removeBlock);
  const doc = index.doc;
  const destination = kind === 'destination' ? doc.destinations.find((b) => b.id === id) : undefined;
  const speed = kind === 'speed' ? doc.speedRestrictions.find((b) => b.id === id) : undefined;
  const block = kind === 'block' ? doc.trackBlocks.find((b) => b.id === id) : destination ?? speed;
  if (!block) return null;
  const title = kind === 'block' ? 'Track block' : kind === 'destination' ? 'Destination' : 'Speed restriction';
  return (
    <section className="designer-inspector-section">
      <h3>{title}</h3>
      <dl className="designer-kv">
        <dt>Length</dt>
        <dd>{blockLengthMm(index, block).toFixed(0)} mm</dd>
        <dt>Pieces</dt>
        <dd>{block.pieceIds.length}</dd>
        <dt>Level</dt>
        <dd>L{block.level}</dd>
      </dl>
      {kind === 'block' && (
        <Field label="DCC-EX sensor id">
          <input
            type="number"
            min={0}
            value={block.sensorId ?? ''}
            placeholder="none"
            onChange={(e) => updateBlock(kind, id, { sensorId: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </Field>
      )}
      {destination && (
        <>
          <Field label="Name">
            <input value={destination.name} onChange={(e) => updateBlock(kind, id, { name: e.target.value })} />
          </Field>
          <label className="designer-check">
            <input type="checkbox" checked={destination.isStation ?? false} onChange={(e) => updateBlock(kind, id, { isStation: e.target.checked || undefined })} /> Station (trains stop here)
          </label>
        </>
      )}
      {speed && (
        <Field label={`Max speed step (${SPEED_STEP_MIN}–${SPEED_STEP_MAX})`}>
          <input
            type="number"
            min={SPEED_STEP_MIN}
            max={SPEED_STEP_MAX}
            value={speed.maxSpeedStep}
            onChange={(e) => updateBlock(kind, id, { maxSpeedStep: Math.min(SPEED_STEP_MAX, Math.max(SPEED_STEP_MIN, Number(e.target.value) || SPEED_STEP_MIN)) })}
          />
        </Field>
      )}
      <div className="designer-actions">
        <button type="button" className="is-danger" onClick={() => removeBlock(kind, id)}>
          Remove
        </button>
      </div>
    </section>
  );
}

function AccessoryInspector({ id }: { id: string }) {
  const doc = useEditorStore((s) => s.doc);
  const updateAccessory = useEditorStore((s) => s.updateAccessory);
  const removeAccessory = useEditorStore((s) => s.removeAccessory);
  const acc = doc.accessories.find((a) => a.id === id);
  if (!acc) return null;
  const def = getAccessoryDef(acc.defId);
  return (
    <section className="designer-inspector-section">
      <h3>{def?.label ?? acc.defId}</h3>
      {def?.dccCapable && (
        <Field label="DCC-EX accessory id">
          <input value={acc.automationId ?? ''} placeholder="manual" onChange={(e) => updateAccessory(id, { automationId: e.target.value.trim() || undefined })} />
        </Field>
      )}
      {!acc.anchor && (
        <Field label="Rotation (°)">
          <input type="number" step={15} value={acc.rotationDeg} onChange={(e) => updateAccessory(id, { rotationDeg: Number(e.target.value) || 0 })} />
        </Field>
      )}
      <div className="designer-actions">
        <button type="button" className="is-danger" onClick={() => removeAccessory(id)}>
          Remove
        </button>
      </div>
    </section>
  );
}

export function Inspector() {
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const pendingAnchor = useEditorStore((s) => s.pendingAnchor);
  const pendingPort = useEditorStore((s) => s.pendingPort);

  if (selection.pieceIds.length) return <PieceInspector pieceIds={selection.pieceIds} />;
  if (selection.jointId) return <JointInspector jointId={selection.jointId} />;
  if (selection.block) return <BlockInspector kind={selection.block.kind} id={selection.block.id} />;
  if (selection.accessoryId) return <AccessoryInspector id={selection.accessoryId} />;

  return (
    <section className="designer-inspector-section">
      <h3>Nothing selected</h3>
      <p className="designer-muted">
        {tool === 'join' && (pendingPort ? 'Now click the second open end.' : 'Click an open end (green) to start a join.')}
        {(tool === 'block' || tool === 'destination' || tool === 'speed') && (pendingAnchor ? 'Click the end of the section on the track.' : 'Click the start of the section on the track.')}
        {tool === 'accessory' && 'Click on (or beside) the track to place the accessory.'}
        {tool === 'select' && 'Pick a piece from the palette and click near a green open end to couple it exactly. Drag components to move them; drop an open end onto another to join.'}
        {tool === 'pan' && 'Drag to pan. Scroll to zoom.'}
      </p>
    </section>
  );
}
