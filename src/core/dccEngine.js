import EventEmitter from 'events';

export class DccEngine extends EventEmitter {
  constructor({ dccClient, rollingStockService }) {
    super();
    this.dccClient = dccClient;
    this.rollingStockService = rollingStockService;
    this.started = false;
    this.boundHandlers = null;
  }

  start() {
    if (this.started) {
      return;
    }

    const rollingStock = this.rollingStockService.getRollingStock();
    const startupCabs = rollingStock.trains.map((train) => train.DCC_ID);
    this.dccClient.setStartupCabs(startupCabs);

    const onConnect = () => this.emit('connect');
    const onDisconnect = () => this.emit('disconnect');
    const onPower = (power) => this.emit('power', { power });
    const onFunction = (payload) => this.emit('function', payload);
    const onThrottle = (payload) => this.emit('throttle', payload);
    const onMessage = (message) => this.emit('message', { message });
    const onError = (error) => this.emit('error', error);

    this.boundHandlers = {
      onConnect,
      onDisconnect,
      onPower,
      onFunction,
      onThrottle,
      onMessage,
      onError,
    };

    this.dccClient.on('connect', onConnect);
    this.dccClient.on('disconnect', onDisconnect);
    this.dccClient.on('power', onPower);
    this.dccClient.on('function', onFunction);
    this.dccClient.on('throttle', onThrottle);
    this.dccClient.on('message', onMessage);
    this.dccClient.on('error', onError);

    this.dccClient.connect();
    this.started = true;
  }

  getRollingStock() {
    return this.rollingStockService.getRollingStock();
  }

  getStatus() {
    return {
      connected: this.dccClient.connected,
      power: this.dccClient.getPower(),
      throttleByCab: this.dccClient.getAllThrottle(),
      rollingStock: this.getRollingStock(),
    };
  }

  sendRawCommand(command) {
    if (typeof command === 'string' && command.trim()) {
      this.dccClient.send(command.trim());
    }
  }

  setThrottle({ cab, speed, dir }) {
    this.dccClient.setThrottle(cab, speed, dir);
  }

  powerOn() {
    this.dccClient.powerOn();
  }

  powerOff() {
    this.dccClient.powerOff();
  }

  toggleFunction({ cab, function: fn }) {
    this.dccClient.toggleFunction(cab, fn);
  }
}
