import express from 'express';
import { DispatchRequestSchema } from '../../../shared/src/domain/dispatch.ts';
import type { Dispatcher } from '../../core/dispatcher.ts';
import { parseOr400 } from './validate.ts';

/** `/api/dispatch` — automatic running: send a train to a station. */
export function createDispatchRouter({ dispatcher }: { dispatcher: Dispatcher }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ jobs: dispatcher.list(), stations: dispatcher.stations() });
  });

  router.post('/', async (req, res) => {
    const body = parseOr400(DispatchRequestSchema, req.body, res);
    if (!body) return;
    const job = await dispatcher.dispatch(body);
    res.status(job.state === 'rejected' ? 409 : 201).json({ ok: job.state !== 'rejected', job });
  });

  router.post('/:jobId/abort', (req, res) => {
    const job = dispatcher.abort(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, message: 'Job not found' });
      return;
    }
    res.json({ ok: true, job });
  });

  return router;
}
