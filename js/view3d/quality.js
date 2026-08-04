// Quality tiers.
//
// This is a phone game that will sit open for hours. The budget is: under ~80
// draw calls, capped device pixel ratio, and no rendering at all when nobody is
// looking. Auto-detect picks a tier; the player can override it in Settings.
//
// Two things here decide whether the picture is sharp, and both used to be
// wrong:
//
//   renderScale is a multiplier on the backing store, so anything under 1 is
//   the browser upscaling a smaller image — real, unrecoverable blur, not a
//   subtle quality setting. `low` sat at 0.75, which on a phone reporting a
//   pixel ratio of 3 meant a frame drawn at a quarter of the linear resolution
//   of the screen it was stretched across.
//
//   `antialias` is a flag on the *canvas* context, and the scene is drawn into
//   a WebGLRenderTarget — so the flag applies to a framebuffer that is never
//   drawn to, and the frame the player sees gets nothing from it. `msaa` is
//   the one that counts: it multisamples the target the scene really goes
//   into, and since every tier now composites, every tier needs it.
//
// `post` used to be a tier flag, and is not one any more. The composer's last
// pass is what tone maps and encodes the frame, so a tier without it would be
// showing raw linear light on an sRGB screen. What is still a tier setting is
// `bloom` — five blurred mips is a real cost and a phone can decline it.

export const TIERS = {
  low: {
    name: 'Low',
    pixelRatio: 1.25,
    renderScale: 0.85,
    bloom: false,
    antialias: false,
    msaa: 2,
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
    bloom: true,
    antialias: false,
    msaa: 4,
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
    bloom: true,
    antialias: true,
    msaa: 4,
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

  // Low renders below native resolution, so it is reserved for devices that
  // genuinely cannot hold a frame — never handed out on a weak signal. The old
  // `cores <= 4` swept in a great many perfectly capable desktops: Safari does
  // not implement deviceMemory at all, several browsers clamp
  // hardwareConcurrency for fingerprinting reasons, and four reported cores is
  // an ordinary laptop. Those players were being given a soft, upscaled picture
  // and no way to know why.
  if (mem <= 2 || cores <= 2) return 'low';
  if (coarse && mem <= 4 && cores <= 4) return 'low';
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

    // Too slow: drop a tier immediately. One chance to climb back afterwards,
    // behind a long cooldown — a device that stutters once during a shader
    // compile or a background tab switch should not be sentenced to the
    // upscaled tier for the rest of the session, which is what spending every
    // upgrade attempt on the way down amounted to.
    if ((p90 > 1 / 26 && tier === 'high') || (p90 > 1 / 22 && tier === 'medium')) {
      goodRuns = 0;
      upgradesLeft = Math.min(upgradesLeft, 1);
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
