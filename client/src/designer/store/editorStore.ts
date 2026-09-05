import { create } from 'zustand';
import { getTrackDef } from '@shared/catalog/index.ts';
import { degToRad, type Frame, type Vec2 } from '@shared/geometry/frame.ts';
import { solveBiarc } from '@shared/geometry/flexSolver.ts';
import { buildPieceGeometry, type ConnectorId } from '@shared/geometry/pieceGeometry.ts';
import { pathLength } from '@shared/geometry/primitives.ts';
import { buildLayoutIndex, pieceFrameForConnectorAt, type LayoutIndex } from '@shared/layout/index.ts';
import {
  attachNewPiece,
  componentPieceIds,
  joinPorts,
  normalizeLayout,
  placeFreePiece,
  removeJoint,
  removePieces,
  rotateComponent,
  setJointForced,
  translateComponent,
  updatePiece,
  type PieceMeta,
} from '@shared/layout/ops.ts';
import {
  emptyLayout,
  getLevelHeightMm,
  type Destination,
  type LayoutDocument,
  type PlacedAccessory,
  type PortRef,
  type SpeedRestriction,
  type TrackBlock,
  type TrackPosition,
} from '@shared/layout/schema.ts';
import { newId } from '@shared/util/id.ts';
import { findPieceChain } from '../lib/blocks.ts';

export type EditorTool = 'select' | 'pan' | 'block' | 'destination' | 'speed' | 'accessory' | 'join';
export type DesignerView = '2d' | '3d';

export interface Camera {
  /** World mm at the top-left of the canvas. */
  x: number;
  y: number;
  /** Screen px per mm. */
  zoom: number;
}

export interface Placing {
  defId: string;
  /** Which connector of the new piece is held at the cursor / attached. */
  connectorId: ConnectorId;
  /** Heading used when dropping the piece free (no snap target). */
  theta: number;
}

export type BlockKind = 'block' | 'destination' | 'speed';

export interface Selection {
  pieceIds: string[];
  jointId: string | null;
  block: { kind: BlockKind; id: string } | null;
  accessoryId: string | null;
}

const MAX_HISTORY = 100;

const EMPTY_SELECTION: Selection = { pieceIds: [], jointId: null, block: null, accessoryId: null };

interface EditorState {
  doc: LayoutDocument;
  index: LayoutIndex;
  hydrated: boolean;
  dirty: boolean;
  past: LayoutDocument[];
  future: LayoutDocument[];
  selection: Selection;
  tool: EditorTool;
  view: DesignerView;
  placing: Placing | null;
  accessoryDefId: string;
  pendingAnchor: TrackPosition | null;
  /** First port picked with the join tool. */
  pendingPort: PortRef | null;
  camera: Camera;
  showAllLevels: boolean;
  saveStatus: string;
  /** Pieces from a photo import that the model was unsure about; drawn for review. */
  flaggedPieceIds: Set<string>;
  photoImportOpen: boolean;

  hydrate: (doc: LayoutDocument) => void;
  applyImport: (doc: LayoutDocument, pieceIds: string[], flagged: Set<string>) => void;
  clearFlags: () => void;
  setPhotoImportOpen: (open: boolean) => void;
  commit: (doc: LayoutDocument) => void;
  replaceDoc: (doc: LayoutDocument) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (status: string) => void;

  setTool: (tool: EditorTool) => void;
  setView: (view: DesignerView) => void;
  setCamera: (camera: Partial<Camera>) => void;
  zoomAt: (screen: Vec2, factor: number) => void;
  fitToContent: (width: number, height: number) => void;
  setShowAllLevels: (v: boolean) => void;
  setActiveLevel: (level: number) => void;
  setLevelHeight: (level: number, heightMm: number) => void;
  setLayoutName: (name: string) => void;

  select: (selection: Partial<Selection>, additive?: boolean) => void;
  clearSelection: () => void;

  startPlacing: (defId: string) => void;
  cyclePlacingConnector: () => void;
  rotatePlacing: (deltaRad: number) => void;
  cancelPlacing: () => void;
  dropPlacing: (target: PortRef | null, freeFrame: Frame | null) => void;
  setAccessoryDef: (defId: string) => void;

  beginDrag: () => void;
  dragSelectedBy: (dx: number, dy: number) => void;
  endDrag: (join: { a: PortRef; b: PortRef } | null) => void;
  rotateSelected: (deltaDeg: number) => void;
  deleteSelected: () => void;
  updateSelectedPiece: (patch: PieceMeta) => void;
  setPieceLevel: (pieceIds: string[], level: number) => void;

  joinPortPair: (a: PortRef, b: PortRef) => void;
  setPendingPort: (port: PortRef | null) => void;
  breakJoint: (jointId: string) => void;
  forceJoint: (jointId: string, forced: boolean) => void;
  solveFlexToPort: (pieceId: string, target: PortRef) => string | null;
  setFlexLength: (pieceId: string, lengthMm: number) => void;

  setPendingAnchor: (anchor: TrackPosition | null) => void;
  addBlockBetween: (kind: BlockKind, a: TrackPosition, b: TrackPosition) => string | null;
  updateBlock: (kind: BlockKind, id: string, patch: Partial<TrackBlock & Destination & SpeedRestriction>) => void;
  removeBlock: (kind: BlockKind, id: string) => void;

  addAccessory: (acc: Omit<PlacedAccessory, 'id'>) => void;
  updateAccessory: (id: string, patch: Partial<PlacedAccessory>) => void;
  removeAccessory: (id: string) => void;
}

function blockListKey(kind: BlockKind): 'trackBlocks' | 'destinations' | 'speedRestrictions' {
  return kind === 'block' ? 'trackBlocks' : kind === 'destination' ? 'destinations' : 'speedRestrictions';
}

function pruneSelection(selection: Selection, doc: LayoutDocument): Selection {
  const pieceIds = selection.pieceIds.filter((id) => doc.pieces.some((p) => p.id === id));
  const jointId = selection.jointId && doc.joints.some((j) => j.id === selection.jointId) ? selection.jointId : null;
  const block =
    selection.block && doc[blockListKey(selection.block.kind)].some((b) => b.id === selection.block!.id) ? selection.block : null;
  const accessoryId = selection.accessoryId && doc.accessories.some((a) => a.id === selection.accessoryId) ? selection.accessoryId : null;
  return { pieceIds, jointId, block, accessoryId };
}

export const useEditorStore = create<EditorState>()((set, get) => {
  const applyDoc = (doc: LayoutDocument, undoable: boolean) => {
    const state = get();
    set({
      doc,
      index: buildLayoutIndex(doc),
      dirty: true,
      past: undoable ? [...state.past.slice(-(MAX_HISTORY - 1)), state.doc] : state.past,
      future: undoable ? [] : state.future,
      selection: pruneSelection(state.selection, doc),
    });
  };

  const initial = emptyLayout();
  return {
    doc: initial,
    index: buildLayoutIndex(initial),
    hydrated: false,
    dirty: false,
    past: [],
    future: [],
    selection: EMPTY_SELECTION,
    tool: 'select',
    view: '2d',
    placing: null,
    accessoryDefId: 'signal-2',
    pendingAnchor: null,
    pendingPort: null,
    camera: { x: -200, y: -200, zoom: 0.35 },
    showAllLevels: false,
    saveStatus: '',
    flaggedPieceIds: new Set(),
    photoImportOpen: false,

    hydrate: (doc) => set({ doc, index: buildLayoutIndex(doc), hydrated: true, dirty: false, past: [], future: [], selection: EMPTY_SELECTION }),
    applyImport: (doc, pieceIds, flagged) => {
      applyDoc(doc, true);
      set({ flaggedPieceIds: flagged, selection: { ...EMPTY_SELECTION, pieceIds }, photoImportOpen: false });
    },
    clearFlags: () => set({ flaggedPieceIds: new Set() }),
    setPhotoImportOpen: (photoImportOpen) => set({ photoImportOpen }),
    commit: (doc) => applyDoc(doc, true),
    replaceDoc: (doc) => applyDoc(doc, false),
    undo: () => {
      const { past, doc, future, selection } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ doc: prev, index: buildLayoutIndex(prev), past: past.slice(0, -1), future: [doc, ...future], dirty: true, selection: pruneSelection(selection, prev) });
    },
    redo: () => {
      const { past, doc, future, selection } = get();
      const next = future[0];
      if (!next) return;
      set({ doc: next, index: buildLayoutIndex(next), past: [...past, doc], future: future.slice(1), dirty: true, selection: pruneSelection(selection, next) });
    },
    markSaved: (status) => set({ saveStatus: status, dirty: status.startsWith('Saved') ? false : get().dirty }),

    setTool: (tool) => set({ tool, placing: null, pendingAnchor: null, pendingPort: null }),
    setView: (view) => set({ view }),
    setCamera: (camera) => set({ camera: { ...get().camera, ...camera } }),
    zoomAt: (screen, factor) => {
      const cam = get().camera;
      const zoom = Math.min(6, Math.max(0.05, cam.zoom * factor));
      // Keep the world point under the cursor fixed.
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
      if (!Number.isFinite(minX)) {
        set({ camera: { x: -width / 2, y: -height / 2, zoom: 0.5 } });
        return;
      }
      const pad = 150;
      const zoom = Math.min(6, Math.max(0.05, Math.min(width / (maxX - minX + 2 * pad), height / (maxY - minY + 2 * pad))));
      set({ camera: { zoom, x: (minX + maxX) / 2 - width / zoom / 2, y: (minY + maxY) / 2 - height / zoom / 2 } });
    },
    setShowAllLevels: (showAllLevels) => set({ showAllLevels }),
    setActiveLevel: (level) => applyDoc({ ...get().doc, activeLevel: Math.max(0, level) }, false),
    setLevelHeight: (level, heightMm) => {
      const doc = get().doc;
      const levelHeightsMm = { ...(doc.levelHeightsMm ?? {}), [String(level)]: heightMm };
      const pieces = doc.pieces.map((p) => (p.level === level ? { ...p, zMm: heightMm } : p));
      applyDoc(normalizeLayout({ ...doc, levelHeightsMm, pieces }), true);
    },
    setLayoutName: (name) => applyDoc({ ...get().doc, name }, false),

    select: (partial, additive = false) => {
      const cur = get().selection;
      const next: Selection = additive
        ? { ...cur, ...partial, pieceIds: partial.pieceIds ? [...new Set([...cur.pieceIds, ...partial.pieceIds])] : cur.pieceIds }
        : { ...EMPTY_SELECTION, ...partial };
      set({ selection: next });
    },
    clearSelection: () => set({ selection: EMPTY_SELECTION, pendingAnchor: null, pendingPort: null }),

    startPlacing: (defId) => {
      const def = getTrackDef(defId);
      if (!def) return;
      set({ placing: { defId, connectorId: 'A', theta: get().placing?.theta ?? 0 }, tool: 'select', selection: EMPTY_SELECTION });
    },
    cyclePlacingConnector: () => {
      const placing = get().placing;
      if (!placing) return;
      const def = getTrackDef(placing.defId)!;
      const geom = buildPieceGeometry(def);
      const ids = geom.connectors.filter((c) => !c.blocked).map((c) => c.id);
      const i = ids.indexOf(placing.connectorId);
      set({ placing: { ...placing, connectorId: ids[(i + 1) % ids.length]! } });
    },
    rotatePlacing: (deltaRad) => {
      const placing = get().placing;
      if (placing) set({ placing: { ...placing, theta: placing.theta + deltaRad } });
    },
    cancelPlacing: () => set({ placing: null }),
    dropPlacing: (target, freeFrame) => {
      const { placing, doc, index } = get();
      if (!placing) return;
      const def = getTrackDef(placing.defId)!;
      const meta: PieceMeta = def.kind === 'turnout' ? { switchTimeMs: 400 } : {};
      if (target) {
        const r = attachNewPiece(doc, placing.defId, placing.connectorId, target, meta, index);
        applyDoc(r.doc, true);
        set({ selection: { ...EMPTY_SELECTION, pieceIds: [r.pieceId] } });
      } else if (freeFrame) {
        const r = placeFreePiece(doc, placing.defId, freeFrame, meta);
        applyDoc(r.doc, true);
        set({ selection: { ...EMPTY_SELECTION, pieceIds: [r.pieceId] } });
      }
    },
    setAccessoryDef: (accessoryDefId) => set({ accessoryDefId }),

    beginDrag: () => {
      const state = get();
      set({ past: [...state.past.slice(-(MAX_HISTORY - 1)), state.doc], future: [] });
    },
    dragSelectedBy: (dx, dy) => {
      const { doc, index, selection } = get();
      const seenComponents = new Set<number>();
      let next = doc;
      let idx = index;
      for (const id of selection.pieceIds) {
        const view = idx.pieces.get(id);
        if (!view || seenComponents.has(view.component)) continue;
        seenComponents.add(view.component);
        next = translateComponent(next, id, dx, dy, idx);
        idx = buildLayoutIndex(next);
      }
      const accessories = next.accessories.map((a) =>
        a.id === selection.accessoryId && typeof a.x === 'number' && typeof a.y === 'number' ? { ...a, x: a.x + dx, y: a.y + dy } : a,
      );
      next = accessories !== next.accessories ? { ...next, accessories } : next;
      set({ doc: next, index: idx === index ? buildLayoutIndex(next) : idx, dirty: true });
    },
    endDrag: (join) => {
      if (join) {
        const { doc, index } = get();
        try {
          applyDoc(joinPorts(doc, join.a, join.b, index).doc, false);
        } catch {
          // ports became invalid during the drag; keep the moved position
        }
      }
    },
    rotateSelected: (deltaDeg) => {
      const { doc, index, selection } = get();
      if (!selection.pieceIds.length) return;
      // Pivot: centroid of the selected pieces' connector positions.
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const id of selection.pieceIds) {
        const view = index.pieces.get(id);
        if (!view) continue;
        for (const f of view.connectorWorld.values()) {
          sx += f.x;
          sy += f.y;
          n++;
        }
      }
      if (!n) return;
      const pivot = { x: sx / n, y: sy / n };
      const seen = new Set<number>();
      let next = doc;
      let idx = index;
      for (const id of selection.pieceIds) {
        const view = idx.pieces.get(id);
        if (!view || seen.has(view.component)) continue;
        seen.add(view.component);
        next = rotateComponent(next, id, pivot, degToRad(deltaDeg), idx);
        idx = buildLayoutIndex(next);
      }
      applyDoc(next, true);
    },
    deleteSelected: () => {
      const { doc, selection } = get();
      let next = doc;
      if (selection.pieceIds.length) next = removePieces(next, selection.pieceIds);
      if (selection.jointId) next = removeJoint(next, selection.jointId);
      if (selection.block) {
        const key = blockListKey(selection.block.kind);
        next = { ...next, [key]: (next[key] as { id: string }[]).filter((b) => b.id !== selection.block!.id) };
      }
      if (selection.accessoryId) next = { ...next, accessories: next.accessories.filter((a) => a.id !== selection.accessoryId) };
      if (next !== doc) {
        applyDoc(next, true);
        set({ selection: EMPTY_SELECTION });
      }
    },
    updateSelectedPiece: (patch) => {
      const { doc, selection } = get();
      let next = doc;
      for (const id of selection.pieceIds) next = updatePiece(next, id, patch);
      applyDoc(next, true);
    },
    setPieceLevel: (pieceIds, level) => {
      const doc = get().doc;
      const zMm = getLevelHeightMm(doc, level);
      const ids = new Set(pieceIds);
      applyDoc(normalizeLayout({ ...doc, pieces: doc.pieces.map((p) => (ids.has(p.id) ? { ...p, level, zMm } : p)) }), true);
    },

    joinPortPair: (a, b) => {
      const { doc, index } = get();
      const r = joinPorts(doc, a, b, index);
      applyDoc(r.doc, true);
      set({ selection: { ...EMPTY_SELECTION, jointId: r.jointId }, pendingPort: null });
    },
    setPendingPort: (pendingPort) => set({ pendingPort }),
    breakJoint: (jointId) => {
      applyDoc(removeJoint(get().doc, jointId), true);
      set({ selection: EMPTY_SELECTION });
    },
    forceJoint: (jointId, forced) => applyDoc(setJointForced(get().doc, jointId, forced), true),
    solveFlexToPort: (pieceId, target) => {
      const { doc, index } = get();
      const view = index.pieces.get(pieceId);
      const targetView = index.pieces.get(target.pieceId);
      if (!view || !targetView || view.def.kind !== 'flex') return 'Select a flex rail first';
      // The flex's joined end stays, the free end must reach the target.
      const aJoined = index.jointByPort.has(`${pieceId}:A`);
      const bJoined = index.jointByPort.has(`${pieceId}:B`);
      if (aJoined && bJoined) return 'Both ends of the flex rail are already coupled';
      const targetWorld = targetView.connectorWorld.get(target.connectorId)!;
      const end: Frame = { x: targetWorld.x, y: targetWorld.y, theta: targetWorld.theta + Math.PI };
      const startConnector: ConnectorId = aJoined ? 'A' : bJoined ? 'B' : 'A';
      const startWorld = view.connectorWorld.get(startConnector)!;
      const start: Frame = { x: startWorld.x, y: startWorld.y, theta: startWorld.theta + Math.PI };
      const solution = solveBiarc(start, end);
      if (!solution) return 'No smooth curve connects these two ends';
      if (solution.lengthMm > view.def.maxLengthMm) return `Needs ${solution.lengthMm.toFixed(0)} mm, flex rail is ${view.def.maxLengthMm} mm max`;
      if (solution.minRadiusMm < view.def.minRadiusMm) return `Radius ${solution.minRadiusMm.toFixed(0)} mm is below the ${view.def.minRadiusMm} mm minimum`;
      // The solved shape always runs A → B; when the coupled end is B, mirror by re-anchoring the frame at A.
      let next = updatePiece(doc, pieceId, { flexShape: solution.primitives });
      let freeEnd: ConnectorId = 'B';
      if (startConnector === 'B') {
        const geom = buildPieceGeometry(view.def, solution.primitives);
        // Place the new A at the old B position pointing into the piece: frame that puts connector A at `start`.
        const frame = pieceFrameForConnectorAt(geom, 'A', { x: start.x, y: start.y, theta: start.theta + Math.PI });
        const joint = index.jointByPort.get(`${pieceId}:B`)!;
        next = removeJoint(next, joint.id);
        next = normalizeLayout({ ...next, pieces: next.pieces.map((p) => (p.id === pieceId ? { ...p, frame } : p)) });
        const other = joint.a.pieceId === pieceId ? joint.b : joint.a;
        next = joinPorts(next, { pieceId, connectorId: 'A' }, other).doc;
        freeEnd = 'B';
      }
      const r = joinPorts(next, { pieceId, connectorId: freeEnd }, target);
      applyDoc(r.doc, true);
      set({ selection: { ...EMPTY_SELECTION, pieceIds: [pieceId] } });
      return null;
    },
    setFlexLength: (pieceId, lengthMm) => {
      const { index } = get();
      const view = index.pieces.get(pieceId);
      if (!view || view.def.kind !== 'flex') return;
      const len = Math.min(view.def.maxLengthMm, Math.max(40, lengthMm));
      const doc = get().doc;
      const bJoint = index.jointByPort.get(`${pieceId}:B`);
      let next = bJoint ? removeJoint(doc, bJoint.id) : doc;
      next = updatePiece(next, pieceId, { flexShape: [{ kind: 'line', length: len }] });
      applyDoc(next, true);
    },

    setPendingAnchor: (pendingAnchor) => set({ pendingAnchor }),
    addBlockBetween: (kind, a, b) => {
      const { doc, index } = get();
      const chain = findPieceChain(index, a.pieceId, b.pieceId);
      if (!chain) return null;
      const level = index.pieces.get(a.pieceId)?.piece.level ?? doc.activeLevel;
      const base: TrackBlock = { id: newId(kind === 'block' ? 'blk' : kind === 'destination' ? 'dst' : 'spd'), level, start: a, end: b, pieceIds: chain };
      let next: LayoutDocument;
      if (kind === 'block') next = { ...doc, trackBlocks: [...doc.trackBlocks, base] };
      else if (kind === 'destination') next = { ...doc, destinations: [...doc.destinations, { ...base, name: `Destination ${doc.destinations.length + 1}` }] };
      else next = { ...doc, speedRestrictions: [...doc.speedRestrictions, { ...base, maxSpeedStep: 8 }] };
      applyDoc(next, true);
      set({ selection: { ...EMPTY_SELECTION, block: { kind, id: base.id } }, pendingAnchor: null });
      return base.id;
    },
    updateBlock: (kind, id, patch) => {
      const doc = get().doc;
      const key = blockListKey(kind);
      applyDoc({ ...doc, [key]: (doc[key] as TrackBlock[]).map((b) => (b.id === id ? { ...b, ...patch } : b)) }, true);
    },
    removeBlock: (kind, id) => {
      const doc = get().doc;
      const key = blockListKey(kind);
      applyDoc({ ...doc, [key]: (doc[key] as TrackBlock[]).filter((b) => b.id !== id) }, true);
      set({ selection: EMPTY_SELECTION });
    },

    addAccessory: (acc) => {
      const doc = get().doc;
      const full: PlacedAccessory = { ...acc, id: newId('acc') };
      applyDoc({ ...doc, accessories: [...doc.accessories, full] }, true);
      set({ selection: { ...EMPTY_SELECTION, accessoryId: full.id } });
    },
    updateAccessory: (id, patch) => {
      const doc = get().doc;
      applyDoc({ ...doc, accessories: doc.accessories.map((a) => (a.id === id ? { ...a, ...patch } : a)) }, true);
    },
    removeAccessory: (id) => {
      const doc = get().doc;
      applyDoc({ ...doc, accessories: doc.accessories.filter((a) => a.id !== id) }, true);
      set({ selection: EMPTY_SELECTION });
    },
  };
});

/** Piece ids that move together with the given selection (whole components). */
export function selectionComponents(index: LayoutIndex, pieceIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of pieceIds) for (const pid of componentPieceIds(index, id)) out.add(pid);
  return out;
}

/** Path length helper used by inspector fields. */
export function pathLengthMm(index: LayoutIndex, pos: TrackPosition): number {
  const view = index.pieces.get(pos.pieceId);
  const path = view?.geom.paths.find((p) => p.id === pos.pathId);
  return path ? pathLength(path.primitives) : 0;
}
