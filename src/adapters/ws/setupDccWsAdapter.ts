import type { DccEngine } from '../../core/dccEngine.ts';
import type { SocketService } from './socketio.ts';

interface Deps {
  socketService: SocketService;
  dccEngine: DccEngine;
}

/** Maps browser `dcc:*` events to engine calls and broadcasts engine events to all clients. */
export function setupDccWsAdapter({ socketService, dccEngine }: Deps): void {
  dccEngine.on('connect', () => socketService.emit('dcc:connected'));
  dccEngine.on('disconnect', () => socketService.emit('dcc:disconnected'));
  dccEngine.on('power', (payload) => socketService.emit('dcc:power', payload));
  dccEngine.on('function', (payload) => socketService.emit('dcc:function', payload));
  dccEngine.on('throttle', (payload) => socketService.emit('dcc:throttle', payload));
  dccEngine.on('sent', (payload) => socketService.emit('dcc:sent', payload));
  dccEngine.on('message', (payload) => socketService.emit('dcc:message', payload));
  dccEngine.on('error', (error) => socketService.emit('dcc:error', { message: error.message }));

  socketService.onConnection((socket) => {
    socket.emit('dcc:status', dccEngine.getStatus());

    socket.on('dcc:status', () => socket.emit('dcc:status', dccEngine.getStatus()));
    socket.on('dcc:send', (command: unknown) => dccEngine.sendRawCommand(command));
    socket.on('dcc:setThrottle', (payload: { cab: number; speed: number; dir: number }) => dccEngine.setThrottle(payload));
    socket.on('dcc:power:on', () => dccEngine.powerOn());
    socket.on('dcc:power:off', () => dccEngine.powerOff());
    socket.on('dcc:function', (payload: { cab: number; function: number | string }) => dccEngine.toggleFunction(payload));
    socket.on('dcc:emergency-stop', () => dccEngine.emergencyStop());
  });
}
