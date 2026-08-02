// Quality tiers.
//
// This is a phone game that will sit open for hours. The budget is: under ~80
// draw calls, capped device pixel ratio, and no rendering at all when nobody is
// looking. Auto-detect picks a tier; the player can override it in Settings.

export const TIERS = {
  low: {
    name: 'Low',
    pixelRatio: 1,
    renderScale: 0.75,
    post: false,
    antialias: false,
    mistBands: 2,
    ridgeLayers: 3,
    qiMotes: 60,
    sparks: 40,
    disciples: 8,
    stars: false,
    water: false,
    floatSwords: 2,
  },
  medium: {
    name: 'Medium',
    pixelRatio: 1.5,
    renderScale: 1,
    post: true,
    antialias: false,
    mistBands: 4,
    ridgeLayers: 5,
    qiMotes: 150,
    sparks: 90,
    disciples: 16,
    stars: true,
    water: true,
    floatSwords: 4,
  },
  high: {
    name: 'High',
    pixelRatio: 2,
    renderScale: 1,
    post: true,
    antialias: true,
    mistBands: 6,
    ridgeLayers: 5,
    qiMotes: 320,
    sparks: 160,
    disciples: 24,
    stars: true,
    water: true,
    floatSwords: 6,
  },
};

/** Best guess from what the browser will tell us, before a frame is drawn. */
export function detectTier() {
  if (typeof navigator === 'undefined') return 'medium';
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  if (mem <= 2 || cores <= 4) return 'low';
  if (!coarse && mem >= 8 && cores >= 8) return 'high';
  if (coarse && dpr >= 3 && mem >= 6 && cores >= 8) return 'high';
  return 'medium';
}

export function resolveTier(setting) {
  if (setting && setting !== 'auto' && TIERS[setting]) return setting;
  return detectTier();
}

/**
 * Watches frame times and steps the tier down if the device cannot hold up.
 * It never steps back up on its own — oscillating quality is worse than low.
 */
export function createWatchdog(onDowngrade) {
  let samples = [];
  let cooldown = 180; // ignore the first few seconds of warm-up and compiles
  return function sample(dt, tier) {
    if (cooldown > 0) { cooldown--; return; }
    samples.push(dt);
    if (samples.length < 120) return;
    const sorted = samples.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    samples = [];
    if (p90 > 1 / 26 && tier === 'high') onDowngrade('medium');
    else if (p90 > 1 / 22 && tier === 'medium') onDowngrade('low');
  };
}
