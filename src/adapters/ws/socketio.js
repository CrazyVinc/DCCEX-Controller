import { Server } from 'socket.io';

export class SocketService {
  constructor(httpServer, options = {}) {
    this.io = new Server(httpServer, {
      cors: { origin: '*' },
      ...options,
    });
    this.onConnectFns = [];

    this.io.on('connection', (socket) => {
      for (const fn of this.onConnectFns) {
        fn(socket);
      }
    });
  }

  onConnection(fn) {
    this.onConnectFns.push(fn);
    return this;
  }

  emit(event, ...args) {
    this.io.emit(event, ...args);
  }

  on(event, listener) {
    this.io.on(event, listener);
    return this;
  }

  getServer() {
    return this.io;
  }
}
