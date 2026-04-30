import express from 'express';
import fs from 'fs';
import { createTrainRouter } from './createTrainRouter.js';
import { createWagonRouter } from './createWagonRouter.js';
export function createApiRouter({ rollingStockService, socketService, dccClient }) {
  const router = express.Router();

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

    if (typeof settings.swapForwardAndReverse !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'swapForwardAndReverse must be a boolean.',
      });
    }

    // Disable if no function keys are selected
    if (fnOnStart.keys.length === 0) {
      fnOnStart.enabled = false;
    }

    await fs.promises.writeFile(`${global.__dirname}/data/settings.json`, JSON.stringify(settings), 'utf-8');
    dccClient.setSwapForwardAndReverse(settings.swapForwardAndReverse);
    return res.status(200).json({ success: true, message: 'Settings updated successfully', data: settings });
  });

  router.get('/settings', async (req, res) => {
    const settings = await readSettings();
    return res.status(200).json({ success: true, data: settings });
  });

  router.use('/trains', createTrainRouter({ rollingStockService }));
  router.use('/wagons', createWagonRouter({ rollingStockService }));

  return router;
}
