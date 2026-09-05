import express from 'express';
import { z } from 'zod';
import { MovementSchema, TraversalSchema } from '../../../shared/src/domain/train.ts';
import type { Interlocking } from '../../core/interlocking.ts';
import type { LiveService } from '../../core/liveService.ts';
import type { SensorBus } from '../../core/sensorBus.ts';
import type { TrainStateManager } from '../../core/trainState.ts';
import type { TurnoutStateStore } from '../../core/turnoutState.ts';
import type { ConsistStore } from '../../services/consistStore.ts';
import { parseOr400 } from './validate.ts';

interface Deps {
  trainState: TrainStateManager;
  turnouts: TurnoutStateStore;
  consistStore: ConsistStore;
  sensors: SensorBus;
  liveService: LiveService;
  interlocking: Interlocking;
}

const PlaceBodySchema = z.object({ front: TraversalSchema });
const MovementBodySchema = z.object({ movement: MovementSchema });
const TurnoutBodySchema = z.object({ state: z.string().min(1) });
const DriveBodySchema = z.object({ movement: z.enum(['forward', 'reverse']), speedStep: z.int().min(0).max(126) });

/** `/api/live` — server-authoritative train positions, turnout states and driving. */
export function createLiveRouter({ trainState, turnouts, consistStore, sensors, liveService, interlocking }: Deps) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      trains: trainState.list(),
      turnouts: turnouts.snapshot(),
      sensors: sensors.snapshot(),
      claims: interlocking.snapshot(),
      safety: liveService.safety.state,
      simulationMode: liveService.simulationMode,
    });
  });

  router.post('/trains/:consistId/drive', (req, res) => {
    const body = parseOr400(DriveBodySchema, req.body, res);
    if (!body) return;
    const verdict = liveService.drive(req.params.consistId, body.movement, body.speedStep);
    if (!verdict.ok) {
      res.status(409).json({ ok: false, message: verdict.reason });
      return;
    }
    res.json({ ok: true, train: trainState.live(req.params.consistId) });
  });

  router.post('/trains/:consistId/confirm', async (req, res) => {
    const ok = await liveService.confirmPosition(req.params.consistId);
    if (!ok) {
      res.status(404).json({ ok: false, message: 'Train has no position yet' });
      return;
    }
    res.json({ ok: true, train: trainState.live(req.params.consistId) });
  });

  router.get('/safety', (req, res) => {
    res.json({ safety: liveService.safety.state, gate: liveService.gate.recent() });
  });

  router.post('/safety/reset', (req, res) => {
    liveService.resetSafety();
    res.json({ ok: true, safety: liveService.safety.state });
  });

  router.post('/recover', async (req, res) => {
    res.json({ ok: true, ...(await liveService.reconciliation.recover()) });
  });

  router.post('/trains/:consistId/stop', (req, res) => {
    liveService.stopTrain(req.params.consistId);
    res.json({ ok: true });
  });

  router.post('/trains/:consistId/reset', (req, res) => {
    liveService.resetEmergency(req.params.consistId);
    res.json({ ok: true, train: trainState.live(req.params.consistId) });
  });

  router.post('/emergency-stop', (req, res) => {
    liveService.emergencyStop();
    res.json({ ok: true });
  });

  router.post('/trains/:consistId/position', async (req, res) => {
    const body = parseOr400(PlaceBodySchema, req.body, res);
    if (!body) return;
    if (!consistStore.get(req.params.consistId)) {
      res.status(404).json({ ok: false, message: 'Consist not found' });
      return;
    }
    const result = await trainState.place(req.params.consistId, body.front);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: result.error, fits: result.fits, message: placementMessage(result.error) });
      return;
    }
    res.json({ ok: true, train: result.train });
  });

  router.delete('/trains/:consistId/position', async (req, res) => {
    await trainState.remove(req.params.consistId);
    res.json({ ok: true });
  });

  router.post('/trains/:consistId/movement', async (req, res) => {
    const body = parseOr400(MovementBodySchema, req.body, res);
    if (!body) return;
    const train = await trainState.setMovement(req.params.consistId, body.movement);
    if (!train) {
      res.status(404).json({ ok: false, message: 'Train has no position yet' });
      return;
    }
    res.json({ ok: true, train });
  });

  router.post('/turnouts/:pieceId', (req, res) => {
    const body = parseOr400(TurnoutBodySchema, req.body, res);
    if (!body) return;
    if (!interlocking.canThrow(req.params.pieceId)) {
      res.status(423).json({ ok: false, message: `Turnout is locked for train ${interlocking.holderOf(req.params.pieceId)}` });
      return;
    }
    // Never move the points under a standing train.
    const under = trainState.list().find((t) => t.occupiedPieceIds.includes(req.params.pieceId));
    if (under) {
      res.status(423).json({ ok: false, message: `Turnout is under train ${under.consistId}` });
      return;
    }
    if (!turnouts.set(req.params.pieceId, body.state)) {
      res.status(400).json({ ok: false, message: 'Unknown turnout or state' });
      return;
    }
    res.json({ ok: true, pieceId: req.params.pieceId, state: body.state });
  });

  return router;
}

function placementMessage(error: string): string {
  switch (error) {
    case 'open-end':
      return 'The train does not fit: the track ends before the rear of the train.';
    case 'buffer-stop':
      return 'The train does not fit: a buffer stop is in the way.';
    case 'turnout-against':
      return 'The train does not fit: a turnout behind it is set against the train.';
    case 'overlap':
      return 'Another train already occupies that track.';
    default:
      return 'Placement rejected.';
  }
}
