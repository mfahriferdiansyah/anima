/** Minimal ULID generator (time-sortable ids) — no dependency needed. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  let r = '';
  for (let i = 0; i < 16; i++) r += B32[rand[i] % 32];
  return time + r;
}
