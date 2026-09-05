import express from 'express';
import { SettingsSchema } from '../../../shared/src/schemas/settings.ts';
import type { Dispatcher } from '../../core/dispatcher.ts';
import type { Interlocking } from '../../core/interlocking.ts';
import type { LiveService } from '../../core/liveService.ts';
import type { SensorBus } from '../../core/sensorBus.ts';
import type { TrainStateManager } from '../../core/trainState.ts';
import type { TurnoutStateStore } from '../../core/turnoutState.ts';
import type { ConsistStore } from '../../services/consistStore.ts';
import type { DccExClient } from '../../services/dccEx.ts';
import type { LayoutStore } from '../../services/layoutStore.ts';
import type { RollingStockService } from '../../services/rollingStock.ts';
import { readSettings, writeSettings } from '../../services/settingsStore.ts';
import type { SocketService } from '../ws/socketio.ts';
import { createConsistRouter } from './consistRouter.ts';
import { createDispatchRouter } from './dispatchRouter.ts';
import { createLayoutRouter } from './layoutRouter.ts';
import { createLiveRouter } from './liveRouter.ts';
import { createTrainRouter } from './createTrainRouter.ts';
import { createVisionRouter } from './visionRouter.ts';
import { createWagonRouter } from './createWagonRouter.ts';
import { parseOr400 } from './validate.ts';

interface Deps {
  rollingStockService: RollingStockService;
  socketService: SocketService;
  dccClient: DccExClient;
  layoutStore: LayoutStore;
  consistStore: ConsistStore;
  trainState: TrainStateManager;
  turnouts: TurnoutStateStore;
  sensors: SensorBus;
  liveService: LiveService;
  interlocking: Interlocking;
  dispatcher: Dispatcher;
}

export function createApiRouter({ rollingStockService, socketService, dccClient, layoutStore, consistStore, trainState, turnouts, sensors, liveService, interlocking, dispatcher }: Deps) {
  const router = express.Router();

  router.get('/rolling-stock', (req, res) => {
    res.json(rollingStockService.getRollingStock());
  });

  router.get('/health', (req, res) => {
    socketService.emit('routes:health', { at: Date.now() });
    res.json({ ok: true });
  });

  router.get('/settings', async (req, res) => {
    res.json({ success: true, data: await readSettings() });
  });

  router.post('/settings', async (req, res) => {
    const settings = parseOr400(SettingsSchema, (req.body as { settings?: unknown } | undefined)?.settings, res);
    if (!settings) return;
    // Disable startup functions when no keys are selected
    if (settings.FunctionOnStarts.keys.length === 0) {
      settings.FunctionOnStarts.enabled = false;
    }
    await writeSettings(settings);
    dccClient.setSwapForwardAndReverse(settings.swapForwardAndReverse);
    res.json({ success: true, message: 'Settings updated successfully', data: settings });
  });

  router.use('/trains', createTrainRouter({ rollingStockService }));
  router.use('/wagons', createWagonRouter({ rollingStockService }));
  router.use('/layout', createVisionRouter());
  router.use('/layout', createLayoutRouter({ layoutStore }));
  router.use('/consists', createConsistRouter({ consistStore, trainState }));
  router.use('/live', createLiveRouter({ trainState, turnouts, consistStore, sensors, liveService, interlocking }));
  router.use('/dispatch', createDispatchRouter({ dispatcher }));

  return router;
}
