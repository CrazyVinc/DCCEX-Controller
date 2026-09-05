import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLayoutQuery } from '../designer/api/layoutQueries.ts';
import { useConsistsQuery, useSafetyResetMutation, useSetTurnoutMutation } from './api/liveApi.ts';
import { LiveCanvas } from './canvas/LiveCanvas.tsx';
import { LayerToggles } from './components/LayerToggles.tsx';
import { TrainPanel } from './components/TrainPanel.tsx';
import { useLiveStore } from './store/liveStore.ts';
import { useLiveSocket } from './useLiveSocket.ts';
import '../designer/styles/designer.css';
import './styles/live.css';

if (import.meta.env.DEV) {
  (window as unknown as { __liveStore?: typeof useLiveStore }).__liveStore = useLiveStore;
}

interface Roster {
  trains: { DCC_ID: string; Name: string; Length: number }[];
  wagons: { id: string; Name: string; Length: number }[];
}

export function LiveApp() {
  const layoutQuery = useLayoutQuery();
  const consistsQuery = useConsistsQuery();
  const rosterQuery = useQuery({ queryKey: ['rolling-stock'], queryFn: async () => (await fetch('/api/rolling-stock')).json() as Promise<Roster> });
  const setLayout = useLiveStore((s) => s.setLayout);
  const setConsists = useLiveStore((s) => s.setConsists);
  const connected = useLiveStore((s) => s.connected);
  const safety = useLiveStore((s) => s.safety);
  const simulationMode = useLiveStore((s) => s.simulationMode);
  const layoutLoaded = useLiveStore((s) => s.layoutLoaded);
  const activeLevel = useLiveStore((s) => s.activeLevel);
  const setActiveLevel = useLiveStore((s) => s.setActiveLevel);
  const showAllLevels = useLiveStore((s) => s.showAllLevels);
  const setShowAllLevels = useLiveStore((s) => s.setShowAllLevels);
  const doc = useLiveStore((s) => s.doc);
  const setTurnout = useSetTurnoutMutation();
  const resetSafety = useSafetyResetMutation();
  const canvasRef = useRef<HTMLDivElement>(null);
  useLiveSocket();

  useEffect(() => {
    if (layoutQuery.data) setLayout(layoutQuery.data);
  }, [layoutQuery.data, setLayout]);

  useEffect(() => {
    if (consistsQuery.data) setConsists(consistsQuery.data);
  }, [consistsQuery.data, setConsists]);

  useEffect(() => {
    if (!layoutLoaded) return;
    const el = canvasRef.current;
    useLiveStore.getState().fitToContent(el?.clientWidth ?? 800, el?.clientHeight ?? 600);
  }, [layoutLoaded]);

  let maxLevel = 0;
  for (const p of doc.pieces) maxLevel = Math.max(maxLevel, p.level);

  return (
    <div className="designer-app live-app">
      <div className="designer-toolbar">
        <div className="designer-toolbar-group">
          <span className={`live-badge ${connected ? 'is-ok' : 'is-bad'}`}>{connected ? 'live' : 'offline'}</span>
          <span className={`live-badge live-safety-${safety.level.toLowerCase()}`} title={safety.reasons.join('\n')}>
            {safety.level}
          </span>
          {simulationMode && <span className="live-badge">simulation</span>}
          {safety.level !== 'NORMAL' && (
            <>
              <span className="designer-muted live-reasons" title={safety.reasons.join('\n')}>
                {safety.reasons[0]}
                {safety.reasons.length > 1 ? ` (+${safety.reasons.length - 1})` : ''}
              </span>
              {safety.level === 'EMERGENCY' && (
                <button type="button" onClick={() => resetSafety.mutate()}>
                  Reset emergency
                </button>
              )}
            </>
          )}
        </div>
        <div className="designer-toolbar-group">
          <label className="designer-toggle">
            <input type="checkbox" checked={showAllLevels} onChange={(e) => setShowAllLevels(e.target.checked)} /> all levels
          </label>
          {!showAllLevels &&
            Array.from({ length: maxLevel + 1 }, (_, i) => i).map((level) => (
              <button key={level} type="button" className={activeLevel === level ? 'is-active' : ''} onClick={() => setActiveLevel(level)}>
                L{level}
              </button>
            ))}
        </div>
        <div className="designer-toolbar-group designer-toolbar-grow">
          <span className="designer-muted">Click a turnout to throw it · click a train to select it</span>
        </div>
      </div>
      <div className="designer-main live-main">
        <div className="designer-center" ref={canvasRef}>
          <LiveCanvas onToggleTurnout={(pieceId, state) => setTurnout.mutate({ pieceId, state })} />
        </div>
        <aside className="designer-right">
          <TrainPanel consists={consistsQuery.data ?? []} roster={rosterQuery.data ?? { trains: [], wagons: [] }} />
          <LayerToggles />
        </aside>
      </div>
    </div>
  );
}
