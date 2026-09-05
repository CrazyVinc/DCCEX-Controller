import { Application, Container, Graphics, Text } from 'pixi.js';
import { getTrackDef } from '@shared/catalog/index.ts';
import { compose, type Frame, type Vec2 } from '@shared/geometry/frame.ts';
import { buildPieceGeometry, pathStartFrame, getConnector } from '@shared/geometry/pieceGeometry.ts';
import { blockWorldSegments } from '@shared/layout/blockGeometry.ts';
import { pathWorldStart, unresolvedGaps, type LayoutIndex } from '@shared/layout/index.ts';
import type { PlacedAccessory, PortRef, TrackBlock, TrackPosition } from '@shared/layout/schema.ts';
import { pathPoseAt } from '@shared/geometry/primitives.ts';
import type { Camera, Placing, Selection } from '../store/editorStore.ts';
import { drawTrackPath, tracePath, trackStyleFor } from './drawing.ts';
import type { GhostPlacement } from './picking.ts';

export interface SceneLayers {
  blocks: boolean;
  destinations: boolean;
  speeds: boolean;
  accessories: boolean;
  turnoutIds: boolean;
  /** Draw the currently set turnout route brighter and the others dimmed. */
  turnoutRoutes: boolean;
}

export const DEFAULT_LAYERS: SceneLayers = { blocks: true, destinations: true, speeds: true, accessories: true, turnoutIds: true, turnoutRoutes: false };

export interface SceneState {
  index: LayoutIndex;
  camera: Camera;
  selection: Selection;
  activeLevel: number;
  showAllLevels: boolean;
  placing: Placing | null;
  ghost: GhostPlacement | null;
  hoverPiece: string | null;
  pendingAnchor: TrackPosition | null;
  pendingPort: PortRef | null;
  hoverPort: PortRef | null;
  /** Live map: no editing affordances (open ports, joints, ghosts). */
  readOnly: boolean;
  layers?: SceneLayers;
  /** Live map: blocks currently occupied by a train. */
  occupiedBlockIds?: Set<string>;
  /** Live map: current turnout positions (`pieceId` → state id). */
  turnoutStates?: Map<string, string>;
  /** Live map: pieces claimed per consist (colour hint). */
  claimedPieceIds?: Set<string>;
  /** Designer: imported pieces the vision model was unsure about (orange). */
  flaggedPieceIds?: Set<string>;
}

const ACCENT = 0x38bdf8;
const GRID_MINOR = 100;
const GRID_MAJOR = 500;

/**
 * Imperative Pixi scene for the plan view. All drawing happens in world millimetres
 * inside `world`; the camera only changes that container's transform.
 */
export class TrackScene {
  readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly tracksInactive = new Graphics();
  private readonly tracks = new Graphics();
  private readonly overlays = new Graphics();
  private readonly ports = new Graphics();
  private readonly ghostLayer = new Graphics();
  private readonly labels = new Container();
  private width = 0;
  private height = 0;
  private lastState: SceneState | null = null;

  constructor(private readonly app: Application) {
    this.world.addChild(this.grid, this.tracksInactive, this.tracks, this.overlays, this.ports, this.ghostLayer, this.labels);
    app.stage.addChild(this.world);
  }

  destroy(): void {
    this.app.stage.removeChild(this.world);
    this.world.destroy({ children: true });
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.lastState) this.applyCamera(this.lastState.camera);
  }

  render(state: SceneState): void {
    const prev = this.lastState;
    this.lastState = state;
    this.applyCamera(state.camera);
    const structural =
      !prev ||
      prev.index !== state.index ||
      prev.selection !== state.selection ||
      prev.activeLevel !== state.activeLevel ||
      prev.showAllLevels !== state.showAllLevels ||
      prev.hoverPiece !== state.hoverPiece ||
      prev.layers !== state.layers ||
      prev.occupiedBlockIds !== state.occupiedBlockIds ||
      prev.turnoutStates !== state.turnoutStates ||
      prev.claimedPieceIds !== state.claimedPieceIds ||
      prev.flaggedPieceIds !== state.flaggedPieceIds;
    if (structural) {
      this.drawTracks(state);
      this.drawOverlays(state);
    }
    if (structural || prev.pendingPort !== state.pendingPort || prev.hoverPort !== state.hoverPort || prev.camera.zoom !== state.camera.zoom) {
      if (state.readOnly) this.ports.clear();
      else this.drawPorts(state);
    }
    if (structural || prev.ghost !== state.ghost || prev.pendingAnchor !== state.pendingAnchor) {
      this.drawGhost(state);
    }
  }

  private applyCamera(camera: Camera): void {
    this.world.scale.set(camera.zoom);
    this.world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
    this.drawGrid(camera);
    for (const child of this.labels.children) child.scale.set(1 / camera.zoom);
  }

  private drawGrid(camera: Camera): void {
    const g = this.grid;
    g.clear();
    if (!this.width || !this.height) return;
    const x0 = camera.x;
    const y0 = camera.y;
    const x1 = camera.x + this.width / camera.zoom;
    const y1 = camera.y + this.height / camera.zoom;
    const minorVisible = GRID_MINOR * camera.zoom >= 12;
    const step = minorVisible ? GRID_MINOR : GRID_MAJOR;
    const startX = Math.floor(x0 / step) * step;
    const startY = Math.floor(y0 / step) * step;
    for (let x = startX; x <= x1; x += step) {
      g.moveTo(x, y0).lineTo(x, y1);
      g.stroke({ width: (x % GRID_MAJOR === 0 ? 1.4 : 0.6) / camera.zoom, color: x % GRID_MAJOR === 0 ? 0x1e2a44 : 0x141c30 });
    }
    for (let y = startY; y <= y1; y += step) {
      g.moveTo(x0, y).lineTo(x1, y);
      g.stroke({ width: (y % GRID_MAJOR === 0 ? 1.4 : 0.6) / camera.zoom, color: y % GRID_MAJOR === 0 ? 0x1e2a44 : 0x141c30 });
    }
    // Origin axes
    g.moveTo(x0, 0).lineTo(x1, 0);
    g.moveTo(0, y0).lineTo(0, y1);
    g.stroke({ width: 1.5 / camera.zoom, color: 0x334155 });
  }

  private drawTracks(state: SceneState): void {
    const { index, selection, activeLevel, showAllLevels, hoverPiece, turnoutStates, claimedPieceIds } = state;
    const layers = state.layers ?? DEFAULT_LAYERS;
    const selected = new Set(selection.pieceIds);
    this.tracks.clear();
    this.tracksInactive.clear();
    for (const view of index.pieces.values()) {
      const active = showAllLevels || view.piece.level === activeLevel;
      const g = active ? this.tracks : this.tracksInactive;
      const style = trackStyleFor(view.def.system);
      const highlight = selected.has(view.piece.id)
        ? ACCENT
        : state.flaggedPieceIds?.has(view.piece.id)
          ? 0xf97316
          : hoverPiece === view.piece.id
            ? 0x64748b
            : claimedPieceIds?.has(view.piece.id)
              ? 0x0ea5e9
              : null;
      const alpha = active ? 1 : 0.28;
      const currentState = view.geom.states ? (turnoutStates?.get(view.piece.id) ?? view.geom.defaultState) : undefined;
      const openPaths = currentState ? new Set(view.geom.states!.find((s) => s.id === currentState)?.paths ?? []) : null;
      for (const path of view.geom.paths) {
        const dimmed = layers.turnoutRoutes && openPaths && !openPaths.has(path.id);
        drawTrackPath(g, path.primitives, pathWorldStart(view, path.id), style, { alpha: dimmed ? alpha * 0.35 : alpha, highlight: dimmed ? null : highlight });
      }
    }
  }

  private drawOverlays(state: SceneState): void {
    const { index, selection, activeLevel, showAllLevels, occupiedBlockIds } = state;
    const layers = state.layers ?? DEFAULT_LAYERS;
    const g = this.overlays;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const doc = index.doc;

    const drawBlock = (block: TrackBlock, color: number, alpha: number, label: string | null, selectedNow: boolean) => {
      if (!showAllLevels && block.level !== activeLevel) return;
      const segments = blockWorldSegments(index, block);
      for (const seg of segments) {
        tracePath(g, seg.primitives, seg.start, 0);
        g.stroke({ width: selectedNow ? 56 : 46, color, alpha: selectedNow ? Math.min(1, alpha + 0.25) : alpha, cap: 'butt', join: 'round' });
      }
      if (label && segments[0]) {
        const mid = compose(segments[0].start, pathPoseAt(segments[0].primitives, segments[0].lengthMm / 2));
        this.addLabel(label, mid, color, state.camera.zoom);
      }
    };

    if (layers.blocks) {
      for (const b of doc.trackBlocks) {
        const occupied = occupiedBlockIds?.has(b.id) ?? false;
        drawBlock(
          b,
          occupied ? 0xf43f5e : 0x3b82f6,
          occupied ? 0.5 : 0.3,
          b.sensorId != null ? `S${b.sensorId}` : null,
          selection.block?.kind === 'block' && selection.block.id === b.id,
        );
      }
    }
    if (layers.destinations) {
      for (const d of doc.destinations) {
        drawBlock(d, d.isStation ? 0xa855f7 : 0xf59e0b, 0.35, d.name, selection.block?.kind === 'destination' && selection.block.id === d.id);
      }
    }
    if (layers.speeds) {
      for (const s of doc.speedRestrictions) {
        drawBlock(s, 0xef4444, 0.28, `≤ ${s.maxSpeedStep}`, selection.block?.kind === 'speed' && selection.block.id === s.id);
      }
    }

    if (layers.accessories) {
      for (const acc of doc.accessories) {
        if (!showAllLevels && acc.level !== activeLevel) continue;
        this.drawAccessory(g, index, acc, selection.accessoryId === acc.id);
      }
    }

    if (layers.turnoutIds) {
      for (const view of index.pieces.values()) {
        if (!view.geom.states) continue;
        if (!showAllLevels && view.piece.level !== activeLevel) continue;
        const a = view.connectorWorld.get('A')!;
        const toe = compose({ x: a.x, y: a.y, theta: a.theta + Math.PI }, { x: 45, y: -28, theta: 0 });
        const stateId = state.turnoutStates?.get(view.piece.id);
        const stateLabel = stateId ? view.geom.states.find((s) => s.id === stateId)?.label : null;
        const text = view.piece.automationId ? `T${view.piece.automationId}` : 'T';
        this.addLabel(stateLabel ? `${text} · ${stateLabel}` : text, toe, 0xfbbf24, state.camera.zoom);
      }
    }
  }

  private drawAccessory(g: Graphics, index: LayoutIndex, acc: PlacedAccessory, selectedNow: boolean): void {
    let frame: Frame | null = null;
    if (acc.anchor) {
      const view = index.pieces.get(acc.anchor.pieceId);
      const path = view?.geom.paths.find((p) => p.id === acc.anchor!.pathId);
      if (view && path) frame = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, acc.anchor.s));
    } else if (typeof acc.x === 'number' && typeof acc.y === 'number') {
      frame = { x: acc.x, y: acc.y, theta: (acc.rotationDeg * Math.PI) / 180 };
    }
    if (!frame) return;
    const color = selectedNow ? ACCENT : 0xe2e8f0;
    const side = compose(frame, { x: 0, y: 24, theta: 0 });
    switch (acc.defId) {
      case 'signal-2':
      case 'signal-3':
        g.moveTo(frame.x, frame.y).lineTo(side.x, side.y);
        g.stroke({ width: 2, color });
        g.circle(side.x, side.y, 6);
        g.fill({ color: 0xef4444 });
        if (acc.defId === 'signal-3') {
          g.circle(side.x, side.y + 12, 6);
          g.fill({ color: 0xfbbf24 });
        }
        break;
      case 'decoupler': {
        const a = compose(frame, { x: -20, y: -6, theta: 0 });
        g.rect(a.x, a.y, 40, 12);
        g.fill({ color: 0xf97316, alpha: 0.9 });
        break;
      }
      case 'buffer-stop': {
        const a = compose(frame, { x: -3, y: -16, theta: 0 });
        g.rect(a.x, a.y, 6, 32);
        g.fill({ color: 0xef4444 });
        break;
      }
      case 'platform': {
        const a = compose(frame, { x: -150, y: -20, theta: 0 });
        g.rect(a.x, a.y, 300, 40);
        g.fill({ color: 0x94a3b8, alpha: 0.55 });
        break;
      }
      default:
        g.circle(frame.x, frame.y, 8);
        g.fill({ color: 0xfde68a });
    }
    if (selectedNow) {
      g.circle(frame.x, frame.y, 14);
      g.stroke({ width: 2, color: ACCENT });
    }
  }

  private drawPorts(state: SceneState): void {
    const { index, selection, activeLevel, showAllLevels, pendingPort, hoverPort, camera } = state;
    const g = this.ports;
    g.clear();
    const r = Math.max(4, 6 / Math.sqrt(camera.zoom));
    const isVisible = (pieceId: string) => showAllLevels || index.pieces.get(pieceId)?.piece.level === activeLevel;

    for (const ref of index.openPorts) {
      if (!isVisible(ref.pieceId)) continue;
      const view = index.pieces.get(ref.pieceId)!;
      const connector = getConnector(view.geom, ref.connectorId);
      const f = view.connectorWorld.get(ref.connectorId)!;
      const isPending = pendingPort?.pieceId === ref.pieceId && pendingPort.connectorId === ref.connectorId;
      const isHover = hoverPort?.pieceId === ref.pieceId && hoverPort.connectorId === ref.connectorId;
      if (connector.blocked) {
        g.rect(f.x - r, f.y - r, 2 * r, 2 * r);
        g.fill({ color: 0xef4444 });
        continue;
      }
      g.circle(f.x, f.y, isPending || isHover ? r * 1.5 : r);
      g.fill({ color: isPending ? ACCENT : 0x22c55e, alpha: 0.95 });
      g.stroke({ width: 1.2 / camera.zoom, color: 0x052e16 });
    }

    const gaps = index.jointGaps;
    const unresolved = new Set(unresolvedGaps(index).map((x) => x.jointId));
    for (const joint of index.doc.joints) {
      if (!isVisible(joint.a.pieceId) && !isVisible(joint.b.pieceId)) continue;
      const f = index.pieces.get(joint.a.pieceId)?.connectorWorld.get(joint.a.connectorId);
      if (!f) continue;
      const gap = gaps.get(joint.id);
      const isSelected = selection.jointId === joint.id;
      if (gap) {
        // The two rail ends do not meet on screen but are one joint for the trains: show the link.
        const fb = index.pieces.get(joint.b.pieceId)?.connectorWorld.get(joint.b.connectorId);
        if (fb) {
          g.moveTo(f.x, f.y).lineTo(fb.x, fb.y);
          g.stroke({ width: 3 / camera.zoom, color: 0x22c55e, alpha: 0.9 });
          g.circle(fb.x, fb.y, r * 0.8);
          g.fill({ color: 0x22c55e, alpha: 0.9 });
        }
        g.circle(f.x, f.y, r * 0.8);
        g.fill({ color: 0x22c55e, alpha: 0.9 });
      }
      if (gap && unresolved.has(joint.id)) {
        g.circle(f.x, f.y, r * 1.6);
        g.stroke({ width: 2.5 / camera.zoom, color: 0xef4444 });
        this.addLabel(`${gap.gapMm.toFixed(1)} mm / ${gap.gapDeg.toFixed(1)}°`, { x: f.x, y: f.y - 30, theta: 0 }, 0xef4444, camera.zoom);
      } else {
        // Rail joint tick, perpendicular to the track.
        const nx = -Math.sin(f.theta);
        const ny = Math.cos(f.theta);
        g.moveTo(f.x - nx * 12, f.y - ny * 12).lineTo(f.x + nx * 12, f.y + ny * 12);
        g.stroke({ width: (isSelected ? 3 : 1.2) / camera.zoom, color: isSelected ? ACCENT : gap ? 0xfbbf24 : 0x94a3b8, alpha: 0.9 });
      }
      if (isSelected) {
        g.circle(f.x, f.y, r * 1.8);
        g.stroke({ width: 2 / camera.zoom, color: ACCENT });
      }
    }
  }

  /** World → screen helper for HTML overlays (labels, popovers). */
  worldToScreen(x: number, y: number): Vec2 {
    const cam = this.lastState?.camera;
    if (!cam) return { x, y };
    return { x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom };
  }

  /** Extra layer on top of everything (trains, claims) for the live map. */
  addOverlayLayer(container: Container): void {
    this.world.addChild(container);
  }

  private drawGhost(state: SceneState): void {
    const g = this.ghostLayer;
    g.clear();
    const { placing, ghost, pendingAnchor, index, camera } = state;
    if (pendingAnchor) {
      const view = index.pieces.get(pendingAnchor.pieceId);
      const path = view?.geom.paths.find((p) => p.id === pendingAnchor.pathId);
      if (view && path) {
        const f = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, pendingAnchor.s));
        g.circle(f.x, f.y, 10 / Math.sqrt(camera.zoom));
        g.fill({ color: 0xf59e0b });
      }
    }
    if (!placing || !ghost) return;
    const def = getTrackDef(placing.defId);
    if (!def) return;
    const geom = buildPieceGeometry(def);
    const style = trackStyleFor(def.system);
    for (const path of geom.paths) {
      const start = compose(ghost.frame, pathStartFrame(getConnector(geom, path.from)));
      drawTrackPath(g, path.primitives, start, style, { ghost: true, alpha: ghost.target ? 1 : 0.75 });
    }
    const held = compose(ghost.frame, getConnector(geom, placing.connectorId).frame);
    g.circle(held.x, held.y, 9 / Math.sqrt(camera.zoom));
    g.fill({ color: ghost.target ? 0x22c55e : 0xf59e0b });
  }

  private addLabel(text: string, at: Frame | Vec2, color: number, zoom: number): void {
    const label = new Text({
      text,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: color, fontWeight: '600' },
      resolution: 2,
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(at.x, at.y);
    label.scale.set(1 / zoom);
    this.labels.addChild(label);
  }
}
