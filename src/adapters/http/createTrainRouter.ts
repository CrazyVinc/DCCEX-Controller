import express from 'express';
import multer from 'multer';
import {
  ImageRenameSchema,
  ImageReorderSchema,
  SpeedLimitSchema,
  TrainCreateSchema,
  TrainUpdateSchema,
} from '../../../shared/src/schemas/rollingStock.ts';
import type { RollingStockService } from '../../services/rollingStock.ts';
import { parseOr400, sendServiceError } from './validate.ts';

export function createTrainRouter({ rollingStockService }: { rollingStockService: RollingStockService }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', async (req, res) => {
    const body = parseOr400(TrainCreateSchema, req.body, res);
    if (!body) return;
    const train = await rollingStockService.addTrain({
      ...body,
      Speed: { ...body.Speed, limit: body.Speed.limit ?? 127 },
    });
    res.status(201).json({ success: true, message: 'Train added successfully', data: train });
  });

  router.post('/:dccId/speed-limit', async (req, res) => {
    const body = parseOr400(SpeedLimitSchema, req.body, res);
    if (!body) return;
    try {
      const updated = await rollingStockService.setTrainSpeedLimit(req.params.dccId, body.speedLimit);
      res.json({ success: true, message: 'Train speed limit updated successfully', data: updated });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.put('/:dccId', async (req, res) => {
    const body = parseOr400(TrainUpdateSchema, req.body, res);
    if (!body) return;
    try {
      const updated = await rollingStockService.updateTrain(req.params.dccId, body);
      res.json({ success: true, message: 'Train updated successfully', data: updated });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.delete('/:dccId', async (req, res) => {
    try {
      await rollingStockService.removeTrain(req.params.dccId);
      res.json({ success: true, message: 'Train removed successfully' });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.get('/:dccId/images', async (req, res) => {
    try {
      res.json({ success: true, data: await rollingStockService.listTrainImages(req.params.dccId) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:dccId/images', upload.single('image'), async (req, res) => {
    try {
      res.status(201).json({ success: true, data: await rollingStockService.addTrainImage(String(req.params.dccId), req.file) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:dccId/images/reorder', async (req, res) => {
    const body = parseOr400(ImageReorderSchema, req.body, res);
    if (!body) return;
    try {
      res.json({ success: true, data: await rollingStockService.reorderTrainImages(req.params.dccId, body.order) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post('/:dccId/images/rename', async (req, res) => {
    const body = parseOr400(ImageRenameSchema, req.body, res);
    if (!body) return;
    try {
      res.json({ success: true, data: await rollingStockService.renameTrainImage(req.params.dccId, body.oldName, body.newName) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.delete('/:dccId/images/:imageName', async (req, res) => {
    try {
      res.json({ success: true, data: await rollingStockService.removeTrainImage(req.params.dccId, String(req.params.imageName)) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  return router;
}
