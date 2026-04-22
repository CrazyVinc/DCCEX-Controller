import express from 'express';
import fs from 'fs';
import multer from 'multer';
export function createApiRouter({ rollingStockService, socketService }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  const readSettings = async () => {
    const settingsJson = await fs.promises.readFile(`${global.__dirname}/data/settings.json`, 'utf-8');
    return JSON.parse(settingsJson);
  };

  router.get('/rolling-stock', (req, res) => {
    res.json(rollingStockService.getRollingStock());
  });

  router.get('/health', (req, res) => {
    socketService.emit('routes:health', { at: Date.now() });
    res.json({ ok: true });
  });

  router.post('/addTrain', async (req, res) => {
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

  router.post('/trains/:dccId/speed-limit', async (req, res) => {
    const { dccId } = req.params;
    const { speedLimit } = req.body;
    if (!Number.isInteger(speedLimit) || speedLimit < 0 || speedLimit > 127) {
      return res.status(400).json({
        success: false,
        message: 'speedLimit must be an integer between 0 and 127.',
      });
    }

    try {
      const settings = await readSettings();
      const globalSpeedLimit = Number(settings.GlobalSpeedCab ?? 127);
      if (speedLimit > globalSpeedLimit) {
        return res.status(400).json({
          success: false,
          message: `speedLimit cannot be greater than GlobalSpeedCab (${globalSpeedLimit}).`,
        });
      }

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

  router.put('/trains/:dccId', async (req, res) => {
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

  router.delete('/trains/:dccId', async (req, res) => {
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

  router.get('/trains/:dccId/images', async (req, res) => {
    const { dccId } = req.params;
    try {
      const images = await rollingStockService.listTrainImages(dccId);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(404).json({ success: false, message: error.message });
    }
  });

  router.post('/trains/:dccId/images', upload.single('image'), async (req, res) => {
    const { dccId } = req.params;
    try {
      const images = await rollingStockService.addTrainImage(dccId, req.file);
      return res.status(201).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  router.post('/trains/:dccId/images/reorder', async (req, res) => {
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

  router.delete('/trains/:dccId/images/:imageName', async (req, res) => {
    const { dccId, imageName } = req.params;
    try {
      const images = await rollingStockService.removeTrainImage(dccId, imageName);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  router.post('/settings', async (req, res) => {
    const { settings } = req.body;
    // Clear and readable validation with messages for each possible error
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Settings payload must be an object.',
      });
    }

    const fnOnStart = settings.FunctionOnStarts;
    if (!fnOnStart || typeof fnOnStart !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'FunctionOnStarts must be provided as an object.',
      });
    }

    if (!Array.isArray(fnOnStart.keys)) {
      return res.status(400).json({
        success: false,
        message: 'FunctionOnStarts.keys must be an array.',
      });
    }

    if (!fnOnStart.keys.every((key) => Number.isInteger(key))) {
      return res.status(400).json({
        success: false,
        message: 'FunctionOnStarts.keys must contain only integers.',
      });
    }

    if (typeof fnOnStart.enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'FunctionOnStarts.enabled must be a boolean.',
      });
    }

    const globalSpeedCab = Number(settings.GlobalSpeedCab);
    if (!Number.isInteger(globalSpeedCab) || globalSpeedCab < 0 || globalSpeedCab > 127) {
      return res.status(400).json({
        success: false,
        message: 'GlobalSpeedCab must be an integer between 0 and 127.',
      });
    }

    // Disable if no function keys are selected
    if (fnOnStart.keys.length === 0) {
      fnOnStart.enabled = false;
    }

    const rollingStock = rollingStockService.getRollingStock();
    const trainsOverGlobal = rollingStock.trains.filter((train) => Number(train.Speed?.limit ?? 127) > globalSpeedCab);
    await Promise.all(trainsOverGlobal.map((train) => rollingStockService.setTrainSpeedLimit(train.DCC_ID, globalSpeedCab)));

    
    console.log('Settings updated:', settings);

    await fs.promises.writeFile(`${global.__dirname}/data/settings.json`, JSON.stringify(settings), 'utf-8');
    return res.status(200).json({ success: true, message: 'Settings updated successfully', data: settings });
  });

  router.get('/settings', async (req, res) => {
    const settings = await readSettings();
    return res.status(200).json({ success: true, data: settings });
  });

  return router;
}
