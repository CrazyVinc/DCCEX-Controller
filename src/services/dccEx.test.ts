import { describe, expect, it } from 'vitest';
import { DccExClient } from './dccEx.ts';

/** Exposes the protected parser for tests without touching the network. */
class TestClient extends DccExClient {
  feed(msg: string): void {
    this.parseMessage(msg);
  }
}

describe('DCC-EX message parsing', () => {
  it('parses sensor state and sensor definitions', () => {
    const client = new TestClient({ host: 'localhost', port: 1, autoReconnect: false });
    const sensors: unknown[] = [];
    const defs: unknown[] = [];
    client.on('sensor', (s) => sensors.push(s));
    client.on('sensorDefined', (d) => defs.push(d));
    client.feed('<Q 12>');
    client.feed('<q 12>');
    client.feed('<Q 3 164 1>');
    expect(sensors).toEqual([
      { id: 12, active: true },
      { id: 12, active: false },
    ]);
    expect(defs).toEqual([{ id: 3, vpin: 164, pullup: true }]);
  });

  it('parses turnout feedback in broadcast and list form', () => {
    const client = new TestClient({ host: 'localhost', port: 1, autoReconnect: false });
    const turnouts: unknown[] = [];
    client.on('turnout', (t) => turnouts.push(t));
    client.feed('<H 5 1>');
    client.feed('<H 7 DCC 21 0 0>');
    client.feed('<H 9 VPIN 100 1>');
    expect(turnouts).toEqual([
      { id: 5, thrown: true },
      { id: 7, thrown: false },
      { id: 9, thrown: true },
    ]);
  });

  it('still parses power and loco status', () => {
    const client = new TestClient({ host: 'localhost', port: 1, autoReconnect: false, swapForwardAndReverse: false });
    const power: boolean[] = [];
    const throttles: unknown[] = [];
    client.on('power', (p) => power.push(p));
    client.on('throttle', (t) => throttles.push(t));
    client.feed('<p1>');
    client.feed('<l 3 40 1 5>');
    expect(power).toEqual([true]);
    expect(throttles).toEqual([{ cab: 3, speed: 40, dir: 1 }]);
    expect(client.getEnabledFunctions(3)[0]).toBe(true);
    expect(client.getEnabledFunctions(3)[2]).toBe(true);
  });
});
