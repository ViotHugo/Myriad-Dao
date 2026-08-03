// The eight skies of A15, written as a lighting script rather than textures.
//
// A realm change lerps every one of these values over ~3 seconds, so the world
// never hard-cuts. Nothing here is loaded; it is all numbers.
//
// ---------------------------------------------------------------------------
// The one rule this file exists to keep
//
// An ink-wash landscape is not a colour scheme, it is a *value ladder*, and it
// only has three rungs:
//
//     cloud   — the brightest thing in the frame, near white. In shan shui the
//               unpainted paper is the cloud and the water, and everything else
//               is read against it.
//     sky     — the middle, a gradient from a luminous skyline to a dark zenith.
//     peaks   — ink. Always darker than the sky standing behind them, and
//               stepping from near-black in front to pale in the distance.
//
// The earlier build tinted the peaks with the *ridge* colours, which are meant
// for valley walls seen against mist and run pale at the far end. Against the
// sky that inverts the whole picture: the far rank came out lighter than the
// air behind it, every rank landed inside the sky's own value range, and a
// range of mountains turned into a smear. `peaks` and `cloud` below are chosen
// against `sky`, and tests/run.js asserts the ladder holds for all eight — this
// is the invariant the art depends on, so it is checked rather than trusted.
// ---------------------------------------------------------------------------

export const PALETTES = [
  { // 0 — Body Tempering: misty grey dawn
    sky: { top: '#232a34', mid: '#3c4552', horizon: '#8a929c' },
    // Air is two colours: bright along the skyline, colder and darker up where
    // the summits are. One flat fog colour makes every distance identical.
    fog: { color: '#8d96a2', high: '#4f5966', density: 0.0105 },
    light: { dir: [0.30, 0.55, 0.62], color: '#ffeede' },
    ambient: '#333c46',
    ground: '#2b3038',
    ridges: ['#252b34', '#2f3742', '#3b4552', '#495564', '#5a6673'],
    peaks: ['#1b2129', '#2b3440', '#41505f'],
    sun: { color: '#ffe8cf', power: 0.55 },
    water: { top: '#3c4552', horizon: '#8a929c', tint: '#232a2f' },
    aura: '#9fb3c8',
    robe: '#6b6257',
    trim: '#8f8577',
    accent: '#35c98e',
    blossom: '#f6d3e0', bark: '#1b1519',
    cloud: '#c6d0da', cloudCrest: '#eef4fa', crane: '#f2f6fa',
    flags: { stars: 0, aurora: 0, moon: 0, cloudSea: 0 },
  },
  { // 1 — Qi Condensation: teal morning
    sky: { top: '#10333a', mid: '#1c5560', horizon: '#7fc4c0' },
    fog: { color: '#6fb0ab', high: '#2e6a6e', density: 0.0095 },
    light: { dir: [0.38, 0.60, 0.55], color: '#fff6e0' },
    ambient: '#23414a',
    ground: '#1c3038',
    ridges: ['#12292f', '#193740', '#22474f', '#2d5a61', '#3a6d70'],
    peaks: ['#0d2a30', '#17444c', '#2a6068'],
    sun: { color: '#fff0cd', power: 0.60 },
    water: { top: '#1c5560', horizon: '#7fc4c0', tint: '#0f2a30' },
    aura: '#35c98e',
    robe: '#2f6b63',
    trim: '#57a892',
    accent: '#35c98e',
    blossom: '#f4cfe0', bark: '#17201f',
    cloud: '#c2ded9', cloudCrest: '#eafaf6', crane: '#f0fbf7',
    flags: { stars: 0, aurora: 0, moon: 0, cloudSea: 0 },
  },
  { // 2 — Foundation Establishment: amber sunset
    sky: { top: '#2a1a24', mid: '#7a3a26', horizon: '#f2b26b' },
    fog: { color: '#c2865c', high: '#5e3830', density: 0.0088 },
    light: { dir: [-0.45, 0.38, 0.55], color: '#ffd9a0' },
    ambient: '#46262a',
    ground: '#3a2420',
    ridges: ['#2a171e', '#3a2124', '#4c2e2a', '#5f3c31', '#744c3c'],
    peaks: ['#2a1a1e', '#43282a', '#66423c'],
    // Low sun: the hardest, warmest ridge light of the eight.
    sun: { color: '#ffcf85', power: 1.05 },
    water: { top: '#7a3a26', horizon: '#f2b26b', tint: '#33161a' },
    aura: '#e8b34b',
    robe: '#7a3f2c',
    trim: '#d79a54',
    accent: '#e8b34b',
    blossom: '#ffd9dc', bark: '#241416',
    cloud: '#f0cfae', cloudCrest: '#fff0d8', crane: '#fff2e2',
    flags: { stars: 0, aurora: 0, moon: 0, cloudSea: 0 },
  },
  { // 3 — Core Formation: violet dusk
    sky: { top: '#150f2b', mid: '#382a63', horizon: '#9c7fc4' },
    fog: { color: '#8b74b0', high: '#3b2d5e', density: 0.0092 },
    light: { dir: [-0.30, 0.50, 0.60], color: '#e0d0ff' },
    ambient: '#2b2450',
    ground: '#22193a',
    ridges: ['#1a1330', '#221a3c', '#2d2249', '#3a2c5c', '#4a3a70'],
    peaks: ['#191233', '#281d47', '#3e2f66'],
    sun: { color: '#f0dcff', power: 0.62 },
    water: { top: '#382a63', horizon: '#9c7fc4', tint: '#181233' },
    aura: '#b07ae8',
    robe: '#4a2f70',
    trim: '#9b74d4',
    accent: '#b07ae8',
    blossom: '#f0cdf0', bark: '#1d1526',
    cloud: '#cfc0e4', cloudCrest: '#f0e8ff', crane: '#f4ecff',
    flags: { stars: 0.25, aurora: 0, moon: 0, cloudSea: 0 },
  },
  { // 4 — Nascent Soul: starry indigo
    sky: { top: '#05070f', mid: '#0d1330', horizon: '#2c3a63' },
    fog: { color: '#33436e', high: '#131a30', density: 0.0078 },
    light: { dir: [0.25, 0.62, 0.55], color: '#cfe0ff' },
    ambient: '#141c38',
    ground: '#0d1120',
    ridges: ['#070a14', '#0b1020', '#10182c', '#16203a', '#1d2a48'],
    peaks: ['#070a14', '#0d1424', '#182338'],
    // Starlight, not sun: a cold thin edge and nothing more.
    sun: { color: '#b9cdff', power: 0.42 },
    water: { top: '#0d1330', horizon: '#2c3a63', tint: '#070b18' },
    aura: '#6ea8ff',
    robe: '#1e2a52',
    trim: '#6f8fd8',
    accent: '#6ea8ff',
    blossom: '#e8d0ee', bark: '#0f1320',
    cloud: '#7889b4', cloudCrest: '#b4c4ea', crane: '#e6eeff',
    flags: { stars: 1, aurora: 0, moon: 0, cloudSea: 0 },
  },
  { // 5 — Spirit Severing: the great moon
    sky: { top: '#060a12', mid: '#101a2a', horizon: '#33455c' },
    fog: { color: '#3c4f66', high: '#18212e', density: 0.0072 },
    light: { dir: [-0.45, 0.42, -0.55], color: '#dfe8f5' },
    ambient: '#18222f',
    ground: '#0f151d',
    ridges: ['#080d14', '#0d131c', '#121a24', '#18222e', '#202c3c'],
    peaks: ['#080d14', '#111925', '#1f2c3c'],
    // Moonlight rims hard and cold, and it comes from behind the range.
    sun: { color: '#e8f2ff', power: 0.85 },
    water: { top: '#101a2a', horizon: '#33455c', tint: '#080d14' },
    aura: '#a9c6e8',
    robe: '#24303f',
    trim: '#9fb8d4',
    accent: '#a9c6e8',
    blossom: '#e6dcea', bark: '#101720',
    cloud: '#8b9cb2', cloudCrest: '#cdddee', crane: '#eef5fc',
    flags: { stars: 0.6, aurora: 0, moon: 1, cloudSea: 0 },
  },
  { // 6 — Dao Seeking: aurora
    // The darkest sky of the eight, so the skyline has to be lifted a little
    // and the far rank pushed down to keep the range readable against it.
    sky: { top: '#03080c', mid: '#07161c', horizon: '#1a4d4b' },
    fog: { color: '#2a5f5c', high: '#0b2020', density: 0.0066 },
    light: { dir: [0.20, 0.70, 0.42], color: '#c8ffe8' },
    ambient: '#0d2228',
    ground: '#08161a',
    ridges: ['#03090c', '#061114', '#0a1c1e', '#0f2829', '#153634'],
    peaks: ['#030a0c', '#08181a', '#0c2122'],
    sun: { color: '#9effd8', power: 0.70 },
    water: { top: '#07161c', horizon: '#1a4d4b', tint: '#040c10' },
    aura: '#35ffd0',
    robe: '#0f3b3a',
    trim: '#4fe8c4',
    accent: '#35ffd0',
    blossom: '#d8f2e6', bark: '#08161a',
    cloud: '#6ea295', cloudCrest: '#a8dcc8', crane: '#e0fff4',
    flags: { stars: 0.8, aurora: 1, moon: 0, cloudSea: 0 },
  },
  { // 7 — Immortal Ascension: a golden sea of clouds
    sky: { top: '#1a1408', mid: '#4a3410', horizon: '#f0c874' },
    fog: { color: '#d5a75c', high: '#6b501c', density: 0.0060 },
    light: { dir: [0.10, 0.80, 0.40], color: '#fff0c8' },
    ambient: '#52401c',
    ground: '#3a2c10',
    ridges: ['#1c1508', '#261d0b', '#332710', '#443416', '#57431e'],
    peaks: ['#231a0a', '#3b2c11', '#5f4a20'],
    sun: { color: '#ffe9a8', power: 1.00 },
    water: { top: '#4a3410', horizon: '#f0c874', tint: '#2a1e08' },
    aura: '#ffd76a',
    robe: '#8a6a22',
    trim: '#ffe9a8',
    accent: '#e8b34b',
    blossom: '#ffe6c0', bark: '#2a1e08',
    cloud: '#ffdfa6', cloudCrest: '#fff6dc', crane: '#fff8e8',
    flags: { stars: 0.4, aurora: 0, moon: 0, cloudSea: 1 },
  },
];

/** Relative luminance of a '#rrggbb' string, 0..255. The value ladder's ruler. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** Hair and beard change across four brackets of age/lifespan, never raw age. */
export const AGE_BRACKETS = [
  { max: 0.25, hair: '#171a1f', beard: 0.00 },
  { max: 0.55, hair: '#20242b', beard: 0.35 },
  { max: 0.80, hair: '#6d7078', beard: 0.75 },
  { max: Infinity, hair: '#cfd3d8', beard: 1.00 },
];

export function ageBracket(fraction) {
  for (const b of AGE_BRACKETS) if (fraction <= b.max) return b;
  return AGE_BRACKETS[AGE_BRACKETS.length - 1];
}
