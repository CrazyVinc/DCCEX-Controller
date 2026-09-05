import { getLevelHeightMm } from '@shared/layout/schema.ts';
import { useEditorStore } from '../store/editorStore.ts';

export function LevelBar() {
  const doc = useEditorStore((s) => s.doc);
  const setActiveLevel = useEditorStore((s) => s.setActiveLevel);
  const setLevelHeight = useEditorStore((s) => s.setLevelHeight);
  const selection = useEditorStore((s) => s.selection);
  const setPieceLevel = useEditorStore((s) => s.setPieceLevel);

  let maxLevel = doc.activeLevel;
  for (const p of doc.pieces) maxLevel = Math.max(maxLevel, p.level);
  const levels = Array.from({ length: maxLevel + 2 }, (_, i) => i);
  const counts = new Map<number, number>();
  for (const p of doc.pieces) counts.set(p.level, (counts.get(p.level) ?? 0) + 1);

  return (
    <div className="designer-levelbar">
      <span className="designer-levelbar-title">Levels</span>
      {levels.map((level) => (
        <div key={level} className={`designer-level ${doc.activeLevel === level ? 'is-active' : ''}`}>
          <button type="button" onClick={() => setActiveLevel(level)} title={`Edit level ${level}`}>
            L{level} <small>({counts.get(level) ?? 0})</small>
          </button>
          <label>
            <input
              type="number"
              step={5}
              value={getLevelHeightMm(doc, level)}
              onChange={(e) => setLevelHeight(level, Number(e.target.value))}
              aria-label={`Height of level ${level} in mm`}
            />
            mm
          </label>
        </div>
      ))}
      {selection.pieceIds.length > 0 && (
        <button type="button" className="designer-level-move" onClick={() => setPieceLevel(selection.pieceIds, doc.activeLevel)}>
          Move selection to L{doc.activeLevel}
        </button>
      )}
    </div>
  );
}
