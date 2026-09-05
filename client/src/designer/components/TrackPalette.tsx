import { useMemo, useState } from 'react';
import { catalogFamilies, type TrackDef } from '@shared/catalog/index.ts';
import { ACCESSORY_CATALOG } from '../data/accessoryCatalog.ts';
import { useEditorStore } from '../store/editorStore.ts';

const KIND_ORDER: TrackDef['kind'][] = ['straight', 'curve', 'turnout', 'crossing', 'flex'];
const KIND_LABEL: Record<TrackDef['kind'], string> = {
  straight: 'Straights',
  curve: 'Curves',
  turnout: 'Turnouts',
  crossing: 'Crossings',
  flex: 'Flex',
};

function describe(def: TrackDef): string {
  switch (def.kind) {
    case 'straight':
      return `${def.lengthMm} mm`;
    case 'curve':
      return `R${def.radiusMm} · ${def.angleDeg}°`;
    case 'turnout':
      return `${def.hand === 'L' ? 'Left' : 'Right'} · ${def.divergeDeg}°${def.geometryMode !== 'standard' ? ` · ${def.geometryMode}` : ''}`;
    case 'crossing':
      return `${def.lengthMm} mm · ${def.angleDeg}°`;
    case 'flex':
      return `≤ ${def.maxLengthMm} mm`;
  }
}

export function TrackPalette() {
  const families = useMemo(() => catalogFamilies(), []);
  const [familyKey, setFamilyKey] = useState(families.find((f) => f.system === 'K')?.key ?? families[0]!.key);
  const [filter, setFilter] = useState('');
  const placing = useEditorStore((s) => s.placing);
  const startPlacing = useEditorStore((s) => s.startPlacing);
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const accessoryDefId = useEditorStore((s) => s.accessoryDefId);
  const setAccessoryDef = useEditorStore((s) => s.setAccessoryDef);

  const family = families.find((f) => f.key === familyKey) ?? families[0]!;
  const needle = filter.trim().toLowerCase();
  const defs = family.defs.filter((d) => !needle || d.artNo.includes(needle) || (d.label ?? '').toLowerCase().includes(needle));

  return (
    <aside className="designer-palette">
      <div className="designer-panel-head">
        <select value={familyKey} onChange={(e) => setFamilyKey(e.target.value)} aria-label="Track family">
          {families.map((f) => (
            <option key={f.key} value={f.key}>
              {f.brand} {f.system} · {f.electrical === 'ac3' ? '3-rail AC' : '2-rail DC'}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter pieces" />
      </div>
      <div className="designer-palette-scroll">
        {KIND_ORDER.map((kind) => {
          const items = defs.filter((d) => d.kind === kind);
          if (!items.length) return null;
          return (
            <section key={kind}>
              <h3>{KIND_LABEL[kind]}</h3>
              <ul>
                {items.map((def) => (
                  <li key={def.id}>
                    <button
                      type="button"
                      className={placing?.defId === def.id ? 'is-active' : ''}
                      onClick={() => startPlacing(def.id)}
                      title={def.label ?? def.artNo}
                    >
                      <span className="artno">{def.artNo}</span>
                      <span className="desc">{describe(def)}</span>
                      {def.label && <span className="label">{def.label}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <section>
          <h3>Accessories</h3>
          <ul>
            {ACCESSORY_CATALOG.map((acc) => (
              <li key={acc.id}>
                <button
                  type="button"
                  className={tool === 'accessory' && accessoryDefId === acc.id ? 'is-active' : ''}
                  onClick={() => {
                    setAccessoryDef(acc.id);
                    setTool('accessory');
                  }}
                  title={acc.hint}
                >
                  <span className="artno">{acc.label}</span>
                  <span className="desc">{acc.placement === 'aside' ? 'beside track' : 'on track'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {placing && (
        <p className="designer-hint">
          Click to place · <kbd>Tab</kbd> connector <b>{placing.connectorId}</b> · <kbd>R</kbd> rotate · <kbd>Esc</kbd> stop
        </p>
      )}
    </aside>
  );
}
