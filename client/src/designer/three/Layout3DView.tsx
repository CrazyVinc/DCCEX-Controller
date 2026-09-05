import { OrbitControls, Grid } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { compose, type Frame } from '@shared/geometry/frame.ts';
import { pathLength, pathPoseAt, type Primitive } from '@shared/geometry/primitives.ts';
import { pathWorldStart, type LayoutIndex, type PieceView } from '@shared/layout/index.ts';
import { trackStyleFor } from '../canvas/drawing.ts';
import { useEditorStore } from '../store/editorStore.ts';

/**
 * Exact 3D curve along a track path: plan position from the primitives, height from the
 * piece base height and grade. Lateral `offset` (mm) yields the two rails.
 */
class TrackPathCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly prims: Primitive[],
    private readonly start: Frame,
    private readonly z0: number,
    private readonly grade: number,
    private readonly offset: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const len = pathLength(this.prims);
    const s = t * len;
    const pose = compose(this.start, pathPoseAt(this.prims, s));
    const nx = -Math.sin(pose.theta);
    const ny = Math.cos(pose.theta);
    // three.js: y up. Layout x → x, layout y (screen down) → -z, height → y.
    const x = pose.x + this.offset * nx;
    const yPlan = pose.y + this.offset * ny;
    return target.set(x, this.z0 + this.grade * s, -yPlan);
  }
}

/** Flat ribbon between two laterally offset copies of a track curve (the track bed). */
function ribbonGeometry(prims: Primitive[], start: Frame, z0: number, grade: number, halfWidth: number, segments: number): THREE.BufferGeometry {
  const left = new TrackPathCurve(prims, start, z0, grade, -halfWidth);
  const right = new TrackPathCurve(prims, start, z0, grade, halfWidth);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];
  const pl = new THREE.Vector3();
  const pr = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    left.getPoint(t, pl);
    right.getPoint(t, pr);
    positions.set([pl.x, pl.y, pl.z, pr.x, pr.y, pr.z], i * 6);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function PieceMesh({ view, selected }: { view: PieceView; selected: boolean }) {
  const style = trackStyleFor(view.def.system);
  const geometries = useMemo(() => {
    const out: { rails: THREE.TubeGeometry[]; bed: THREE.BufferGeometry }[] = [];
    const grade = (view.piece.gradePercent ?? 0) / 100;
    for (const path of view.geom.paths) {
      const start = pathWorldStart(view, path.id);
      const len = pathLength(path.primitives);
      const segments = Math.max(8, Math.ceil(len / 6));
      const rails = [-1, 1].map(
        (side) => new THREE.TubeGeometry(new TrackPathCurve(path.primitives, start, view.piece.zMm + 2.5, grade, (side * style.gauge) / 2), segments, 1, 6, false),
      );
      const bed = ribbonGeometry(path.primitives, start, view.piece.zMm, grade, style.bedWidth / 2, segments);
      out.push({ rails, bed });
    }
    return out;
  }, [view, style.gauge, style.bedWidth]);

  return (
    <group>
      {geometries.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.bed}>
            <meshStandardMaterial color={selected ? 0x38bdf8 : style.bedColor} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          {g.rails.map((r, j) => (
            <mesh key={j} geometry={r}>
              <meshStandardMaterial color={style.railColor} metalness={0.7} roughness={0.35} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Scene({ index, selected }: { index: LayoutIndex; selected: Set<string> }) {
  const views = [...index.pieces.values()];
  const center = useMemo(() => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const v of views) {
      sx += v.frame.x;
      sy += v.frame.y;
      n++;
    }
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  }, [views]);

  return (
    <group position={[-center.x, 0, center.y]}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[800, 1200, 600]} intensity={1.1} castShadow />
      <Grid args={[6000, 6000]} cellSize={100} sectionSize={500} cellColor="#1e293b" sectionColor="#334155" fadeDistance={5000} position={[center.x, -1, -center.y]} infiniteGrid />
      {views.map((v) => (
        <PieceMesh key={v.piece.id} view={v} selected={selected.has(v.piece.id)} />
      ))}
    </group>
  );
}

export function Layout3DView() {
  const index = useEditorStore((s) => s.index);
  const selection = useEditorStore((s) => s.selection);
  const selected = useMemo(() => new Set(selection.pieceIds), [selection.pieceIds]);
  return (
    <div className="designer-canvas designer-3d">
      <Canvas camera={{ position: [1200, 1400, 1600], fov: 45, near: 1, far: 30000 }} shadows>
        <color attach="background" args={['#0b1220']} />
        <Scene index={index} selected={selected} />
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} />
      </Canvas>
    </div>
  );
}
