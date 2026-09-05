import { describe, expect, it } from 'vitest';
import { VisionResultSchema } from '../../shared/src/vision/schema.ts';
import { extractJsonObject } from './ollamaVision.ts';

describe('vision reply parsing', () => {
  it('extracts JSON from a chatty reply and validates it', () => {
    const reply = 'Sure! Here is the plan:\n```json\n{"elements":[{"type":"straight","x":0.2,"y":0.5,"angleDeg":0,"lengthRel":0.15,"confidence":0.9},{"type":"curve","x":0.6,"y":0.4,"angleDeg":30,"lengthRel":0.1,"sweepDeg":30,"confidence":0.4}],"notes":"two pieces"}\n```';
    const parsed = VisionResultSchema.parse(extractJsonObject(reply));
    expect(parsed.elements).toHaveLength(2);
    expect(parsed.elements[1]!.sweepDeg).toBe(30);
  });

  it('rejects replies without a JSON object or with unknown types', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
    expect(() => VisionResultSchema.parse(extractJsonObject('{"elements":[{"type":"bridge","x":0,"y":0,"angleDeg":0}]}'))).toThrow();
  });
});
