export function setupDccWsAdapter({ socketService, dccEngine }) {
  if (!socketService) {
    throw new Error('setupDccWsAdapter requires socketService');
  }
  if (!dccEngine) {
    throw new Error('setupDccWsAdapter requires dccEngine');
  }

  dccEngine.on('connect', () => socketService.emit('dcc:connected'));
  dccEngine.on('disconnect', () => socketService.emit('dcc:disconnected'));
  dccEngine.on('power', (payload) => socketService.emit('dcc:power', payload));
  dccEngine.on('function', (payload) => socketService.emit('dcc:function', payload));
  dccEngine.on('throttle', (payload) => socketService.emit('dcc:throttle', payload));
  dccEngine.on('sent', (payload) => socketService.emit('dcc:sent', payload));
  dccEngine.on('message', (payload) => socketService.emit('dcc:message', payload));

  socketService.onConnection((socket) => {
    socket.emit('dcc:status', dccEngine.getStatus());

    socket.on('dcc:status', () => {
      socket.emit('dcc:status', dccEngine.getStatus());
    });

    socket.on('dcc:send', (command) => {
      dccEngine.sendRawCommand(command);
    });

    socket.on('dcc:setThrottle', (payload) => {
      dccEngine.setThrottle(payload);
    });

    socket.on('dcc:power:on', () => {
      dccEngine.powerOn();
    });

    socket.on('dcc:function', (payload) => {
      dccEngine.toggleFunction(payload);
    });

    socket.on('dcc:power:off', () => {
      dccEngine.powerOff();
    });

    socket.on('dcc:emergency-stop', () => {
      dccEngine.emergencyStop();
    });
  });
}
