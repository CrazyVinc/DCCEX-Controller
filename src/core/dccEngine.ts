import EventEmitter from 'node:events';
import type { Settings } from '../../shared/src/schemas/settings.ts';
import type { DccExClient } from '../services/dccEx.ts';
import type { RollingStockService } from '../services/rollingStock.ts';
import { readSettings } from '../services/settingsStore.ts';

export interface DccEngineEvents {
  connect: [];
  disconnect: [];
  power: [{ power: boolean }];
  function: [{ cab: number; fn: number; on: boolean }];
  throttle: [{ cab: number; speed: number; dir: 0 | 1 }];
  sent: [{ command: string }];
  message: [{ message: string }];
  error: [Error];
}

interface DccEngineDeps {
  dccClient: DccExClient;
  rollingStockService: RollingStockService;
}

/** Parse a roster function token (`"F3"`, `"3"`, `3`) into a function number. */
function functionNumber(raw: number | string): number | null {
  const token = String(raw).trim();
  if (!token) return null;
  const n = Number(token.toUpperCase().startsWith('F') ? token.slice(1) : token);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Always-on domain shell around the DCC-EX client: applies roster/settings at connect,
 * exposes commands + status and re-emits client events as domain events.
 */
export class DccEngine extends EventEmitter<DccEngineEvents> {
  readonly dccClient: DccExClient;
  readonly rollingStockService: RollingStockService;
  private started = false;
  private lastErrorMessage: string | null = null;

  constructor({ dccClient, rollingStockService }: DccEngineDeps) {
    super();
    this.dccClient = dccClient;
    this.rollingStockService = rollingStockService;
  }

  applyStartupFunctions(settings: Settings): void {
    if (!settings.FunctionOnStarts.enabled) return;

    const startupFunctionKeys = settings.FunctionOnStarts.keys;
    for (const train of this.rollingStockService.getRollingStock().trains) {
      const cab = Number(train.DCC_ID);
      const rosterFns = new Set(train.Functions.map(functionNumber).filter((n): n is number => n != null));
      for (const fn of startupFunctionKeys) {
        if (rosterFns.has(fn)) {
          this.dccClient.toggleFunction(cab, fn, 1);
        }
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) return;

    const settings = await readSettings();
    this.dccClient.setSwapForwardAndReverse(settings.swapForwardAndReverse);
    this.dccClient.setStartupCabs(this.rollingStockService.getRollingStock().trains.map((train) => train.DCC_ID));

    this.dccClient.on('connect', () => {
      this.applyStartupFunctions(settings);
      this.emit('connect');
    });
    this.dccClient.on('disconnect', () => this.emit('disconnect'));
    this.dccClient.on('power', (power) => this.emit('power', { power }));
    this.dccClient.on('function', (payload) => this.emit('function', payload));
    this.dccClient.on('throttle', (payload) => this.emit('throttle', payload));
    this.dccClient.on('sent', (command) => this.emit('sent', { command }));
    this.dccClient.on('message', (message) => this.emit('message', { message }));
    this.dccClient.on('error', (error) => {
      // The client reconnects every few seconds; log each distinct failure once instead of spamming.
      const message = error.message;
      if (message !== this.lastErrorMessage) {
        this.lastErrorMessage = message;
        console.error(`[dcc-ex] ${message}`);
      }
      if (this.listenerCount('error') > 0) this.emit('error', error);
    });
    this.dccClient.on('connect', () => {
      this.lastErrorMessage = null;
    });

    this.dccClient.connect();
    this.started = true;
  }

  getStatus() {
    return {
      connected: this.dccClient.connected,
      power: this.dccClient.getPower(),
      throttleByCab: this.dccClient.getAllThrottle(),
      enabledFunctionsByCab: this.dccClient.enabledFunctionsByCab,
      rollingStock: this.rollingStockService.getRollingStock(),
    };
  }

  sendRawCommand(command: unknown): void {
    if (typeof command === 'string' && command.trim()) {
      this.dccClient.send(command.trim());
    }
  }

  setThrottle({ cab, speed, dir }: { cab: number; speed: number; dir: number }): void {
    this.dccClient.setThrottle(cab, speed, dir);
  }

  powerOn(): void {
    this.dccClient.powerOn();
  }

  powerOff(): void {
    this.dccClient.powerOff();
  }

  emergencyStop(): void {
    this.dccClient.emergencyStop();
  }

  toggleFunction({ cab, function: fn }: { cab: number; function: number | string }): void {
    this.dccClient.toggleFunction(cab, fn);
  }
}
