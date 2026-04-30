import express from 'express';
import multer from 'multer';

export function createTrainRouter({ rollingStockService }) {
  const trainRouter = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  trainRouter.post('/', async (req, res) => {
    const { DCC_ID, Name, Length, Speed, startDelay, Functions, Notes, Meta } = req.body;

    try {
      const result = await rollingStockService.addTrain(
        DCC_ID,
        Name,
        Length,
        Speed,
        startDelay,
        Functions,
        Notes,
        Meta,
        Number(Speed.limit ?? 127),
      );
      res.status(201).json({
        success: true,
        message: 'Train added successfully',
        data: result,
      });
    } catch (error) {
      console.error('Error adding train:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add train to rolling stock',
        error: error.message,
      });
    }
  });

  trainRouter.post('/:dccId/speed-limit', async (req, res) => {
    const { dccId } = req.params;
    const { speedLimit } = req.body;
    if (!Number.isInteger(speedLimit) || speedLimit < 0 || speedLimit > 127) {
      return res.status(400).json({
        success: false,
        message: 'speedLimit must be an integer between 0 and 127.',
      });
    }

    try {
      const updated = await rollingStockService.setTrainSpeedLimit(dccId, speedLimit);
      return res.status(200).json({
        success: true,
        message: 'Train speed limit updated successfully',
        data: updated,
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  });

  trainRouter.put('/:dccId', async (req, res) => {
    const { dccId } = req.params;
    const { Name, Length, Speed, startDelay, Functions, Notes, Meta } = req.body;
    try {
      const updated = await rollingStockService.updateTrain(dccId, {
        Name,
        Length,
        Speed,
        startDelay,
        Functions,
        Notes,
        Meta,
      });
      return res.status(200).json({
        success: true,
        message: 'Train updated successfully',
        data: updated,
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  });

  trainRouter.delete('/:dccId', async (req, res) => {
    const { dccId } = req.params;
    try {
      await rollingStockService.removeTrain(dccId);
      return res.status(200).json({
        success: true,
        message: 'Train removed successfully',
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  });

  trainRouter.get('/:dccId/images', async (req, res) => {
    const { dccId } = req.params;
    try {
      const images = await rollingStockService.listTrainImages(dccId);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(404).json({ success: false, message: error.message });
    }
  });

  trainRouter.post('/:dccId/images', upload.single('image'), async (req, res) => {
    const { dccId } = req.params;
    try {
      const images = await rollingStockService.addTrainImage(dccId, req.file);
      return res.status(201).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  trainRouter.post('/:dccId/images/reorder', async (req, res) => {
    const { dccId } = req.params;
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order must be an array of image file names' });
    }
    try {
      const images = await rollingStockService.reorderTrainImages(dccId, order);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  trainRouter.post('/:dccId/images/rename', async (req, res) => {
    const { dccId } = req.params;
    const { oldName, newName } = req.body;
    if (typeof oldName !== 'string' || typeof newName !== 'string') {
      return res.status(400).json({ success: false, message: 'oldName and newName are required' });
    }
    try {
      const images = await rollingStockService.renameTrainImage(dccId, oldName, newName);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  trainRouter.delete('/:dccId/images/:imageName', async (req, res) => {
    const { dccId, imageName } = req.params;
    try {
      const images = await rollingStockService.removeTrainImage(dccId, imageName);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  return trainRouter;
}
