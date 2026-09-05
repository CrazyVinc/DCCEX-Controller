import { Application, useApplication } from '@pixi/react';
import { useEffect, useRef, type RefObject } from 'react';
import type { Vec2 } from '@shared/geometry/frame.ts';
import { nearestOnPath } from '@shared/geometry/nearest.ts';
import { trainWorldSegments } from '@shared/domain/trainGeometry.ts';
import { pickTrack, visiblePieceIds } from '../../designer/canvas/picking.ts';
import { TrackScene, type SceneLayers } from '../../designer/canvas/TrackScene.ts';
import { placementTraversal, useLiveStore } from '../store/liveStore.ts';
import { TrainLayer } from './TrainLayer.ts';

const PICK_TOL_PX = 14;
const EMPTY_SELECTION = { pieceIds: [], jointId: null, block: null, accessoryId: null };

interface Props {
  onToggleTurnout: (pieceId: string, nextState: string) => void;
}

function screenToWorld(camera: { x: number; y: number; zoom: number }, screen: Vec2): Vec2 {
  return { x: camera.x + screen.x / camera.zoom, y: camera.y + screen.y / camera.zoom };
}

function SceneBridge({ host, onToggleTurnout }: Props & { host: RefObject<HTMLDivElement | null> }) {
  const { app, isInitialised } = useApplication();
  const toggleRef = useRef(onToggleTurnout);
  toggleRef.current = onToggleTurnout;

  useEffect(() => {
    if (!isInitialised || !app.canvas) return;
    const scene = new TrackScene(app);
    const trains = new TrainLayer();
    scene.addOverlayLayer(trains.container);
    const canvas = app.canvas as HTMLCanvasElement;
    const store = useLiveStore;
    let pan: { start: Vec2; camera: { x: number; y: number }; moved: boolean } | null = null;
    let lastLayersKey = '';
    let sceneLayers: SceneLayers = { blocks: true, destinations: true, speeds: false, accessories: true, turnoutIds: true, turnoutRoutes: true };
    let turnoutStates = new Map<string, string>();
    let lastTurnouts: unknown = null;
    let occupied = new Set<string>();
    let lastTrains: unknown = null;
    let claimed = new Set<string>();
    let lastClaims: unknown = null;

    const render = () => {
      const s = store.getState();
      const layersKey = JSON.stringify(s.layers);
      if (layersKey !== lastLayersKey) {
        lastLayersKey = layersKey;
        sceneLayers = { blocks: s.layers.occupancy || s.layers.sensors, destinations: s.layers.stations, speeds: s.layers.speeds, accessories: true, turnoutIds: s.layers.turnouts, turnoutRoutes: s.layers.turnouts };
      }
      if (s.turnouts !== lastTurnouts) {
        lastTurnouts = s.turnouts;
        turnoutStates = new Map([...s.turnouts.values()].map((t) => [t.pieceId, t.state]));
      }
      if (s.trains !== lastTrains) {
        lastTrains = s.trains;
        occupied = new Set([...s.trains.values()].flatMap((t) => t.occupiedBlockIds));
      }
      if (s.claims !== lastClaims) {
        lastClaims = s.claims;
        claimed = new Set(s.claims.flatMap((c) => c.pieceIds));
      }
      scene.render({
        index: s.index,
        camera: s.camera,
        selection: EMPTY_SELECTION,
        activeLevel: s.activeLevel,
        showAllLevels: s.showAllLevels,
        placing: null,
        ghost: null,
        hoverPiece: null,
        pendingAnchor: s.placement?.front ?? null,
        pendingPort: null,
        hoverPort: null,
        readOnly: true,
        layers: sceneLayers,
        occupiedBlockIds: s.layers.occupancy ? occupied : new Set(),
        turnoutStates,
        claimedPieceIds: s.layers.claims ? claimed : new Set(),
      });
      const names = new Map(s.consists.map((c) => [c.id, c.name]));
      const ghostTraversal = s.placement ? placementTraversal(s.placement) : null;
      const ghostConsist = s.placement ? s.consists.find((c) => c.id === s.placement!.consistId) : null;
      trains.render({
        index: s.index,
        trains: s.layers.trains ? [...s.trains.values()] : [],
        names,
        turnoutStates: (id) => turnoutStates.get(id),
        selectedConsistId: s.selectedConsistId,
        showArrows: s.layers.arrows,
        zoom: s.camera.zoom,
        ghost: ghostTraversal && ghostConsist ? { front: ghostTraversal, lengthMm: (ghostConsist as { totalLengthMm?: number }).totalLengthMm ?? 0 } : null,
      });
      canvas.style.cursor = s.placement ? 'crosshair' : pan ? 'grabbing' : 'grab';
    };

    const resize = () => {
      const el = host.current;
      if (!el) return;
      scene.resize(el.clientWidth, el.clientHeight);
      render();
    };
    const ro = new ResizeObserver(resize);
    if (host.current) ro.observe(host.current);
    resize();
    const unsubscribe = store.subscribe(render);

    const pointerPos = (e: PointerEvent | WheelEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      store.getState().zoomAt(pointerPos(e), e.deltaY > 0 ? 1 / 1.12 : 1.12);
    };
    const onPointerDown = (e: PointerEvent) => {
      const s = store.getState();
      canvas.setPointerCapture(e.pointerId);
      pan = { start: pointerPos(e), camera: { x: s.camera.x, y: s.camera.y }, moved: false };
    };
    const onPointerMove = (e: PointerEvent) => {
      const s = store.getState();
      const screen = pointerPos(e);
      if (pan) {
        const dx = (screen.x - pan.start.x) / s.camera.zoom;
        const dy = (screen.y - pan.start.y) / s.camera.zoom;
        if (!pan.moved && Math.hypot(screen.x - pan.start.x, screen.y - pan.start.y) < 4) return;
        pan.moved = true;
        s.setCamera({ x: pan.camera.x - dx, y: pan.camera.y - dy });
        return;
      }
      if (s.placement) {
        const world = screenToWorld(s.camera, screen);
        const hit = pickTrack(s.index, visiblePieceIds(s.index, s.activeLevel, s.showAllLevels), world, PICK_TOL_PX / s.camera.zoom);
        s.setHoverTrack(hit?.pos ?? null);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const wasClick = pan && !pan.moved;
      pan = null;
      const s = store.getState();
      if (!wasClick) {
        render();
        return;
      }
      const world = screenToWorld(s.camera, pointerPos(e));
      const tol = PICK_TOL_PX / s.camera.zoom;
      const visible = visiblePieceIds(s.index, s.activeLevel, s.showAllLevels);

      if (s.placement) {
        const hit = pickTrack(s.index, visible, world, tol * 1.5);
        if (hit) s.setPlacementFront(hit.pos);
        return;
      }

      // Train under the cursor?
      for (const train of s.trains.values()) {
        if (!train.pose || !s.index.pieces.has(train.pose.front.pos.pieceId)) continue;
        for (const seg of trainWorldSegments(s.index, train.pose, train.totalLengthMm, (id) => s.turnouts.get(id)?.state)) {
          if (nearestOnPath(seg.primitives, seg.start, world).distance <= 22) {
            s.selectConsist(train.consistId);
            return;
          }
        }
      }

      // Turnout under the cursor → cycle its state.
      const hit = pickTrack(s.index, visible, world, tol * 1.5);
      if (hit) {
        const turnout = s.turnouts.get(hit.pos.pieceId);
        if (turnout) {
          const ids = turnout.states.map((st) => st.id);
          const next = ids[(ids.indexOf(turnout.state) + 1) % ids.length]!;
          toggleRef.current(hit.pos.pieceId, next);
          return;
        }
      }
      s.selectConsist(null);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    render();

    return () => {
      ro.disconnect();
      unsubscribe();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      trains.destroy();
      scene.destroy();
    };
  }, [app, isInitialised, host]);

  return null;
}

export function LiveCanvas(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={hostRef} className="designer-canvas">
      <Application resizeTo={hostRef} antialias background={0x0b1220} resolution={Math.min(2, window.devicePixelRatio || 1)} autoDensity>
        <SceneBridge host={hostRef} {...props} />
      </Application>
    </div>
  );
}
