import { z } from 'zod';

/** `data/settings.json` — controller-wide settings edited on the Settings page. */
export const SettingsSchema = z.looseObject({
  FunctionOnStarts: z.object({
    keys: z.array(z.int().min(0).max(31)),
    enabled: z.boolean(),
  }),
  GlobalSpeedCab: z.int().min(0).max(127),
  swapForwardAndReverse: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  FunctionOnStarts: { keys: [], enabled: false },
  GlobalSpeedCab: 127,
  swapForwardAndReverse: false,
};
