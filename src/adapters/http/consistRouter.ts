import express from 'express';
import { ConsistInputSchema } from '../../../shared/src/domain/train.ts';
import type { TrainStateManager } from '../../core/trainState.ts';
import type { ConsistStore } from '../../services/consistStore.ts';
import { parseOr400, sendServiceError } from './validate.ts';

interface Deps {
  consistStore: ConsistStore;
  trainState: TrainStateManager;
}

/** `/api/consists` — operated trains (ordered units, front first). */
export function createConsistRouter({ consistStore, trainState }: Deps) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(consistStore.list().map((c) => ({ ...c, totalLengthMm: consistStore.totalLengthMm(c) })));
  });

  router.post('/', async (req, res) => {
    const body = parseOr400(ConsistInputSchema, req.body, res);
    if (!body) return;
    try {
      const consist = await consistStore.create(body);
      res.status(201).json({ ...consist, totalLengthMm: consistStore.totalLengthMm(consist) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.put('/:id', async (req, res) => {
    const body = parseOr400(ConsistInputSchema, req.body, res);
    if (!body) return;
    try {
      const consist = await consistStore.update(req.params.id, body);
      res.json({ ...consist, totalLengthMm: consistStore.totalLengthMm(consist) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await consistStore.remove(req.params.id);
      await trainState.remove(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  return router;
}
