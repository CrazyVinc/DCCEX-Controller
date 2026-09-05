import { describe, expect, it } from 'vitest';
import { SettingsSchema } from './settings.ts';
import { TrainInfoSchema, WagonInfoSchema } from './rollingStock.ts';

describe('SettingsSchema', () => {
  it('accepts the persisted settings shape and keeps unknown keys', () => {
    const parsed = SettingsSchema.parse({
      FunctionOnStarts: { keys: [0], enabled: true },
      GlobalSpeedCab: 126,
      swapForwardAndReverse: true,
      invertMouse: false,
    });
    expect(parsed.GlobalSpeedCab).toBe(126);
    expect((parsed as Record<string, unknown>).invertMouse).toBe(false);
  });

  it('rejects an out-of-range speed cab', () => {
    expect(() =>
      SettingsSchema.parse({ FunctionOnStarts: { keys: [], enabled: false }, GlobalSpeedCab: 200, swapForwardAndReverse: false }),
    ).toThrow();
  });
});

describe('rolling stock schemas', () => {
  it('normalises a roster entry with nullable calibration', () => {
    const train = TrainInfoSchema.parse({
      DCC_ID: 3004,
      Name: 'PTT POST',
      Length: 250,
      Speed: { Duration: null, Distance: null, Step: 1, calculated: null, limit: 127 },
      startDelay: 0,
      Functions: [],
      Notes: '',
      Meta: {},
    });
    expect(train.DCC_ID).toBe('3004');
    expect(train.imageorder).toEqual([]);
  });

  it('defaults the wagon service class', () => {
    const wagon = WagonInfoSchema.parse({ id: 'w1', Name: 'Post', Length: 125 });
    expect(wagon.serviceClass).toBe('other');
  });
});
