import EventEmitter from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { Consist } from '../../shared/src/domain/train.ts';
import { poseFromFront } from '../../shared/src/domain/pose.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout, type LayoutDocument } from '../../shared/src/layout/schema.ts';
import type { ConsistStore } from '../services/consistStore.ts';
import type { LayoutStore } from '../services/layoutStore.ts';
import type { RollingStockService } from '../services/rollingStock.ts';
import type { DccEngine } from './dccEngine.ts';
import { Dispatcher } from './dispatcher.ts';
import { Interlocking } from './interlocking.ts';
import { LiveService } from './liveService.ts';
import { SensorBus } from './sensorBus.ts';
import { SIM_STEP_MS } from './simulation.ts';
import { TrainStateManager } from './trainState.ts';
import { TurnoutStateStore } from './turnoutState.ts';

const consist: Consist = { id: 'c1', name: 'IC', units: [{ kind: 'loco', dccId: '3', orientation: 'forward' }], couplingGapMm: 0, accelerationMmS2: 150, brakingMmS2: 250 };
const LENGTH = 150;

/** s0 ── s1 ── s2 ── turnout ─(main)─ m1 ── m2 ; (branch)─ b1 ── b2 ── b3  with a station "Yard" on b2+b3. */
function world() {
  let { doc, pieceId: s0 } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const s1 = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: s0, connectorId: 'B' });
  const s2 = attachNewPiece(s1.doc, 'k-s-2200', 'A', { pieceId: s1.pieceId, connectorId: 'B' });
  const t = attachNewPiece(s2.doc, 'k-t-2263-R', 'A', { pieceId: s2.pieceId, connectorId: 'B' });
  const m1 = attachNewPiece(t.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'B' });
  const m2 = attachNewPiece(m1.doc, 'k-s-2200', 'A', { pieceId: m1.pieceId, connectorId: 'B' });
  const b1 = attachNewPiece(m2.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'C' });
  const b2 = attachNewPiece(b1.doc, 'k-s-2200', 'A', { pieceId: b1.pieceId, connectorId: 'B' });
  const b3 = attachNewPiece(b2.doc, 'k-s-2200', 'A', { pieceId: b2.pieceId, connectorId: 'B' });
  doc = b3.doc as LayoutDocument;
  doc.destinations.push({
    id: 'yard-1',
    name: 'Yard',
    isStation: true,
    level: 0,
    start: { pieceId: b2.pieceId, pathId: 'AB', s: 0 },
    end: { pieceId: b3.pieceId, pathId: 'AB', s: 180 },
    pieceIds: [b2.pieceId, b3.pieceId],
  });
  return { doc, ids: { s0, s1: s1.pieceId, s2: s2.pieceId, t: t.pieceId, m1: m1.pieceId, m2: m2.pieceId, b1: b1.pieceId, b2: b2.pieceId, b3: b3.pieceId } };
}

function harness(doc: LayoutDocument, options: { connected?: boolean } = {}) {
  const index = buildLayoutIndex(doc);
  const layoutStore = { getIndex: () => index, getLayout: () => doc, on: () => {} } as unknown as LayoutStore;
  const consistStore = {
    get: (id: string) => (id === 'c1' ? consist : undefined),
    require: () => consist,
    list: () => [consist],
    totalLengthMm: () => LENGTH,
    locos: () => [{ dccId: '3', orientation: 'forward' as const }],
  } as unknown as ConsistStore;
  const rollingStock = { getTrainById: () => ({ Speed: { Distance: 100, Duration: 1, Step: 10 } }), getWagonById: () => undefined } as unknown as RollingStockService;
  const turnouts = new TurnoutStateStore(() => index);
  const trainState = new TrainStateManager({ getIndex: () => index, getLength: () => LENGTH, turnoutStates: turnouts.resolver, persistence: false });
  const sensors = new SensorBus();
  const interlocking = new Interlocking();
  /** Throttle commands that reached the (fake) command station. */
  const sent: { cab: number; speed: number; dir: number }[] = [];
  const dccEngine = Object.assign(new EventEmitter(), {
    dccClient: { connected: options.connected ?? false, on: () => {}, turnoutThrow: () => {}, turnoutClose: () => {}, getPower: () => (options.connected ? true : null) },
    setThrottle: (t: { cab: number; speed: number; dir: number }) => {
      sent.push(t);
      // The real client echoes every accepted command as a throttle event.
      dccEngine.emit('throttle', t);
    },
    emergencyStop: () => {},
  }) as unknown as DccEngine & EventEmitter;
  const liveService = new LiveService({ layoutStore, consistStore, rollingStock, trainState, turnouts, sensors, dccEngine, interlocking });
  liveService.start();
  liveService.stop(); // step the simulation manually in tests
  const dispatcher = new Dispatcher({ layoutStore, consistStore, rollingStock, trainState, turnouts, interlocking, liveService });
  return { index, turnouts, trainState, interlocking, liveService, dispatcher, dccEngine, sent };
}

/** l0 ── l1 ── … ── l(count-1): plain straights, joints everywhere (reversal possible at every joint). */
function line(count: number) {
  let { doc, pieceId } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const ids = [pieceId];
  for (let i = 1; i < count; i++) {
    const r = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: ids[i - 1]!, connectorId: 'B' });
    doc = r.doc;
    ids.push(r.pieceId);
  }
  return { doc: doc as LayoutDocument, ids };
}

/** Step the simulation until the job ends, waiting real time for the point motors at reversal points. */
async function runToEnd(h: ReturnType<typeof harness>, maxSteps = 20_000): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    h.liveService.simulation.step(SIM_STEP_MS);
    let job = h.dispatcher.list()[0]!;
    for (let w = 0; w < 100 && job.reason?.startsWith('Reversing'); w++) {
      await new Promise((r) => setTimeout(r, 25));
      job = h.dispatcher.list()[0]!;
    }
    if (job.state !== 'running' && job.state !== 'held') return;
  }
}

let cleanup: (() => void) | null = null;
afterEach(() => cleanup?.());

describe('dispatcher', () => {
  it('runs a train to a free platform: plan → dry-run → claim → turnouts → drive → arrive → release', async () => {
    const { doc, ids } = world();
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Yard', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    expect(job.platformId).toBe('yard-1');
    expect(job.movement).toBe('forward');
    expect(job.turnoutStates).toEqual([{ pieceId: ids.t, state: 'branch' }]);
    expect(h.turnouts.get(ids.t)).toBe('branch');
    expect(h.interlocking.holderOf(ids.b3)).toBe('c1');
    // Nose stops 25 mm before the far end of the platform (b3 at 155 mm).
    expect(job.stopAt).toEqual({ pieceId: ids.b3, pathId: 'AB', s: 155 });

    for (let i = 0; i < 5000 && h.dispatcher.list()[0]!.state === 'running'; i++) h.liveService.simulation.step(SIM_STEP_MS);
    const done = h.dispatcher.list()[0]!;
    expect(done.state).toBe('arrived');
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    expect(pose.front.pos.pieceId).toBe(ids.b3);
    expect(pose.front.pos.s).toBeCloseTo(155, 2);
    expect(pose.speedMmS).toBe(0);
    expect(h.interlocking.holderOf(ids.b3)).toBeNull();
    expect(h.liveService.gate.underAutomaticControl('c1')).toBe(false);
  });

  it('reverses over the stub behind a turnout when the platform is only reachable via the other leg', async () => {
    // stub s0 ── s1 ──A[t]B── m1 ── m2 ; C── b1 ── b2 ── b3 (station "Yard" on b2+b3). Train on m1/m2 facing the turnout.
    const { doc, ids } = world();
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    // Nose at m1 s=30 pointing toward the turnout (path direction -1); the train stands on m1/m2.
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.m1, pathId: 'AB', s: 30 }, dir: -1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Yard', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    expect(job.reason).toMatch(/reverses 1×/);
    expect(job.movement).toBe('forward');
    expect(h.turnouts.get(ids.t)).toBe('main'); // leg 1 runs straight through onto the stub

    // Drive leg 1 until the train waits at the reversal point, then let the point motors finish.
    for (let i = 0; i < 3000 && !h.dispatcher.list()[0]!.reason?.startsWith('Reversing'); i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.dispatcher.list()[0]!.reason).toMatch(/Reversing \(leg 2 of 2\)/);
    expect(h.turnouts.get(ids.t)).toBe('branch');
    const atStub = h.liveService.simulation.trains.get('c1')!.pose;
    expect([ids.s0, ids.s1]).toContain(atStub.front.pos.pieceId);
    expect(atStub.speedMmS).toBe(0);
    await new Promise((r) => setTimeout(r, 900));

    for (let i = 0; i < 5000 && h.dispatcher.list()[0]!.state === 'running'; i++) h.liveService.simulation.step(SIM_STEP_MS);
    const done = h.dispatcher.list()[0]!;
    expect(done.state).toBe('arrived');
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    // Tail-first arrival: the rear stops 25 mm before the far end of the platform, the nose still faces as before.
    expect(pose.rear.pos.pieceId).toBe(ids.b3);
    expect(pose.rear.pos.s).toBeCloseTo(155, 2);
    expect(pose.front.dir).toBe(placed.pose.front.dir);
    expect(pose.speedMmS).toBe(0);
    expect(h.interlocking.holderOf(ids.b3)).toBeNull();
    expect(h.interlocking.holderOf(ids.s0)).toBeNull();
  });

  it('centres the train on a platform that is shorter than the train and only warns', async () => {
    const { doc, ids } = world();
    // 100 mm platform on m1 between s=20 and s=120: centre at s=70.
    doc.destinations.push({ id: 'short', name: 'Short', isStation: true, level: 0, start: { pieceId: ids.m1, pathId: 'AB', s: 20 }, end: { pieceId: ids.m1, pathId: 'AB', s: 120 }, pieceIds: [ids.m1] });
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Short', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    expect(job.warnings).toHaveLength(1);
    expect(job.warnings[0]).toMatch(/is 100 mm, train is 150 mm.*centred/);
    // Nose stops half a train length past the platform centre: 70 + 75 = 145 mm on m1.
    expect(job.stopAt).toEqual({ pieceId: ids.m1, pathId: 'AB', s: 145 });

    for (let i = 0; i < 5000 && h.dispatcher.list()[0]!.state === 'running'; i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.dispatcher.list()[0]!.state).toBe('arrived');
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    expect(pose.front.pos.pieceId).toBe(ids.m1);
    expect(pose.front.pos.s).toBeCloseTo(145, 2);
    // Rear 150 mm back: 5 mm before the start of m1, i.e. still on the turnout — the middle of the train is at s=70.
    expect(pose.rear.pos.pieceId).toBe(ids.t);
  });

  it('centres a train that already stands half over the short platform, whichever side it has to approach from', async () => {
    // Straight line l0 … l11; 100 mm platform on l4 between s=40 and s=140 (centre s=90). Train 150 mm.
    const { doc, ids } = line(12);
    doc.destinations.push({ id: 'short', name: 'Short', isStation: true, level: 0, start: { pieceId: ids[4]!, pathId: 'AB', s: 40 }, end: { pieceId: ids[4]!, pathId: 'AB', s: 140 }, pieceIds: [ids[4]!] });
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    // Nose at l5 s=90 facing +s: the train covers l4 s=120 … l5 s=90, its middle is 120 mm past the platform centre.
    const placed = poseFromFront(h.index, { pos: { pieceId: ids[5]!, pathId: 'AB', s: 90 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Short', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    await runToEnd(h);
    expect(h.dispatcher.list()[0]!.state).toBe('arrived');
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    // Centred: middle at l4 s=90 → nose at l4 s=165, rear at l4 s=15; facing unchanged.
    expect(pose.front.pos.pieceId).toBe(ids[4]);
    expect(pose.front.pos.s).toBeCloseTo(165, 1);
    expect(pose.rear.pos.pieceId).toBe(ids[4]);
    expect(pose.rear.pos.s).toBeCloseTo(15, 1);
    expect(pose.front.dir).toBe(1);
  });

  it('reports a train that already stands centred on its platform instead of "no route"', async () => {
    const { doc, ids } = line(12);
    doc.destinations.push({ id: 'short', name: 'Short', isStation: true, level: 0, start: { pieceId: ids[4]!, pathId: 'AB', s: 40 }, end: { pieceId: ids[4]!, pathId: 'AB', s: 140 }, pieceIds: [ids[4]!] });
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids[4]!, pathId: 'AB', s: 165 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);
    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Short', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('rejected');
    expect(job.reason).toBe('Train is already at this station');
  });

  it('shrinks the stop margin when the platform is barely longer than the train', async () => {
    const { doc, ids } = world();
    // 160 mm platform on m1 (s=10 … 170) for a 150 mm train: 5 mm to spare at each end.
    doc.destinations.push({ id: 'tight', name: 'Tight', isStation: true, level: 0, start: { pieceId: ids.m1, pathId: 'AB', s: 10 }, end: { pieceId: ids.m1, pathId: 'AB', s: 170 }, pieceIds: [ids.m1] });
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);
    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Tight', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    expect(job.warnings).toEqual([]);
    expect(job.stopAt).toEqual({ pieceId: ids.m1, pathId: 'AB', s: 165 });
    await runToEnd(h);
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    expect(pose.front.pos.s).toBeCloseTo(165, 2);
    expect(pose.rear.pos.pieceId).toBe(ids.m1);
    expect(pose.rear.pos.s).toBeCloseTo(15, 2);
  });

  it('sets a turnout the train stands on to the leg it occupies before pulling back over it', async () => {
    // Station "Stub" on s0+s1. Train on the diverging leg: nose on b1, tail still on the turnout's AC path,
    // while the turnout is (still) set to main — e.g. after a restart or someone threw it.
    const { doc, ids } = world();
    doc.destinations.push({ id: 'stub', name: 'Stub', isStation: true, level: 0, start: { pieceId: ids.s0, pathId: 'AB', s: 0 }, end: { pieceId: ids.s1, pathId: 'AB', s: 180 }, pieceIds: [ids.s0, ids.s1] });
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    h.turnouts.set(ids.t, 'branch');
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.b1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH, h.turnouts.resolver);
    if ('error' in placed) throw new Error(placed.error);
    expect(placed.pose.rear.pos).toMatchObject({ pieceId: ids.t, pathId: 'AC' });
    await h.trainState.place('c1', placed.pose.front);
    h.turnouts.set(ids.t, 'main');

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Stub', speedStep: 40, allowReverse: true });
    // The turnout under the train is part of the first leg: thrown first, departure waits for the motor.
    expect(job.state).toBe('validated');
    expect(job.movement).toBe('reverse');
    expect(job.turnoutStates).toEqual([{ pieceId: ids.t, state: 'branch' }]);
    expect(h.turnouts.get(ids.t)).toBe('branch');
    await new Promise((r) => setTimeout(r, 900));
    expect(h.dispatcher.list()[0]!.state).toBe('running');
    await runToEnd(h);
    expect(h.dispatcher.list()[0]!.state).toBe('arrived');
    const pose = h.liveService.simulation.trains.get('c1')!.pose;
    expect(pose.rear.pos).toEqual({ pieceId: ids.s0, pathId: 'AB', s: 25 });
    expect(pose.front.dir).toBe(1);
  });

  it('a manual throttle from the live page takes the train over from the dispatcher', async () => {
    const { doc, ids } = world();
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);
    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Yard', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    for (let i = 0; i < 50; i++) h.liveService.simulation.step(SIM_STEP_MS);

    // Same command as the automation: nothing changes.
    expect(h.liveService.drive('c1', 'forward', 40, 'manual')).toEqual({ ok: true });
    expect(h.dispatcher.list()[0]!.state).toBe('running');

    // A different speed hands the train over: job dropped, claims released, train follows the operator.
    expect(h.liveService.drive('c1', 'forward', 60, 'manual')).toEqual({ ok: true });
    const done = h.dispatcher.list()[0]!;
    expect(done.state).toBe('aborted');
    expect(done.reason).toBe('Taken over manually');
    expect(h.interlocking.holderOf(ids.b3)).toBeNull();
    expect(h.liveService.gate.underAutomaticControl('c1')).toBe(false);
    expect(h.liveService.commandedStep('c1')).toBe(60);
    // No stop point any more: the train accelerates toward the manual speed instead of braking for the platform.
    expect(h.liveService.simulation.trains.get('c1')!.stopAt).toBeNull();
    const v0 = h.liveService.simulation.trains.get('c1')!.pose.speedMmS;
    for (let i = 0; i < 25; i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.liveService.simulation.trains.get('c1')!.pose.speedMmS).toBeGreaterThan(v0);
    expect(h.liveService.simulation.stateOf('c1')).toBe('accelerating');
  });

  it('a cab throttle from the home page reaches the simulation at once and takes over a running job', async () => {
    const { doc, ids } = world();
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);

    // Plain manual driving: the throttle event (loco 3, forward bit 1) drives the simulated train.
    h.dccEngine.emit('throttle', { cab: 3, speed: 30, dir: 1 });
    expect(h.liveService.commandedStep('c1')).toBe(30);
    for (let i = 0; i < 100; i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.liveService.simulation.trains.get('c1')!.pose.speedMmS).toBeGreaterThan(0);
    h.dccEngine.emit('throttle', { cab: 3, speed: 0, dir: 1 });
    for (let i = 0; i < 200; i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.liveService.simulation.trains.get('c1')!.pose.speedMmS).toBe(0);

    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Yard', speedStep: 40, allowReverse: true });
    // The train now stands right in front of the turnout: departure waits for the point motor.
    expect(job.state).toBe('validated');
    await new Promise((r) => setTimeout(r, 900));
    expect(h.dispatcher.list()[0]!.state).toBe('running');
    for (let i = 0; i < 50; i++) h.liveService.simulation.step(SIM_STEP_MS);
    // The train stands past the turnout now, so the run starts tail first: direction bit 0 for a forward-coupled loco.
    const dir = h.dispatcher.list()[0]!.movement === 'forward' ? 1 : 0;
    // Redundant touch with the automation's own command: the job keeps running.
    h.dccEngine.emit('throttle', { cab: 3, speed: 40, dir });
    expect(h.dispatcher.list()[0]!.state).toBe('running');
    // Turning the knob down hands the train over.
    h.dccEngine.emit('throttle', { cab: 3, speed: 20, dir });
    expect(h.dispatcher.list()[0]!.state).toBe('aborted');
    expect(h.dispatcher.list()[0]!.reason).toBe('Taken over manually');
    expect(h.liveService.commandedStep('c1')).toBe(20);
  });

  it('with a command station the hardware follows the simulated speed curve of an automatic run down to 0', async () => {
    const { doc, ids } = world();
    const h = harness(doc, { connected: true });
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);
    const job = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Yard', speedStep: 40, allowReverse: true });
    expect(job.state).toBe('running');
    h.sent.length = 0;
    for (let i = 0; i < 6000 && h.dispatcher.list()[0]!.state === 'running'; i++) h.liveService.simulation.step(SIM_STEP_MS);
    expect(h.dispatcher.list()[0]!.state).toBe('arrived');
    const speeds = h.sent.filter((t) => t.cab === 3).map((t) => t.speed);
    // Ramp up, run at the validated step, ramp down, and finally 0 at the platform.
    expect(speeds.length).toBeGreaterThan(5);
    expect(Math.max(...speeds)).toBe(40);
    expect(speeds[speeds.length - 1]).toBe(0);
    const peak = speeds.indexOf(40);
    for (let i = 1; i <= peak; i++) expect(speeds[i]!).toBeGreaterThanOrEqual(speeds[i - 1]!);
    for (let i = peak + 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThanOrEqual(speeds[i - 1]!);
    // Echoes of our own commands never count as manual take-overs.
    expect(h.dispatcher.list()[0]!.reason).toBe('Arrived at platform');
  });

  it('rejects an unknown station', async () => {
    const { doc, ids } = world();
    const h = harness(doc);
    cleanup = () => h.liveService.stop();
    const placed = poseFromFront(h.index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    await h.trainState.place('c1', placed.pose.front);
    const unknown = await h.dispatcher.dispatch({ consistId: 'c1', station: 'Nowhere', speedStep: 40, allowReverse: true });
    expect(unknown.state).toBe('rejected');
    expect(unknown.reason).toMatch(/No station named/);
  });
});
