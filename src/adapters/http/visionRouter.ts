import express from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { analyzeTrackPhoto, OllamaUnavailableError } from '../../services/ollamaVision.ts';

/** `POST /api/layout/import-photo` — photo → candidate track elements (never touches the live layout). */
export function createVisionRouter() {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  router.post('/import-photo', upload.single('photo'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ ok: false, message: 'Upload a photo in the "photo" field' });
      return;
    }
    if (!/^image\//.test(req.file.mimetype)) {
      res.status(400).json({ ok: false, message: 'Only image uploads are supported' });
      return;
    }
    const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : undefined;
    try {
      const analysis = await analyzeTrackPhoto(req.file.buffer, { model });
      res.json({ ok: true, ...analysis });
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        res.status(503).json({ ok: false, message: err.message });
        return;
      }
      if (err instanceof ZodError) {
        res.status(502).json({ ok: false, message: 'The vision model did not return the expected structure', issues: err.issues.map((i) => i.message) });
        return;
      }
      res.status(502).json({ ok: false, message: (err as Error).message });
    }
  });

  return router;
}
