import { Icon } from '@iconify/react';
import { useRef } from 'react';
import { LayoutDocumentSchema } from '@shared/layout/schema.ts';
import { normalizeLayout } from '@shared/layout/ops.ts';
import { useEditorStore, type EditorTool } from '../store/editorStore.ts';

const TOOLS: { id: EditorTool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Select / move', icon: 'material-symbols:arrow-selector-tool', key: 'V' },
  { id: 'pan', label: 'Pan', icon: 'material-symbols:pan-tool', key: 'H' },
  { id: 'join', label: 'Join two open ends', icon: 'material-symbols:link', key: 'J' },
  { id: 'block', label: 'Track block (sensor)', icon: 'material-symbols:sensors', key: 'B' },
  { id: 'destination', label: 'Destination / station', icon: 'material-symbols:flag', key: 'D' },
  { id: 'speed', label: 'Speed restriction', icon: 'material-symbols:speed', key: 'S' },
];

export function Toolbar({ canvasSize }: { canvasSize: () => { width: number; height: number } }) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const view = useEditorStore((s) => s.view);
  const setView = useEditorStore((s) => s.setView);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const dirty = useEditorStore((s) => s.dirty);
  const name = useEditorStore((s) => s.doc.name);
  const setLayoutName = useEditorStore((s) => s.setLayoutName);
  const zoomAt = useEditorStore((s) => s.zoomAt);
  const fitToContent = useEditorStore((s) => s.fitToContent);
  const showAllLevels = useEditorStore((s) => s.showAllLevels);
  const setShowAllLevels = useEditorStore((s) => s.setShowAllLevels);
  const doc = useEditorStore((s) => s.doc);
  const commit = useEditorStore((s) => s.commit);
  const setPhotoImportOpen = useEditorStore((s) => s.setPhotoImportOpen);
  const flaggedCount = useEditorStore((s) => s.flaggedPieceIds.size);
  const clearFlags = useEditorStore((s) => s.clearFlags);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || 'layout'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    const parsed = LayoutDocumentSchema.safeParse(JSON.parse(await file.text()));
    if (!parsed.success) {
      useEditorStore.getState().markSaved('Import rejected: not a v3 layout document');
      return;
    }
    commit(normalizeLayout(parsed.data));
  };

  const center = () => {
    const { width, height } = canvasSize();
    return { x: width / 2, y: height / 2 };
  };

  return (
    <div className="designer-toolbar">
      <div className="designer-toolbar-group">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? 'is-active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-label={t.label}>
            <Icon icon={t.icon} />
          </button>
        ))}
      </div>
      <div className="designer-toolbar-group">
        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon icon="material-symbols:undo" />
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon icon="material-symbols:redo" />
        </button>
      </div>
      <div className="designer-toolbar-group">
        <button type="button" onClick={() => zoomAt(center(), 1.25)} title="Zoom in" aria-label="Zoom in">
          <Icon icon="material-symbols:zoom-in" />
        </button>
        <button type="button" onClick={() => zoomAt(center(), 0.8)} title="Zoom out" aria-label="Zoom out">
          <Icon icon="material-symbols:zoom-out" />
        </button>
        <button
          type="button"
          onClick={() => {
            const { width, height } = canvasSize();
            fitToContent(width, height);
          }}
          title="Fit layout"
          aria-label="Fit layout"
        >
          <Icon icon="material-symbols:fit-screen" />
        </button>
        <label className="designer-toggle">
          <input type="checkbox" checked={showAllLevels} onChange={(e) => setShowAllLevels(e.target.checked)} /> all levels
        </label>
      </div>
      <div className="designer-toolbar-group">
        <button type="button" className={view === '2d' ? 'is-active' : ''} onClick={() => setView('2d')} title="Plan view">
          2D
        </button>
        <button type="button" className={view === '3d' ? 'is-active' : ''} onClick={() => setView('3d')} title="3D view">
          3D
        </button>
      </div>
      <div className="designer-toolbar-group designer-toolbar-grow">
        <input className="designer-name" value={name} onChange={(e) => setLayoutName(e.target.value)} aria-label="Layout name" />
        <span className={`designer-save ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved changes…' : saveStatus || 'Saved'}</span>
      </div>
      <div className="designer-toolbar-group">
        <button type="button" onClick={exportJson} title="Export JSON">
          <Icon icon="material-symbols:download" />
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} title="Import JSON">
          <Icon icon="material-symbols:upload" />
        </button>
        <button type="button" onClick={() => setPhotoImportOpen(true)} title="Import track plan from a photo (Ollama)">
          <Icon icon="material-symbols:photo-camera" />
        </button>
        {flaggedCount > 0 && (
          <button type="button" onClick={clearFlags} title="Clear the orange review marks from the photo import">
            {flaggedCount} to review ✓
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
