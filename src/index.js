import 'dotenv/config';

import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';

global.__dirname = path.dirname(fileURLToPath(import.meta.url));

import './services/dataLayer.js';

import { SocketService } from './socketio.js';
import { setupDccExSocket } from './services/dccex-socket.js';
import rollingStockService from './services/rollingStock.js';
import router from './routes/index.js';
import apiRouter from './routes/api.router.js';


const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.locals.devLiveReload = process.env.DEV_LIVE_RELOAD === '1';
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'pages'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

const httpServer = http.createServer(app);
const socketService = new SocketService(httpServer);
const rollingStock = rollingStockService.getRollingStock();
setupDccExSocket(socketService, undefined, rollingStock);



app.use('/', router);
app.use('/api', apiRouter);

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
