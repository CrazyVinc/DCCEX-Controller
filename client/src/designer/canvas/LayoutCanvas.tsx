import { Application, useApplication } from '@pixi/react';
import { useEffect, useRef, type RefObject } from 'react';
import { degToRad, type Vec2 } from '@shared/geometry/frame.ts';
import { getAccessoryDef } from '../data/accessoryCatalog.ts';
import { selectionComponents, useEditorStore, type EditorTool } from '../store/editorStore.ts';
import { findDragJoin, ghostPlacement, pickBlockLabel, pickJoint, pickOpenPort, pickTrack, visiblePieceIds, type GhostPlacement } from './picking.ts';
import { TrackScene } from './TrackScene.ts';

const PICK_TOL_PX = 12;
const SNAP_TOL_PX = 26;
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  kind: 'pan' | 'move';
  startScreen: Vec2;
  lastWorld: Vec2;
  cameraStart: { x: number; y: number };
  started: boolean;
  movedPieceIds: Set<string>;
}

function screenToWorld(camera: { x: number; y: number; zoom: number }, screen: Vec2): Vec2 {
  return { x: camera.x + screen.x / camera.zoom, y: camera.y + screen.y / camera.zoom };
}

function toolCursor(tool: EditorTool, placing: boolean, panning: boolean): string {
  if (panning || tool === 'pan') return 'grab';
  if (placing || tool === 'block' || tool === 'destination' || tool === 'speed' || tool === 'accessory' || tool === 'join') return 'crosshair';
  return 'default';
}

/** Bridges the Zustand editor store to the imperative Pixi scene and handles pointer input. */
function SceneBridge({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const { app, isInitialised } = useApplication();
  const ghostRef = useRef<GhostPlacement | null>(null);
  const hoverRef = useRef<{ piece: string | null; port: { pieceId: string; connectorId: 'A' | 'B' | 'C' | 'D' } | null }>({ piece: null, port: null });

  useEffect(() => {
    if (!isInitialised || !app.canvas) return;
    const scene = new TrackScene(app);
    const canvas = app.canvas as HTMLCanvasElement;
    const store = useEditorStore;
    let drag: DragState | null = null;
    let spaceHeld = false;

    const renderScene = () => {
      const s = store.getState();
      scene.render({
        index: s.index,
        camera: s.camera,
        selection: s.selection,
        activeLevel: s.doc.activeLevel,
        showAllLevels: s.showAllLevels,
        placing: s.placing,
        ghost: ghostRef.current,
        hoverPiece: hoverRef.current.piece,
        hoverPort: hoverRef.current.port,
        pendingAnchor: s.pendingAnchor,
        pendingPort: s.pendingPort,
        readOnly: false,
        flaggedPieceIds: s.flaggedPieceIds,
      });
      canvas.style.cursor = toolCursor(s.tool, s.placing != null, drag?.kind === 'pan' || spaceHeld);
    };

    const resize = () => {
      const el = host.current;
      if (!el) return;
      scene.resize(el.clientWidth, el.clientHeight);
      renderScene();
    };
    const ro = new ResizeObserver(resize);
    if (host.current) ro.observe(host.current);
    resize();

    const unsubscribe = store.subscribe(renderScene);

    const pointerPos = (e: PointerEvent | WheelEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const tolMm = () => PICK_TOL_PX / store.getState().camera.zoom;
    const snapMm = () => SNAP_TOL_PX / store.getState().camera.zoom;
    const visible = () => {
      const s = store.getState();
      return visiblePieceIds(s.index, s.doc.activeLevel, s.showAllLevels);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      if (s.placing && e.shiftKey) {
        s.rotatePlacing(degToRad(e.deltaY > 0 ? 15 : -15));
        updateGhost(screenToWorld(s.camera, pointerPos(e)));
        return;
      }
      s.zoomAt(pointerPos(e), e.deltaY > 0 ? 1 / 1.12 : 1.12);
    };

    const updateGhost = (world: Vec2) => {
      const s = store.getState();
      if (!s.placing) {
        if (ghostRef.current) {
          ghostRef.current = null;
          renderScene();
        }
        return;
      }
      ghostRef.current = ghostPlacement(s.index, visible(), s.placing, world, snapMm());
      renderScene();
    };

    const onPointerDown = (e: PointerEvent) => {
      const s = store.getState();
      const screen = pointerPos(e);
      const world = screenToWorld(s.camera, screen);
      canvas.setPointerCapture(e.pointerId);

      if (e.button === 1 || s.tool === 'pan' || spaceHeld || (e.button === 2 && !s.placing)) {
        drag = { kind: 'pan', startScreen: screen, lastWorld: world, cameraStart: { x: s.camera.x, y: s.camera.y }, started: true, movedPieceIds: new Set() };
        renderScene();
        return;
      }
      if (e.button !== 0) return;

      if (s.placing) {
        const ghost = ghostRef.current ?? ghostPlacement(s.index, visible(), s.placing, world, snapMm());
        if (ghost) s.dropPlacing(ghost.target, ghost.target ? null : ghost.frame);
        if (!e.shiftKey) {
          // Keep placing the same piece type for quick chains; Esc stops.
          updateGhost(world);
        }
        return;
      }

      if (s.tool === 'join') {
        const port = pickOpenPort(s.index, visible(), world, tolMm());
        if (!port) return;
        if (s.pendingPort && !(s.pendingPort.pieceId === port.ref.pieceId && s.pendingPort.connectorId === port.ref.connectorId)) {
          try {
            s.joinPortPair(s.pendingPort, port.ref);
          } catch {
            s.setPendingPort(null);
          }
        } else {
          s.setPendingPort(port.ref);
        }
        return;
      }

      if (s.tool === 'block' || s.tool === 'destination' || s.tool === 'speed') {
        const hit = pickTrack(s.index, visible(), world, tolMm());
        if (!hit) return;
        if (!s.pendingAnchor) {
          s.setPendingAnchor(hit.pos);
        } else {
          const kind = s.tool === 'block' ? 'block' : s.tool === 'destination' ? 'destination' : 'speed';
          const id = s.addBlockBetween(kind, s.pendingAnchor, hit.pos);
          if (!id) s.setPendingAnchor(hit.pos);
        }
        return;
      }

      if (s.tool === 'accessory') {
        const def = getAccessoryDef(s.accessoryDefId);
        if (!def) return;
        const level = s.doc.activeLevel;
        const zMm = s.index.pieces.values().next().value?.piece.zMm ?? 0;
        if (def.placement === 'aside') {
          s.addAccessory({ defId: def.id, x: world.x, y: world.y, rotationDeg: 0, level, zMm });
        } else {
          const hit = pickTrack(s.index, visible(), world, tolMm());
          if (hit) s.addAccessory({ defId: def.id, anchor: hit.pos, rotationDeg: 0, level, zMm });
        }
        return;
      }

      // Select tool
      const joint = pickJoint(s.index, visible(), world, tolMm() * 0.8);
      if (joint) {
        s.select({ jointId: joint.jointId });
        return;
      }
      // Station / block / speed labels select the block itself for editing.
      const label = pickBlockLabel(s.index, s.doc.activeLevel, s.showAllLevels, world, tolMm() * 2.5);
      if (label) {
        s.select({ block: { kind: label.kind, id: label.id } });
        return;
      }
      const hit = pickTrack(s.index, visible(), world, tolMm() * 2.2);
      if (hit) {
        const already = s.selection.pieceIds.includes(hit.pos.pieceId);
        if (e.shiftKey) s.select({ pieceIds: [hit.pos.pieceId] }, true);
        else if (!already) s.select({ pieceIds: [hit.pos.pieceId] });
        const moved = selectionComponents(store.getState().index, store.getState().selection.pieceIds);
        drag = { kind: 'move', startScreen: screen, lastWorld: world, cameraStart: { x: s.camera.x, y: s.camera.y }, started: false, movedPieceIds: moved };
        return;
      }
      // Accessories (aside) by proximity
      const accHit = s.doc.accessories.find((a) => typeof a.x === 'number' && typeof a.y === 'number' && Math.hypot(a.x - world.x, a.y - world.y) <= tolMm() * 2);
      if (accHit) {
        s.select({ accessoryId: accHit.id });
        drag = { kind: 'move', startScreen: screen, lastWorld: world, cameraStart: { x: s.camera.x, y: s.camera.y }, started: false, movedPieceIds: new Set() };
        return;
      }
      s.clearSelection();
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = store.getState();
      const screen = pointerPos(e);
      const world = screenToWorld(s.camera, screen);
      if (drag?.kind === 'pan') {
        const dx = (screen.x - drag.startScreen.x) / s.camera.zoom;
        const dy = (screen.y - drag.startScreen.y) / s.camera.zoom;
        s.setCamera({ x: drag.cameraStart.x - dx, y: drag.cameraStart.y - dy });
        return;
      }
      if (drag?.kind === 'move') {
        if (!drag.started) {
          if (Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < DRAG_THRESHOLD_PX) return;
          drag.started = true;
          s.beginDrag();
        }
        s.dragSelectedBy(world.x - drag.lastWorld.x, world.y - drag.lastWorld.y);
        drag.lastWorld = world;
        return;
      }
      if (s.placing) {
        updateGhost(world);
        return;
      }
      // Hover feedback
      const port = s.tool === 'join' || s.tool === 'select' ? pickOpenPort(s.index, visible(), world, tolMm()) : null;
      const hit = port ? null : pickTrack(s.index, visible(), world, tolMm() * 2.2);
      const nextPiece = hit?.pos.pieceId ?? null;
      const nextPort = port?.ref ?? null;
      if (nextPiece !== hoverRef.current.piece || nextPort?.pieceId !== hoverRef.current.port?.pieceId || nextPort?.connectorId !== hoverRef.current.port?.connectorId) {
        hoverRef.current = { piece: nextPiece, port: nextPort };
        renderScene();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const s = store.getState();
      if (drag?.kind === 'move' && drag.started && drag.movedPieceIds.size) {
        const join = findDragJoin(s.index, drag.movedPieceIds, snapMm(), degToRad(20));
        s.endDrag(join);
      }
      drag = null;
      renderScene();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const s = store.getState();
      if (editing) return;
      if (e.code === 'Space') {
        spaceHeld = true;
        renderScene();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === 'Escape') {
        if (s.placing) s.cancelPlacing();
        else s.clearSelection();
        ghostRef.current = null;
        renderScene();
        return;
      }
      if (e.key === 'Tab' && s.placing) {
        e.preventDefault();
        s.cyclePlacingConnector();
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (s.placing) s.rotatePlacing(degToRad(e.shiftKey ? -15 : 15));
        else s.rotateSelected(e.shiftKey ? -15 : 15);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelected();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const nudge = (dx: number, dy: number) => {
        if (!s.selection.pieceIds.length && !s.selection.accessoryId) return;
        e.preventDefault();
        s.beginDrag();
        s.dragSelectedBy(dx, dy);
      };
      if (e.key === 'ArrowUp') nudge(0, -step);
      else if (e.key === 'ArrowDown') nudge(0, step);
      else if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        renderScene();
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onLeave = () => {
      hoverRef.current = { piece: null, port: null };
      ghostRef.current = null;
      renderScene();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderScene();

    return () => {
      ro.disconnect();
      unsubscribe();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      scene.destroy();
    };
  }, [app, isInitialised, host]);

  return null;
}

export function LayoutCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={hostRef} className="designer-canvas">
      <Application resizeTo={hostRef} antialias background={0x0b1220} resolution={Math.min(2, window.devicePixelRatio || 1)} autoDensity>
        <SceneBridge host={hostRef} />
      </Application>
      <ScaleBar />
    </div>
  );
}

function ScaleBar() {
  const zoom = useEditorStore((s) => s.camera.zoom);
  const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000];
  const mm = candidates.find((c) => c * zoom >= 80) ?? 2000;
  return (
    <div className="designer-scalebar" aria-hidden="true">
      <div className="designer-scalebar-line" style={{ width: mm * zoom }} />
      <span>{mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`}</span>
    </div>
  );
}
