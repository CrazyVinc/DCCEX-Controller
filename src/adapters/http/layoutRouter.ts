import express from 'express';
import { ZodError } from 'zod';
import { unresolvedGaps } from '../../../shared/src/layout/index.ts';
import type { LayoutStore } from '../../services/layoutStore.ts';

/** `GET/PUT /api/layout` — the graph-first layout document. */
export function createLayoutRouter({ layoutStore }: { layoutStore: LayoutStore }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(layoutStore.getLayout());
  });

  router.put('/', async (req, res) => {
    try {
      const doc = await layoutStore.save(req.body);
      const gaps = unresolvedGaps(layoutStore.getIndex());
      res.json({ ok: true, doc, unresolvedGaps: gaps.length });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          ok: false,
          message: 'Invalid layout document',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
        return;
      }
      throw err;
    }
  });

  return router;
}
