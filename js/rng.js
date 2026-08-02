// Deterministic pseudo-random helpers. Pure — no globals, no Math.random here.

/** FNV-1a over a string, returned as an unsigned 32-bit int. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for cosmetics and ladders. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded stream from any string key. Same key, same sequence, forever. */
export function seededRandom(key) {
  return mulberry32(hashString(String(key)));
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

export function randInt(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Weighted index draw. `weights` need not be normalised. */
export function weightedIndex(rand, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
