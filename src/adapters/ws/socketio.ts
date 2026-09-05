import type http from 'node:http';
import { Server, type ServerOptions, type Socket } from 'socket.io';

type ConnectionHandler = (socket: Socket) => void;

/** Thin wrapper around the Socket.IO server so adapters can register connection handlers. */
export class SocketService {
  readonly io: Server;
  private readonly onConnectFns: ConnectionHandler[] = [];

  constructor(httpServer: http.Server, options: Partial<ServerOptions> = {}) {
    this.io = new Server(httpServer, { cors: { origin: '*' }, ...options });
    this.io.on('connection', (socket) => {
      for (const fn of this.onConnectFns) {
        fn(socket);
      }
    });
  }

  onConnection(fn: ConnectionHandler): this {
    this.onConnectFns.push(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    this.io.emit(event, ...args);
  }
}
