import { VISION_PROMPT, VisionResultSchema, type VisionResult } from '../../shared/src/vision/schema.ts';

export interface OllamaVisionOptions {
  host?: string;
  model?: string;
  timeoutMs?: number;
}

export class OllamaUnavailableError extends Error {}

/** Pull the first balanced JSON object out of a model reply that may contain prose or code fences. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Model reply contains no JSON object');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Model reply contains an unterminated JSON object');
}

/**
 * Ask a local Ollama vision model (llava / qwen2-vl / …) to list the track pieces in a
 * photo. The reply is validated with the shared Zod schema; the model never gets
 * any authority beyond producing candidates.
 */
export async function analyzeTrackPhoto(image: Buffer, options: OllamaVisionOptions = {}): Promise<{ model: string; result: VisionResult; durationMs: number }> {
  const host = (options.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = options.model ?? process.env.OLLAMA_VISION_MODEL ?? 'llava';
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [{ role: 'user', content: VISION_PROMPT, images: [image.toString('base64')] }],
      }),
    });
  } catch (err) {
    throw new OllamaUnavailableError(`Ollama not reachable at ${host}: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new OllamaUnavailableError(`Ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = (await response.json()) as { message?: { content?: string } };
  const content = body.message?.content ?? '';
  const result = VisionResultSchema.parse(extractJsonObject(content));
  return { model, result, durationMs: Date.now() - started };
}
