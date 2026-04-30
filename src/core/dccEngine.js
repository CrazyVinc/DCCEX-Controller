import EventEmitter from 'events';
import fs from 'fs';

export class DccEngine extends EventEmitter {
  constructor({ dccClient, rollingStockService }) {
    super();
    this.dccClient = dccClient;
    this.rollingStockService = rollingStockService;
    this.started = false;
    this.boundHandlers = null;
  }

  applyStartupFunctions(settings) {
    if (!settings?.FunctionOnStarts?.enabled) {
      return;
    }

    const trains = this.rollingStockService.getRollingStock().trains;
    const startupFunctionKeys = settings.FunctionOnStarts.keys;

    const rosterFn = (raw) => {
      const token = String(raw).trim();
      if (!token) {
        return null;
      }
      const n = Number(token.toUpperCase().startsWith('F') ? token.slice(1) : token);
      return Number.isInteger(n) && n >= 0 ? n : null;
    };

    trains.forEach((train) => {
      const cab = train.DCC_ID;
      const rosterFns = new Set(
        train.Functions.map(rosterFn).filter((n) => n != null),
      );
      startupFunctionKeys.forEach((fn) => {
        const fnNum = rosterFn(fn);
        if (fnNum != null && rosterFns.has(fnNum)) {
          this.dccClient.toggleFunction(cab, fnNum, 1);
        }
      });
    });
  }

  start() {
    if (this.started) {
      return;
    }

    let settings = null;
    try {
      settings = JSON.parse(fs.readFileSync(`${global.__dirname}/data/settings.json`, 'utf-8'));
    } catch (err) {
      console.error('Error reading settings.json:', err);
    }

    const swapForwardAndReverse = !settings || settings.swapForwardAndReverse !== false;
    this.dccClient.setSwapForwardAndReverse(swapForwardAndReverse);

    const rollingStock = this.rollingStockService.getRollingStock();
    const startupCabs = rollingStock.trains.map((train) => train.DCC_ID);
    this.dccClient.setStartupCabs(startupCabs);

    const onConnect = () => {
      this.applyStartupFunctions(settings);
      this.emit('connect');
    };
    const onDisconnect = () => this.emit('disconnect');
    const onPower = (power) => this.emit('power', { power });
    const onFunction = (payload) => this.emit('function', payload);
    const onThrottle = (payload) => this.emit('throttle', payload);
    const onSent = (command) => this.emit('sent', { command });
    const onMessage = (message) => this.emit('message', { message });
    const onError = (error) => this.emit('error', error);

    this.boundHandlers = {
      onConnect,
      onDisconnect,
      onPower,
      onFunction,
      onThrottle,
      onSent,
      onMessage,
      onError,
    };

    this.dccClient.on('connect', onConnect);
    this.dccClient.on('disconnect', onDisconnect);
    this.dccClient.on('power', onPower);
    this.dccClient.on('function', onFunction);
    this.dccClient.on('throttle', onThrottle);
    this.dccClient.on('sent', onSent);
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
      enabledFunctionsByCab: this.dccClient.enabledFunctionsByCab,
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

  emergencyStop() {
    this.dccClient.emergencyStop();
  }

  toggleFunction({ cab, function: fn }) {
    this.dccClient.toggleFunction(cab, fn);
  }
}
