/** Short, URL-safe unique ids with a readable prefix (`pc_`, `jt_`, `blk_`, …). */
export function newId(prefix: string): string {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${raw.slice(0, 12)}`;
}
