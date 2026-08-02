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
    // scenery
    spires: 26,
    cloudDecks: 2,
    plumDepth: 4,
    blossoms: 60,
    petals: 26,
    cranes: 2,
    waterfall: false,
    bamboo: 0,
    fireflies: 0,
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
    spires: 58,
    cloudDecks: 3,
    plumDepth: 5,
    blossoms: 150,
    petals: 60,
    cranes: 3,
    waterfall: true,
    bamboo: 10,
    fireflies: 26,
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
    spires: 96,
    cloudDecks: 3,
    plumDepth: 5,
    blossoms: 260,
    petals: 110,
    cranes: 5,
    waterfall: true,
    bamboo: 18,
    fireflies: 48,
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

const ORDER = ['low', 'medium', 'high'];

/**
 * Watches frame times and moves the tier to fit the device.
 *
 * Downgrades happen on one bad window; upgrades need several consecutive good
 * ones and stop after a couple of attempts, so a device that sits near the
 * boundary settles instead of flapping between tiers forever.
 */
export function createWatchdog(onChange) {
  let samples = [];
  let cooldown = 180;   // ignore warm-up and shader compiles
  let goodRuns = 0;
  let upgradesLeft = 2;

  return function sample(dt, tier) {
    if (cooldown > 0) { cooldown--; return; }
    samples.push(dt);
    if (samples.length < 120) return;
    const sorted = samples.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    samples = [];

    const idx = ORDER.indexOf(tier);
    if (idx < 0) return;

    // Too slow: drop a tier immediately and stop trying to climb back.
    if ((p90 > 1 / 26 && tier === 'high') || (p90 > 1 / 22 && tier === 'medium')) {
      goodRuns = 0;
      upgradesLeft = 0;
      cooldown = 240;
      onChange(ORDER[idx - 1]);
      return;
    }

    // Comfortably fast for three windows running, and we have not already spent
    // our upgrade attempts: try one tier up.
    if (p90 < 1 / 55 && idx < ORDER.length - 1 && upgradesLeft > 0) {
      if (++goodRuns >= 3) {
        goodRuns = 0;
        upgradesLeft--;
        cooldown = 240;
        onChange(ORDER[idx + 1]);
      }
      return;
    }
    goodRuns = 0;
  };
}
