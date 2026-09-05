import http from 'node:http';
import path from 'node:path';
import express from 'express';

import { bootstrapDataDirs } from './services/dataLayer.ts';
import { SocketService } from './adapters/ws/socketio.ts';
import dccExClient from './services/dccEx.ts';
import { RollingStockService } from './services/rollingStock.ts';
import { LayoutStore } from './services/layoutStore.ts';
import { ConsistStore } from './services/consistStore.ts';
import { DccEngine } from './core/dccEngine.ts';
import { TurnoutStateStore } from './core/turnoutState.ts';
import { TrainStateManager } from './core/trainState.ts';
import { SensorBus } from './core/sensorBus.ts';
import { Interlocking } from './core/interlocking.ts';
import { LiveService } from './core/liveService.ts';
import { Dispatcher } from './core/dispatcher.ts';
import { setupDccWsAdapter } from './adapters/ws/setupDccWsAdapter.ts';
import { setupLiveWsAdapter } from './adapters/ws/setupLiveWsAdapter.ts';
import { createApiRouter } from './adapters/http/createApiRouter.ts';
import { CLIENT_DIST_DIR, PUBLIC_DIR, ROLLING_STOCK_DIR, TURNOUTS_FILE } from './paths.ts';

/** Composition root: boot the core engine first, then wire HTTP + WS adapters. */
export async function createApp() {
  bootstrapDataDirs();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.use('/rollingstock-images', express.static(ROLLING_STOCK_DIR));

  const httpServer = http.createServer(app);
  const socketService = new SocketService(httpServer);

  const rollingStockService = new RollingStockService();
  const layoutStore = new LayoutStore();
  await layoutStore.load();
  const consistStore = new ConsistStore(rollingStockService);
  await consistStore.load();

  const turnouts = new TurnoutStateStore(() => layoutStore.getIndex(), { file: TURNOUTS_FILE });
  await turnouts.load();
  const sensors = new SensorBus();
  const trainState = new TrainStateManager({
    getIndex: () => layoutStore.getIndex(),
    getLength: (consistId) => {
      const consist = consistStore.get(consistId);
      return consist ? consistStore.totalLengthMm(consist) : 0;
    },
    turnoutStates: turnouts.resolver,
  });
  await trainState.load();

  const dccEngine = new DccEngine({ dccClient: dccExClient, rollingStockService });
  await dccEngine.start();

  const interlocking = new Interlocking();
  const liveService = new LiveService({ layoutStore, consistStore, rollingStock: rollingStockService, trainState, turnouts, sensors, dccEngine, interlocking });
  liveService.start();
  const dispatcher = new Dispatcher({ layoutStore, consistStore, rollingStock: rollingStockService, trainState, turnouts, interlocking, liveService });

  setupDccWsAdapter({ socketService, dccEngine });
  setupLiveWsAdapter({ socketService, trainState, turnouts, layoutStore, sensors, liveService, interlocking, dispatcher });

  app.use('/api', createApiRouter({ rollingStockService, socketService, dccClient: dccExClient, layoutStore, consistStore, trainState, turnouts, sensors, liveService, interlocking, dispatcher }));
  app.use(express.static(CLIENT_DIST_DIR));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });

  /** Orderly stop: trains halted + poses saved, track power off, DCC-EX and HTTP closed. */
  const shutdown = async () => {
    await liveService.shutdown();
    dccExClient.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { app, httpServer, socketService, dccEngine, rollingStockService, layoutStore, consistStore, trainState, turnouts, sensors, liveService, interlocking, dispatcher, shutdown };
}
