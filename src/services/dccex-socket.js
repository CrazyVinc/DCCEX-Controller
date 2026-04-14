import defaultDccEx from './dccEx.js';

/**
 * Basic Socket.IO bridge for DCC-EX.
 * @param {import('../socketio.js').SocketService} socketService
 * @param {import('./dccEx.js').default} dccExClient
 */
export function setupDccExSocket(socketService, dccExClient = defaultDccEx, rollingStock) {
  if (!socketService) {
    throw new Error('setupDccExSocket requires socketService');
  }

  const startupCabs = Array.isArray(rollingStock?.trains)
    ? rollingStock.trains.map((train) => train?.DCC_ID)
    : [];
  dccExClient.setStartupCabs(startupCabs);

  dccExClient.on('connect', () => {
    socketService.emit('dcc:connected');
  });

  dccExClient.on('disconnect', () => {
    socketService.emit('dcc:disconnected');
  });

  dccExClient.on('power', (power) => {
    socketService.emit('dcc:power', { power });
  });

  dccExClient.on('function', (payload) => {
    socketService.emit('dcc:function', payload);
  });

  dccExClient.on('throttle', (payload) => {
    socketService.emit('dcc:throttle', payload);
  });

  dccExClient.on('message', (message) => {
    socketService.emit('dcc:message', { message });
  });

  socketService.onConnection((socket) => {
    socket.emit('dcc:status', {
      connected: dccExClient.connected,
      power: dccExClient.getPower(),
      throttleByCab: dccExClient.getAllThrottle(),
      rollingStock,
    });

    socket.on('dcc:status', () => {
      socket.emit('dcc:status', {
        connected: dccExClient.connected,
        power: dccExClient.getPower(),
        throttleByCab: dccExClient.getAllThrottle(),
        rollingStock,
      });
    });

    socket.on('dcc:send', (command) => {
      if (typeof command === 'string' && command.trim()) {
        dccExClient.send(command.trim());
      }
    });

    socket.on('dcc:setThrottle', (payload) => {
      dccExClient.setThrottle(payload.cab, payload.speed, payload.dir);
    });

    socket.on('dcc:power:on', () => {
      dccExClient.powerOn();
    });

    socket.on('dcc:function', (payload) => {
      dccExClient.toggleFunction(payload.cab, payload.function);
    });

    socket.on('dcc:power:off', () => {
      dccExClient.powerOff();
    });
  });

  dccExClient.connect();
}
