// All randomness is seeded so the same Scene always renders identically.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Combine seeds and labels into one 32-bit seed. Seeding each layer and
 * layer-pair independently keeps edits local: changing layer 3 does not
 * reshuffle layers 2, 4 and 5.
 */
export function hash(...parts: (number | string)[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' ? Math.floor(p) >>> 0 : hashString(p);
    h ^= v + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function rngFor(...parts: (number | string)[]): Rng {
  return mulberry32(hash(...parts));
}

export const range = (rng: Rng, min: number, max: number) => min + (max - min) * rng();
export const signed = (rng: Rng, amp: number) => (rng() * 2 - 1) * amp;

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
