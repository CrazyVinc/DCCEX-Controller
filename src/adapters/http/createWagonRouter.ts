import express from 'express';
import multer from 'multer';
import { ImageRenameSchema, ImageReorderSchema, WagonInputSchema } from '../../../shared/src/schemas/rollingStock.ts';
import type { RollingStockService } from '../../services/rollingStock.ts';
import { parseOr400, sendServiceError } from './validate.ts';

export function createWagonRouter({ rollingStockService }: { rollingStockService: RollingStockService }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', async (req, res) => {
    const body = parseOr400(WagonInputSchema, req.body, res);
    if (!body) return;
    const created = await rollingStockService.addWagon(body.Name, body.Length, body.serviceClass);
    res.status(201).json({ success: true, data: created });
  });

  router.put('/:wagonId', async (req, res) => {
    const body = parseOr400(WagonInputSchema, req.body, res);
    if (!body) return;
    try {
      res.json({ success: true, data: await rollingStockService.updateWagon(req.params.wagonId, body) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.delete('/:wagonId', async (req, res) => {
    try {
      await rollingStockService.removeWagon(req.params.wagonId);
      res.json({ success: true, message: 'Wagon removed successfully' });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.get('/:wagonId/images', async (req, res) => {
    try {
      res.json({ success: true, data: await rollingStockService.listWagonImages(req.params.wagonId) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:wagonId/images', upload.single('image'), async (req, res) => {
    try {
      res.status(201).json({ success: true, data: await rollingStockService.addWagonImage(String(req.params.wagonId), req.file) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:wagonId/images/reorder', async (req, res) => {
    const body = parseOr400(ImageReorderSchema, req.body, res);
    if (!body) return;
    try {
      res.json({ success: true, data: await rollingStockService.reorderWagonImages(req.params.wagonId, body.order) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:wagonId/images/rename', async (req, res) => {
    const body = parseOr400(ImageRenameSchema, req.body, res);
    if (!body) return;
    try {
      res.json({ success: true, data: await rollingStockService.renameWagonImage(req.params.wagonId, body.oldName, body.newName) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.delete('/:wagonId/images/:imageName', async (req, res) => {
    try {
      res.json({ success: true, data: await rollingStockService.removeWagonImage(req.params.wagonId, String(req.params.imageName)) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  return router;
}
