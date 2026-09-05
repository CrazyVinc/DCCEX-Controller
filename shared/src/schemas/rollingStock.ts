import { z } from 'zod';

export const TRAIN_SERVICE_CLASSES = ['passenger', 'goods', 'mixed', 'other'] as const;
export const WAGON_SERVICE_CLASSES = ['passenger', 'goods', 'other'] as const;

export const TrainServiceClassSchema = z.enum(TRAIN_SERVICE_CLASSES);
export const WagonServiceClassSchema = z.enum(WAGON_SERVICE_CLASSES);

const ImageOrderSchema = z.array(z.object({ name: z.string() }));

/** Speed calibration: `Distance` mm covered in `Duration` s at speed `Step`. */
export const SpeedCalibrationSchema = z.object({
  Duration: z.number().nullable().optional(),
  Distance: z.number().nullable().optional(),
  Step: z.number().nullable().optional(),
  calculated: z.number().nullable().optional(),
  limit: z.int().min(0).max(127).default(127),
});

/** `data/rollingstock/trains/<DCC_ID>/info.json` — one locomotive in the roster. */
export const TrainInfoSchema = z.object({
  DCC_ID: z.union([z.string(), z.number()]).transform((v) => String(v)),
  Name: z.string(),
  Length: z.number().nonnegative(),
  Speed: SpeedCalibrationSchema,
  startDelay: z.number().default(0),
  Functions: z.array(z.union([z.int(), z.string()])).default([]),
  Notes: z.string().default(''),
  Meta: z.record(z.string(), z.unknown()).default({}),
  serviceClass: TrainServiceClassSchema.optional(),
  imageorder: ImageOrderSchema.default([]),
});

export type TrainInfo = z.infer<typeof TrainInfoSchema>;

/** `data/rollingstock/wagons/<id>/info.json`. */
export const WagonInfoSchema = z.object({
  id: z.string(),
  Name: z.string(),
  Length: z.number().positive(),
  serviceClass: WagonServiceClassSchema.default('other'),
  imageorder: ImageOrderSchema.default([]),
});

export type WagonInfo = z.infer<typeof WagonInfoSchema>;

/** POST /api/trains body. */
export const TrainCreateSchema = z.object({
  DCC_ID: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  Name: z.string().trim().min(1),
  Length: z.coerce.number().nonnegative(),
  Speed: SpeedCalibrationSchema.partial({ limit: true }).default({}),
  startDelay: z.coerce.number().default(0),
  Functions: z.array(z.union([z.int(), z.string()])).default([]),
  Notes: z.string().default(''),
  Meta: z.record(z.string(), z.unknown()).default({}),
});

/** PUT /api/trains/:dccId body. */
export const TrainUpdateSchema = z.object({
  Name: z.string().trim().min(1).optional(),
  Length: z.coerce.number().nonnegative().optional(),
  Speed: SpeedCalibrationSchema.partial().optional(),
  startDelay: z.coerce.number().optional(),
  Functions: z.array(z.union([z.int(), z.string()])).optional(),
  Notes: z.string().optional(),
  Meta: z.record(z.string(), z.unknown()).optional(),
  serviceClass: TrainServiceClassSchema.default('other'),
});

/** POST/PUT /api/wagons body. */
export const WagonInputSchema = z.object({
  Name: z.string().trim().min(1),
  Length: z.coerce.number().positive(),
  serviceClass: WagonServiceClassSchema.default('other'),
});

export const SpeedLimitSchema = z.object({ speedLimit: z.int().min(0).max(127) });
export const ImageReorderSchema = z.object({ order: z.array(z.string()) });
export const ImageRenameSchema = z.object({ oldName: z.string(), newName: z.string() });
