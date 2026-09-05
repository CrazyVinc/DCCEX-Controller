import net from 'node:net';
import EventEmitter from 'node:events';

export interface ThrottleState {
  speed: number;
  /** 0 = reverse, 1 = forward (application convention, after swap correction). */
  dir: 0 | 1;
}

export interface DccExEvents {
  connect: [];
  disconnect: [];
  power: [boolean];
  function: [{ cab: number; fn: number; on: boolean }];
  throttle: [{ cab: number; speed: number; dir: 0 | 1 }];
  /** Occupancy sensor changed: `<Q id>` = active, `<q id>` = inactive. */
  sensor: [{ id: number; active: boolean }];
  /** Sensor definition from `<S>`: `<Q id vpin pullup>`. */
  sensorDefined: [{ id: number; vpin: number; pullup: boolean }];
  /** Turnout feedback `<H id thrown>` (also emitted for each turnout listed by `<T>`). */
  turnout: [{ id: number; thrown: boolean }];
  sent: [string];
  message: [string];
  error: [Error];
}

interface DccExClientOptions {
  host: string;
  port: number;
  autoReconnect?: boolean;
  startupCabs?: Array<number | string>;
  swapForwardAndReverse?: boolean;
}

/**
 * TCP client for a DCC-EX command station (`<...>` text protocol).
 * Keeps a small cache of power / throttle / function state and re-emits parsed events.
 */
export class DccExClient extends EventEmitter<DccExEvents> {
  host: string;
  port: number;
  autoReconnect: boolean;
  /** When true, flip the DCC-EX direction bit on send and on loco status parse (0↔1). */
  swapForwardAndReverse: boolean;

  socket: net.Socket | null = null;
  connected = false;

  private queue: string[] = [];
  private isWriting = false;
  private drainWaiters: Array<() => void> = [];
  private buffer = '';
  private reconnectDelay = 2000;

  power: boolean | null = null;
  enabledFunctionsByCab: Record<number, Record<number, boolean>> = {};
  throttleByCab: Record<number, ThrottleState> = {};
  startupCabs: number[];

  constructor({ host, port, autoReconnect = true, startupCabs = [], swapForwardAndReverse = true }: DccExClientOptions) {
    super();
    this.host = host;
    this.port = port;
    this.autoReconnect = autoReconnect;
    this.swapForwardAndReverse = Boolean(swapForwardAndReverse);
    this.startupCabs = normalizeCabs(startupCabs);
  }

  connect(): void {
    if (this.socket) return;

    const socket = new net.Socket();
    this.socket = socket;

    socket.connect(this.port, this.host, () => {
      this.connected = true;
      this.emit('connect');
      // Request full status snapshot, sensor definitions and turnout states.
      this.send('s');
      this.send('S');
      this.send('T');
      this.requestStartupLocoStatus();
      this.flushQueue();
    });

    socket.on('data', (data) => this.handleData(data.toString()));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
      socket.destroy();
      this.socket = null;
      if (this.autoReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
      }
    });
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Send a raw DCC-EX command (without the surrounding `<>`). */
  send(command: string): void {
    const trimmed = command.trim();
    // Keep cache + dcc:power in sync when power is toggled via raw send (e.g. dcc:send "1"/"0")
    if (trimmed === '1') {
      this.setPower(true);
    } else if (trimmed === '0') {
      this.setPower(false);
    } else {
      this.trySyncFunctionFromCommand(trimmed);
    }

    const formatted = `<${trimmed}>`;
    this.emit('sent', formatted);
    this.queue.push(formatted);
    this.flushQueue();
  }

  /** Resolves once every queued command has been written to the socket (immediately when not connected). */
  drain(): Promise<void> {
    if (!this.connected || (this.queue.length === 0 && !this.isWriting)) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private flushQueue(): void {
    if (this.queue.length === 0 && !this.isWriting) {
      for (const resolve of this.drainWaiters.splice(0)) resolve();
    }
    if (!this.connected || this.isWriting || this.queue.length === 0 || !this.socket) {
      return;
    }
    this.isWriting = true;
    const cmd = this.queue.shift()!;
    this.socket.write(cmd, () => {
      this.isWriting = false;
      this.flushQueue();
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('>')) !== -1) {
      const message = this.buffer.slice(0, index + 1);
      this.buffer = this.buffer.slice(index + 1);
      this.parseMessage(message);
      this.emit('message', message);
    }
  }

  protected parseMessage(msg: string): void {
    const normalized = msg.trim();
    if (!normalized) return;

    // Example: <p1> or <p0>
    if (normalized.startsWith('<p')) {
      this.setPower(normalized.includes('1'));
      return;
    }
    if (this.tryParseSensor(normalized)) return;
    if (this.tryParseTurnout(normalized)) return;
    this.trySyncFunctionFromLocoStatus(normalized);
  }

  /** `<Q id>` active, `<q id>` inactive, `<Q id vpin pullup>` definition. */
  private tryParseSensor(msg: string): boolean {
    const m = msg.match(/^<\s*([Qq])\s+(-?\d+)(?:\s+(-?\d+)\s+(\d+))?\s*>$/);
    if (!m) return false;
    const id = Number(m[2]);
    if (m[3] !== undefined) {
      this.emit('sensorDefined', { id, vpin: Number(m[3]), pullup: m[4] === '1' });
      return true;
    }
    this.emit('sensor', { id, active: m[1] === 'Q' });
    return true;
  }

  /** `<H id thrown>` broadcast or `<H id DCC addr subaddr thrown>` / `<H id VPIN pin thrown>` from `<T>`. */
  private tryParseTurnout(msg: string): boolean {
    const m = msg.match(/^<\s*H\s+(-?\d+)\s+(.*?)\s*>$/);
    if (!m) return false;
    const parts = m[2]!.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    if (last !== '0' && last !== '1') return false;
    this.emit('turnout', { id: Number(m[1]), thrown: last === '1' });
    return true;
  }

  setStartupCabs(cabs: Array<number | string> = []): void {
    this.startupCabs = normalizeCabs(cabs);
  }

  setSwapForwardAndReverse(swap: boolean): void {
    this.swapForwardAndReverse = Boolean(swap);
  }

  private directionToWire(appDir: number): 0 | 1 {
    const d: 0 | 1 = Number(appDir) === 0 ? 0 : 1;
    return this.swapForwardAndReverse ? ((d ^ 1) as 0 | 1) : d;
  }

  private directionFromWire(wireDir: number): 0 | 1 {
    const d: 0 | 1 = Number(wireDir) === 0 ? 0 : 1;
    return this.swapForwardAndReverse ? ((d ^ 1) as 0 | 1) : d;
  }

  private requestStartupLocoStatus(): void {
    for (const cab of this.startupCabs) {
      this.send(`t ${cab}`);
    }
  }

  getPower(): boolean | null {
    return this.power;
  }

  private setPower(state: boolean): void {
    if (this.power !== state) {
      this.power = state;
      this.emit('power', this.power);
    }
  }

  getEnabledFunctions(cab: number): Record<number, boolean> {
    return this.enabledFunctionsByCab[cab] || {};
  }

  getThrottle(cab: number): ThrottleState | null {
    return this.throttleByCab[cab] || null;
  }

  getAllThrottle(): Record<number, ThrottleState> {
    return this.throttleByCab;
  }

  /** DCC-EX function command: F {cab} {fn} {0|1} */
  private trySyncFunctionFromCommand(trimmed: string): void {
    const m = trimmed.match(/^[fF]\s+(\d+)\s+(\d+)\s+([01])$/);
    if (!m) return;
    this.setFunctionState(Number(m[1]), Number(m[2]), m[3] === '1');
  }

  /** Sync from loco status response `<l cab reg speedByte functionBitmask>`. */
  private trySyncFunctionFromLocoStatus(msg: string): void {
    const m = msg.match(/^<\s*[lL]\s+(\d+)\s+(-?\d+)\s+([01])\s+(\d+)[^>]*>$/);
    if (!m) return;

    const cab = Number(m[1]);
    const rawSpeed = Number(m[2]);
    const rawDirection = Number(m[3]);
    const functionBitmask = Number(m[4]);
    if (!Number.isInteger(cab) || cab < 0 || !Number.isInteger(functionBitmask) || functionBitmask < 0) {
      return;
    }

    const speed = Number.isFinite(rawSpeed) ? Math.max(0, Math.min(126, Math.abs(rawSpeed))) : 0;
    this.setThrottleState(cab, speed, this.directionFromWire(rawDirection));

    const nextStates: Record<number, boolean> = {};
    for (let fn = 0; fn <= 31; fn += 1) {
      nextStates[fn] = ((functionBitmask >> fn) & 1) === 1;
    }
    this.enabledFunctionsByCab[cab] = nextStates;
    for (let fn = 0; fn <= 31; fn += 1) {
      this.emit('function', { cab, fn, on: nextStates[fn]! });
    }
  }

  private setThrottleState(cab: number, speed: number, dir: number): void {
    const normalizedSpeed = Math.max(0, Math.min(126, Math.round(Number(speed) || 0)));
    const normalizedDirection: 0 | 1 = Number(dir) === 0 ? 0 : 1;
    const prev = this.throttleByCab[cab];
    if (prev && prev.speed === normalizedSpeed && prev.dir === normalizedDirection) {
      return;
    }
    const next: ThrottleState = { speed: normalizedSpeed, dir: normalizedDirection };
    this.throttleByCab[cab] = next;
    this.emit('throttle', { cab, ...next });
  }

  private setFunctionState(cab: number, fn: number, on: boolean): void {
    if (!this.enabledFunctionsByCab[cab]) {
      this.enabledFunctionsByCab[cab] = {};
    }
    if (this.enabledFunctionsByCab[cab]![fn] === on) return;
    this.enabledFunctionsByCab[cab]![fn] = on;
    this.emit('function', { cab, fn, on });
  }

  /* -------------------------
   * HIGH LEVEL COMMANDS
   * ------------------------- */

  /** Set throttle: speed 0-126, dir 0 = reverse, 1 = forward. */
  setThrottle(cab: number, speed: number, direction: number = 1): void {
    const cabNumber = Number(cab);
    const speedStep = Number(speed);
    if (!Number.isInteger(cabNumber) || cabNumber < 0 || !Number.isFinite(speedStep)) {
      return;
    }
    const clampedSpeed = Math.max(0, Math.min(126, Math.round(speedStep)));
    const appDir: 0 | 1 = Number(direction) === 0 ? 0 : 1;
    this.setThrottleState(cabNumber, clampedSpeed, appDir);
    // DCC-EX: lowercase `t` = throttle; uppercase `T` = turnout.
    this.send(`t ${cabNumber} ${clampedSpeed} ${this.directionToWire(appDir)}`);
  }

  emergencyStop(): void {
    this.send('!');
  }

  powerOn(): void {
    this.setPower(true);
    this.send('1');
  }

  powerOff(): void {
    this.setPower(false);
    this.send('0');
  }

  turnoutThrow(id: number): void {
    this.send(`T ${id} 1`);
  }

  turnoutClose(id: number): void {
    this.send(`T ${id} 0`);
  }

  /** Toggle (or explicitly set) a loco function. */
  toggleFunction(cab: number, fn: number | string, state?: 0 | 1): void {
    const cabNumber = Number(cab);
    const fnToken = String(fn).trim();
    const fnNumber = Number(fnToken.toUpperCase().startsWith('F') ? fnToken.slice(1) : fnToken);

    if (state != null) {
      this.send(`F ${cabNumber} ${fnNumber} ${state}`);
      return;
    }
    if (!Number.isInteger(cabNumber) || cabNumber < 0 || !Number.isInteger(fnNumber) || fnNumber < 0) {
      return;
    }
    const currentState = this.getEnabledFunctions(cabNumber)[fnNumber];
    this.send(`F ${cabNumber} ${fnNumber} ${currentState ? 0 : 1}`);
  }
}

function normalizeCabs(cabs: Array<number | string>): number[] {
  return [...new Set(cabs.map((cab) => Number(cab)).filter((cab) => Number.isInteger(cab) && cab >= 0))];
}

const dccExClient = new DccExClient({
  host: process.env.DCCHost || 'localhost',
  port: Number(process.env.DCCPort) || 2560,
});

export default dccExClient;
