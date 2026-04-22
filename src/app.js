import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';

import './services/dataLayer.js';
import { SocketService } from './adapters/ws/socketio.js';
import dccExClient from './services/dccEx.js';
import rollingStockService from './services/rollingStock.js';
import { DccEngine } from './core/dccEngine.js';
import { setupDccWsAdapter } from './adapters/ws/setupDccWsAdapter.js';
import { createApiRouter } from './adapters/http/createApiRouter.js';

export function createApp() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  global.__dirname = path.join(dirname, '..');

  const app = express();
  const publicDir = path.join(dirname, '..', 'public');
  const clientDist = path.join(dirname, '..', 'client', 'dist');
  const rollingStockImagesDir = path.join(dirname, '..', 'data', 'rollingstock');

  app.use(express.json());
  app.use(express.static(publicDir));
  app.use('/rollingstock-images', express.static(rollingStockImagesDir));

  const httpServer = http.createServer(app);
  const socketService = new SocketService(httpServer);

  const dccEngine = new DccEngine({
    dccClient: dccExClient,
    rollingStockService,
  });
  dccEngine.start();

  setupDccWsAdapter({ socketService, dccEngine });

  app.use('/api', createApiRouter({ rollingStockService, socketService }));
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return {
    app,
    httpServer,
    socketService,
    dccEngine,
    rollingStockService,
  };
}
