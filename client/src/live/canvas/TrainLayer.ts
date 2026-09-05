import { Container, Graphics, Text } from 'pixi.js';
import { poseFromFront } from '@shared/domain/pose.ts';
import type { LiveTrain, Traversal } from '@shared/domain/train.ts';
import { noseFrame, trainWorldSegments } from '@shared/domain/trainGeometry.ts';
import { compose, type Frame } from '@shared/geometry/frame.ts';
import type { LayoutIndex } from '@shared/layout/index.ts';
import type { TurnoutStates } from '@shared/layout/traverse.ts';
import { pathPoseAt } from '@shared/geometry/primitives.ts';
import { tracePath } from '../../designer/canvas/drawing.ts';

export interface TrainLayerState {
  index: LayoutIndex;
  trains: LiveTrain[];
  names: Map<string, string>;
  turnoutStates: TurnoutStates;
  selectedConsistId: string | null;
  showArrows: boolean;
  zoom: number;
  /** Placement preview: nose traversal + train length; drawn in a distinct colour. */
  ghost: { front: Traversal; lengthMm: number } | null;
}

const BAND_WIDTH = 30;

function stateColor(train: LiveTrain): number {
  switch (train.state) {
    case 'running':
    case 'accelerating':
      return 0x22c55e;
    case 'braking':
      return 0xf59e0b;
    case 'emergency':
      return 0xef4444;
    case 'unknown':
      return 0x64748b;
    default:
      return 0x93c5fd;
  }
}

/** Scale speed for display: model mm/s → prototype km/h at 1:87. */
export function scaleKmh(speedMmS: number): number {
  return (speedMmS * 87 * 3.6) / 1000;
}

/** Pixi layer drawing every train as an exact band along the rail, nose arrow first. */
export class TrainLayer {
  readonly container = new Container();
  private readonly bands = new Graphics();
  private readonly labels = new Container();

  constructor() {
    this.container.addChild(this.bands, this.labels);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  render(state: TrainLayerState): void {
    const g = this.bands;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const { index } = state;

    for (const train of state.trains) {
      if (!train.pose) continue;
      if (!index.pieces.has(train.pose.front.pos.pieceId) || !index.pieces.has(train.pose.rear.pos.pieceId)) continue;
      const selected = train.consistId === state.selectedConsistId;
      const color = stateColor(train);
      const alpha = 0.45 + 0.55 * train.pose.confidence;
      const segments = trainWorldSegments(index, train.pose, train.totalLengthMm, state.turnoutStates);
      for (const seg of segments) {
        tracePath(g, seg.primitives, seg.start, 0);
        g.stroke({ width: selected ? BAND_WIDTH + 10 : BAND_WIDTH, color, alpha, cap: 'butt', join: 'round' });
      }
      if (train.pose.confidence < 0.6) {
        for (const seg of segments) {
          tracePath(g, seg.primitives, seg.start, 0);
          g.stroke({ width: BAND_WIDTH + 6, color: 0xfbbf24, alpha: 0.6, cap: 'butt', join: 'round' });
        }
      }

      const nose = noseFrame(index, train.pose);
      if (state.showArrows) {
        this.drawArrow(g, nose, 46, 30, 0xffffff, 0.95);
        if (train.pose.movement !== 'stopped' && segments.length) {
          const mid = segments[Math.floor(segments.length / 2)]!;
          const midFrame = compose(mid.start, pathPoseAt(mid.primitives, mid.lengthMm / 2));
          const dirFrame: Frame = train.pose.movement === 'forward' ? midFrame : { ...midFrame, theta: midFrame.theta + Math.PI };
          this.drawArrow(g, dirFrame, 18, 14, 0xfbbf24, 0.95);
        }
      }
      const name = state.names.get(train.consistId) ?? train.consistId;
      const speed = train.pose.speedMmS > 0 ? ` · ${scaleKmh(train.pose.speedMmS).toFixed(0)} km/h` : '';
      const conf = train.pose.confidence < 1 ? ` · ${(train.pose.confidence * 100).toFixed(0)}%` : '';
      this.addLabel(`${name}${speed}${conf}`, { x: nose.x, y: nose.y - 40 }, selected ? 0x38bdf8 : 0xe2e8f0, state.zoom);
    }

    if (state.ghost) {
      const result = poseFromFront(index, state.ghost.front, state.ghost.lengthMm, state.turnoutStates);
      if ('error' in result) {
        const nose = index.pieces.has(state.ghost.front.pos.pieceId) ? noseFrame(index, { front: state.ghost.front, rear: state.ghost.front, movement: 'stopped', speedMmS: 0, confidence: 1 }) : null;
        if (nose) {
          g.circle(nose.x, nose.y, 24);
          g.stroke({ width: 4, color: 0xef4444 });
        }
      } else {
        for (const seg of trainWorldSegments(index, result.pose, state.ghost.lengthMm, state.turnoutStates)) {
          tracePath(g, seg.primitives, seg.start, 0);
          g.stroke({ width: BAND_WIDTH, color: 0x38bdf8, alpha: 0.55, cap: 'butt', join: 'round' });
        }
        this.drawArrow(g, noseFrame(index, result.pose), 46, 30, 0x38bdf8, 0.9);
      }
    }
  }

  private drawArrow(g: Graphics, frame: Frame, length: number, width: number, color: number, alpha: number): void {
    const tip = compose(frame, { x: length / 2, y: 0, theta: 0 });
    const left = compose(frame, { x: -length / 2, y: -width / 2, theta: 0 });
    const right = compose(frame, { x: -length / 2, y: width / 2, theta: 0 });
    g.moveTo(tip.x, tip.y).lineTo(left.x, left.y).lineTo(right.x, right.y).closePath();
    g.fill({ color, alpha });
  }

  private addLabel(text: string, at: { x: number; y: number }, color: number, zoom: number): void {
    const label = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: color, fontWeight: '600' }, resolution: 2 });
    label.anchor.set(0.5, 1);
    label.position.set(at.x, at.y);
    label.scale.set(1 / zoom);
    this.labels.addChild(label);
  }
}
