import type { Response } from 'express';
import type { ZodType, z } from 'zod';

/**
 * Validate a request payload with a Zod schema. On failure a 400 with the flattened
 * issues is sent and `null` is returned so the handler can simply `return`.
 */
export function parseOr400<S extends ZodType>(schema: S, payload: unknown, res: Response): z.output<S> | null {
  const result = schema.safeParse(payload);
  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid request payload',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  return result.data;
}

/** Uniform error → HTTP mapping for service exceptions (`not found` → 404, else 400). */
export function sendServiceError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(/not found/i.test(message) ? 404 : 400).json({ success: false, message });
}
