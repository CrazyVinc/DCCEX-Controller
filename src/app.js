import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';

import './services/dataLayer.js';
import { SocketService } from './socketio.js';
import dccExClient from './services/dccEx.js';
import rollingStockService from './services/rollingStock.js';
import { DccEngine } from './core/dccEngine.js';
import { setupDccWsAdapter } from './adapters/ws/setupDccWsAdapter.js';
import { createWebRouter } from './adapters/http/createWebRouter.js';
import { createApiRouter } from './adapters/http/createApiRouter.js';

export function createApp() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  global.__dirname = dirname;

  const app = express();
  app.locals.devLiveReload = process.env.DEV_LIVE_RELOAD === '1';
  app.set('view engine', 'ejs');
  app.set('views', path.join(dirname, 'ui'));
  app.use(express.static(path.join(dirname, '..', 'public')));
  app.use(express.json());

  const httpServer = http.createServer(app);
  const socketService = new SocketService(httpServer);

  const dccEngine = new DccEngine({
    dccClient: dccExClient,
    rollingStockService,
  });
  dccEngine.start();

  setupDccWsAdapter({ socketService, dccEngine });

  app.use('/', createWebRouter({ rollingStockService }));
  app.use('/api', createApiRouter({ rollingStockService, socketService }));

  return {
    app,
    httpServer,
    socketService,
    dccEngine,
    rollingStockService,
  };
}
