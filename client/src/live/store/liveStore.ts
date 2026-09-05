import { create } from 'zustand';
import type { DispatchJob } from '@shared/domain/dispatch.ts';
import type { Consist, LiveTrain, Traversal } from '@shared/domain/train.ts';
import type { Claim, LiveSnapshot, SafetyState, SensorState, TurnoutSnapshot } from '@shared/events/live.ts';
import { buildLayoutIndex, type LayoutIndex } from '@shared/layout/index.ts';
import { emptyLayout, type LayoutDocument, type TrackPosition } from '@shared/layout/schema.ts';
import type { Camera } from '../../designer/store/editorStore.ts';

export interface LiveLayers {
  rails: boolean;
  trains: boolean;
  arrows: boolean;
  occupancy: boolean;
  claims: boolean;
  turnouts: boolean;
  stations: boolean;
  sensors: boolean;
  speeds: boolean;
  debug: boolean;
}

export interface PlacementDraft {
  consistId: string;
  /** Picked track position for the nose. */
  front: TrackPosition | null;
  /** Facing along the path (+1 = toward the path's `to` connector). */
  dir: 1 | -1;
}

interface LiveState {
  doc: LayoutDocument;
  index: LayoutIndex;
  layoutLoaded: boolean;
  trains: Map<string, LiveTrain>;
  turnouts: Map<string, TurnoutSnapshot>;
  sensors: Map<number, SensorState>;
  claims: Claim[];
  safety: SafetyState;
  simulationMode: boolean;
  dispatchJobs: DispatchJob[];
  consists: Consist[];
  connected: boolean;
  camera: Camera;
  activeLevel: number;
  showAllLevels: boolean;
  layers: LiveLayers;
  selectedConsistId: string | null;
  placement: PlacementDraft | null;
  hoverTrack: TrackPosition | null;

  setLayout: (doc: LayoutDocument) => void;
  applySnapshot: (snapshot: LiveSnapshot) => void;
  upsertTrain: (train: LiveTrain) => void;
  removeTrain: (consistId: string) => void;
  setTurnout: (pieceId: string, state: string) => void;
  setSensor: (sensor: SensorState) => void;
  setClaims: (claims: Claim[]) => void;
  setSafety: (safety: SafetyState) => void;
  setDispatchJobs: (jobs: DispatchJob[]) => void;
  setConsists: (consists: Consist[]) => void;
  setConnected: (connected: boolean) => void;
  setCamera: (camera: Partial<Camera>) => void;
  zoomAt: (screen: { x: number; y: number }, factor: number) => void;
  fitToContent: (width: number, height: number) => void;
  setActiveLevel: (level: number) => void;
  setShowAllLevels: (v: boolean) => void;
  toggleLayer: (layer: keyof LiveLayers) => void;
  selectConsist: (consistId: string | null) => void;
  startPlacement: (consistId: string) => void;
  setPlacementFront: (front: TrackPosition | null) => void;
  flipPlacementDir: () => void;
  cancelPlacement: () => void;
  setHoverTrack: (pos: TrackPosition | null) => void;
}

export const DEFAULT_LIVE_LAYERS: LiveLayers = {
  rails: true,
  trains: true,
  arrows: true,
  occupancy: true,
  claims: true,
  turnouts: true,
  stations: true,
  sensors: false,
  speeds: false,
  debug: false,
};

export const useLiveStore = create<LiveState>()((set, get) => {
  const initial = emptyLayout();
  return {
    doc: initial,
    index: buildLayoutIndex(initial),
    layoutLoaded: false,
    trains: new Map(),
    turnouts: new Map(),
    sensors: new Map(),
    claims: [],
    safety: { level: 'NORMAL', reasons: [], updatedAt: 0 },
    simulationMode: true,
    dispatchJobs: [],
    consists: [],
    connected: false,
    camera: { x: -200, y: -200, zoom: 0.35 },
    activeLevel: 0,
    showAllLevels: true,
    layers: DEFAULT_LIVE_LAYERS,
    selectedConsistId: null,
    placement: null,
    hoverTrack: null,

    setLayout: (doc) => set({ doc, index: buildLayoutIndex(doc), layoutLoaded: true, activeLevel: doc.activeLevel }),
    applySnapshot: (snapshot) =>
      set({
        trains: new Map(snapshot.trains.map((t) => [t.consistId, t])),
        turnouts: new Map(snapshot.turnouts.map((t) => [t.pieceId, t])),
        sensors: new Map((snapshot.sensors ?? []).map((s) => [s.sensorId, s])),
        claims: snapshot.claims ?? [],
        safety: snapshot.safety ?? get().safety,
        simulationMode: snapshot.simulationMode ?? get().simulationMode,
        dispatchJobs: snapshot.dispatchJobs ?? get().dispatchJobs,
      }),
    upsertTrain: (train) => set({ trains: new Map(get().trains).set(train.consistId, train) }),
    removeTrain: (consistId) => {
      const trains = new Map(get().trains);
      trains.delete(consistId);
      set({ trains });
    },
    setTurnout: (pieceId, state) => {
      const turnouts = new Map(get().turnouts);
      const cur = turnouts.get(pieceId);
      if (cur) turnouts.set(pieceId, { ...cur, state });
      set({ turnouts });
    },
    setSensor: (sensor) => set({ sensors: new Map(get().sensors).set(sensor.sensorId, sensor) }),
    setClaims: (claims) => set({ claims }),
    setSafety: (safety) => set({ safety }),
    setDispatchJobs: (dispatchJobs) => set({ dispatchJobs }),
    setConsists: (consists) => set({ consists }),
    setConnected: (connected) => set({ connected }),
    setCamera: (camera) => set({ camera: { ...get().camera, ...camera } }),
    zoomAt: (screen, factor) => {
      const cam = get().camera;
      const zoom = Math.min(6, Math.max(0.05, cam.zoom * factor));
      const wx = cam.x + screen.x / cam.zoom;
      const wy = cam.y + screen.y / cam.zoom;
      set({ camera: { zoom, x: wx - screen.x / zoom, y: wy - screen.y / zoom } });
    },
    fitToContent: (width, height) => {
      const { index } = get();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const view of index.pieces.values()) {
        for (const f of view.connectorWorld.values()) {
          minX = Math.min(minX, f.x);
          minY = Math.min(minY, f.y);
          maxX = Math.max(maxX, f.x);
          maxY = Math.max(maxY, f.y);
        }
      }
      if (!Number.isFinite(minX)) return;
      const pad = 150;
      const zoom = Math.min(6, Math.max(0.05, Math.min(width / (maxX - minX + 2 * pad), height / (maxY - minY + 2 * pad))));
      set({ camera: { zoom, x: (minX + maxX) / 2 - width / zoom / 2, y: (minY + maxY) / 2 - height / zoom / 2 } });
    },
    setActiveLevel: (activeLevel) => set({ activeLevel }),
    setShowAllLevels: (showAllLevels) => set({ showAllLevels }),
    toggleLayer: (layer) => set({ layers: { ...get().layers, [layer]: !get().layers[layer] } }),
    selectConsist: (selectedConsistId) => set({ selectedConsistId }),
    startPlacement: (consistId) => set({ placement: { consistId, front: null, dir: 1 }, selectedConsistId: consistId }),
    setPlacementFront: (front) => {
      const p = get().placement;
      if (p) set({ placement: { ...p, front } });
    },
    flipPlacementDir: () => {
      const p = get().placement;
      if (p) set({ placement: { ...p, dir: p.dir === 1 ? -1 : 1 } });
    },
    cancelPlacement: () => set({ placement: null }),
    setHoverTrack: (hoverTrack) => set({ hoverTrack }),
  };
});

export function placementTraversal(p: PlacementDraft): Traversal | null {
  return p.front ? { pos: p.front, dir: p.dir } : null;
}
