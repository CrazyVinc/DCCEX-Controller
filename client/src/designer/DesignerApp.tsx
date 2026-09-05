import { useEffect, useRef } from 'react';
import { useLayoutQuery, useSaveLayoutMutation } from './api/layoutQueries.ts';
import { LayoutCanvas } from './canvas/LayoutCanvas.tsx';
import { Inspector } from './components/Inspector.tsx';
import { LevelBar } from './components/LevelBar.tsx';
import { PhotoImportDialog } from './components/PhotoImportDialog.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { TrackPalette } from './components/TrackPalette.tsx';
import { ValidationPanel } from './components/ValidationPanel.tsx';
import { useEditorStore } from './store/editorStore.ts';
import { Layout3DView } from './three/Layout3DView.tsx';
import './styles/designer.css';

const AUTOSAVE_DELAY_MS = 800;

if (import.meta.env.DEV) {
  // Handy for debugging / automated UI checks in the dev server only.
  (window as unknown as { __editorStore?: typeof useEditorStore }).__editorStore = useEditorStore;
}

/** Loads the document into the editor store once and autosaves changes (debounced). */
function useLayoutSync() {
  const query = useLayoutQuery();
  const save = useSaveLayoutMutation();
  const hydrate = useEditorStore((s) => s.hydrate);
  const hydrated = useEditorStore((s) => s.hydrated);
  const doc = useEditorStore((s) => s.doc);
  const dirty = useEditorStore((s) => s.dirty);
  const markSaved = useEditorStore((s) => s.markSaved);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (query.data && !hydrated) hydrate(query.data);
  }, [query.data, hydrated, hydrate]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    const t = window.setTimeout(() => {
      saveRef.current
        .mutateAsync(doc)
        .then(({ unresolvedGaps }) => markSaved(unresolvedGaps ? `Saved · ${unresolvedGaps} joint(s) not closing` : 'Saved'))
        .catch((err: Error) => markSaved(`Save failed: ${err.message}`));
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [doc, dirty, hydrated, markSaved]);

  return query;
}

export function DesignerApp() {
  const query = useLayoutSync();
  const view = useEditorStore((s) => s.view);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasSize = () => ({ width: canvasRef.current?.clientWidth ?? 800, height: canvasRef.current?.clientHeight ?? 600 });

  useEffect(() => {
    if (!query.data) return;
    const { width, height } = canvasSize();
    useEditorStore.getState().fitToContent(width, height);
  }, [query.data]);

  if (query.isError) {
    return <div className="designer-app designer-error-page">Layout could not be loaded: {(query.error as Error).message}</div>;
  }

  return (
    <div className="designer-app">
      <Toolbar canvasSize={canvasSize} />
      <LevelBar />
      <div className="designer-main">
        <TrackPalette />
        <div className="designer-center" ref={canvasRef}>
          {view === '2d' ? <LayoutCanvas /> : <Layout3DView />}
        </div>
        <aside className="designer-right">
          <Inspector />
          <ValidationPanel />
        </aside>
      </div>
      <PhotoImportDialog />
    </div>
  );
}
