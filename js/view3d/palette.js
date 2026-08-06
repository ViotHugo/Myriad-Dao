// The eight realms, written as an ink script rather than as eight skies.
//
// A realm change lerps every one of these values over ~3 seconds, so the world
// never hard-cuts. Nothing here is loaded; it is all numbers.
//
// ---------------------------------------------------------------------------
// What is in this file, and what is not, since stage 2
//
// This used to carry a whole sky per realm — zenith, horizon, two fog colours,
// a density, a light colour, a sun power. It does not any more. **The air, the
// sky and the light belong to the time of day**, which lives in
// `time-of-day.js` as four authored states with everything in between, and a
// realm is a *position on that day* plus its own ink.
//
// The reason is the one stage 2 exists to fix: two owners of the sky is two
// owners of the fog, and the moment they disagree every distant object in the
// frame is a slightly wrong rectangle pasted onto the horizon. There is one
// air now, and everything hazes toward it.
//
// So a realm is:
//
//   tod       where on the day it stands. The eight realms walk one full day,
//             from the grey first light of Body Tempering to the golden
//             daybreak of Ascension — the wheel comes round.
//   ink       the near-black the range is carved out of. The three ranks of
//             aerial perspective are *derived* from this and the day's air by
//             aerialTiers(); they are not authored, so they cannot be authored
//             against one sky and quietly break in the other three.
//   bearing   the compass point the sun stands at, in degrees (atan2(x, z)).
//             Elevation is the day's, bearing is the realm's — see the header
//             of time-of-day.js for why the two have different owners.
//   the rest  ridges, cloud, water tint, robe, trim, aura, blossom, bark,
//             crane: the realm's own colour identity, none of which is sky.
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
// An earlier build tinted the peaks with the *ridge* colours, which are meant
// for valley walls seen against mist and run pale at the far end. Against the
// sky that inverts the whole picture: the far rank came out lighter than the
// air behind it and a range of mountains turned into a smear. The ranks are
// derived from `ink` and the day's air now, which makes the ladder a property
// of the arithmetic — but `tests/run.js` still asserts it for all eight realms
// at every time of day, because an invariant the art depends on is checked
// rather than trusted.
//
// ---------------------------------------------------------------------------
// The second rule: where the sun stands
//
// `bearing` used to be a free number, because in the old renderer all it
// decided was which flank of a ridge took the warm ramp. It decides a great
// deal more now — it aims the DirectionalLight that renders the shadow map, so
// it also decides where every shadow in the frame falls.
//
// Five of these eight had the sun within fifteen degrees of the camera's own
// bearing. A key light behind the viewer's head is the flattest light there
// is: every surface the camera can see is a surface the sun can see, no plane
// turns away, and every shadow in the picture falls into the exact place the
// figure that cast it is standing in front of. It is, on its own, most of why
// this landscape read as coloured paper. `sunOffsetDeg()` in framing.js
// measures it and the suite holds every realm to a floor, so it cannot come
// back.
//
// The camera is locked at yaw 0.62 rad, so it looks in along a bearing of 35°.
// Every sun here stands at least 60° off that, which is what puts a lit face
// and a shadowed face on the same rock and lays the cultivator's shadow across
// the shelf instead of behind her. Six key from the left, so the shadow runs
// into the open right of the frame; two of the night realms key from behind,
// where the range is rimmed and the shadow comes toward the eye.
// ---------------------------------------------------------------------------

export const PALETTES = [
  { // 0 — Body Tempering: the grey first light
    tod: 0.00,
    ink: '#1b2129',
    bearing: -52,            // 88° off the lens
    ambient: '#333c46',
    ground: '#2b3038',
    ridges: ['#252b34', '#2f3742', '#3b4552', '#495564', '#5a6673'],
    water: '#232a2f',
    aura: '#9fb3c8',
    robe: '#6b6257',
    trim: '#8f8577',
    blossom: '#f6d3e0', bark: '#1b1519',
    cloud: '#c6d0da', cloudCrest: '#eef4fa', crane: '#f2f6fa',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 1 — Qi Condensation: teal, and the day coming up
    tod: 0.22,
    ink: '#0d2a30',
    bearing: -58,            // 94°
    ambient: '#23414a',
    ground: '#1c3038',
    ridges: ['#12292f', '#193740', '#22474f', '#2d5a61', '#3a6d70'],
    water: '#0f2a30',
    aura: '#35c98e',
    robe: '#2f6b63',
    trim: '#57a892',
    blossom: '#f4cfe0', bark: '#17201f',
    cloud: '#c2ded9', cloudCrest: '#eafaf6', crane: '#f0fbf7',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 2 — Foundation Establishment: the amber hour
    tod: 0.50,
    ink: '#2a1a1e',
    bearing: -62,            // 98°
    ambient: '#46262a',
    ground: '#3a2420',
    ridges: ['#2a171e', '#3a2124', '#4c2e2a', '#5f3c31', '#744c3c'],
    water: '#33161a',
    aura: '#e8b34b',
    robe: '#7a3f2c',
    trim: '#d79a54',
    blossom: '#ffd9dc', bark: '#241416',
    cloud: '#f0cfae', cloudCrest: '#fff0d8', crane: '#fff2e2',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 3 — Core Formation: violet, the light going
    tod: 0.60,
    ink: '#191233',
    bearing: -70,            // 106°
    ambient: '#2b2450',
    ground: '#22193a',
    ridges: ['#1a1330', '#221a3c', '#2d2249', '#3a2c5c', '#4a3a70'],
    water: '#181233',
    aura: '#b07ae8',
    robe: '#4a2f70',
    trim: '#9b74d4',
    blossom: '#f0cdf0', bark: '#1d1526',
    cloud: '#cfc0e4', cloudCrest: '#f0e8ff', crane: '#f4ecff',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 4 — Nascent Soul: the stars out
    tod: 0.72,
    ink: '#070a14',
    bearing: 112,            // 77°, from the far side
    ambient: '#141c38',
    ground: '#0d1120',
    ridges: ['#070a14', '#0b1020', '#10182c', '#16203a', '#1d2a48'],
    water: '#070b18',
    aura: '#6ea8ff',
    robe: '#1e2a52',
    trim: '#6f8fd8',
    blossom: '#e8d0ee', bark: '#0f1320',
    cloud: '#7889b4', cloudCrest: '#b4c4ea', crane: '#e6eeff',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 5 — Spirit Severing: deep night, the moon behind the range
    tod: 0.75,
    ink: '#080d14',
    bearing: -120,           // 156°: the light comes from behind the peaks
    ambient: '#18222f',
    ground: '#0f151d',
    ridges: ['#080d14', '#0d131c', '#121a24', '#18222e', '#202c3c'],
    water: '#080d14',
    aura: '#a9c6e8',
    robe: '#24303f',
    trim: '#9fb8d4',
    blossom: '#e6dcea', bark: '#101720',
    cloud: '#8b9cb2', cloudCrest: '#cdddee', crane: '#eef5fc',
    flags: { aurora: 0, cloudSea: 0 },
  },
  { // 6 — Dao Seeking: the last of the night, and the aurora up
    tod: 0.78,
    ink: '#030a0c',
    bearing: -64,            // 100°
    ambient: '#0d2228',
    ground: '#08161a',
    ridges: ['#03090c', '#061114', '#0a1c1e', '#0f2829', '#153634'],
    water: '#040c10',
    aura: '#35ffd0',
    robe: '#0f3b3a',
    trim: '#4fe8c4',
    blossom: '#d8f2e6', bark: '#08161a',
    cloud: '#6ea295', cloudCrest: '#a8dcc8', crane: '#e0fff4',
    flags: { aurora: 1, cloudSea: 0 },
  },
  { // 7 — Immortal Ascension: a golden sea of cloud at daybreak
    // The wheel comes round: the day this realm stands at is dawn again, and
    // everything gold in the frame is the realm's own ink and cloud, not the
    // sky's. Ascending at first light is the point.
    tod: 1.00,
    ink: '#231a0a',
    bearing: 105,            // 70°
    ambient: '#52401c',
    ground: '#3a2c10',
    ridges: ['#1c1508', '#261d0b', '#332710', '#443416', '#57431e'],
    water: '#2a1e08',
    aura: '#ffd76a',
    robe: '#8a6a22',
    trim: '#ffe9a8',
    blossom: '#ffe6c0', bark: '#2a1e08',
    cloud: '#ffdfa6', cloudCrest: '#fff6dc', crane: '#fff8e8',
    flags: { aurora: 0, cloudSea: 1 },
  },
];

/**
 * The aurora's own colour, and the reason it is not the accent.
 *
 * The curtains are a *background* element, and the art rules forbid a
 * background element wearing the accent — the accent is what the player's own
 * qi is, and a sky painted in it makes her light ordinary. This is Dao
 * Seeking's green, which is close but is the realm's, not hers.
 */
export const AURORA_COLOR = '#4fe8c4';

/**
 * The one set of luminance weights in the codebase — Rec. 601.
 *
 * The value ladder is checked in the test suite with these numbers and the
 * debug grayscale pass converts the frame with these same numbers, so what QA
 * looks at through the `G` key and what the suite asserts are the same ruler.
 * Two rulers is worse than none: the picture would pass one and fail the other
 * and nobody could say which was lying.
 */
export const LUMA = [0.299, 0.587, 0.114];

/** Relative luminance of a '#rrggbb' string, 0..255. The value ladder's ruler. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return LUMA[0] * ((n >> 16) & 255) + LUMA[1] * ((n >> 8) & 255) + LUMA[2] * (n & 255);
}

/* ------------------------------------------------------------ colour maths */

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Mix two '#rrggbb' strings. Linear in the same space the palettes are authored in. */
export function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s) => ((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * t;
  return `#${hex2(ch(16))}${hex2(ch(8))}${hex2(ch(0))}`;
}

/**
 * Pull a colour toward its own grey.
 *
 * Toward its *own* luminance, which is the part that matters: the result has
 * the same value as what went in, so desaturating a rank of peaks for aerial
 * perspective cannot accidentally move it up or down the value ladder. Only
 * the deliberate mix toward the air does that.
 */
export function desaturateHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const l = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const k = Math.max(0, Math.min(1, amount));
  return `#${hex2(r + (l - r) * k)}${hex2(g + (l - g) * k)}${hex2(b + (l - b) * k)}`;
}

/**
 * The foreground band: the realm's ink, taken most of the way to black.
 *
 * A fourth rung on the ladder above, and the one the other three are actually
 * read against. The value ladder is a *relative* structure — "peaks darker than
 * the sky", "cloud brighter than the palest rank" — and a relative structure
 * still needs one end nailed down or the whole thing can float up together,
 * which is exactly what "the picture looks washed out" means when nothing in
 * particular is wrong.
 *
 * The near band is that nail. It is the closest rock in the frame, it takes
 * almost no air, and it occupies the bottom third of every shipped shot — so it
 * is the one thing in the picture with no excuse for being anything but
 * near-black, at every hour of the day. The foreground used to be painted with
 * the realm's `ground`, which is a mid tone authored for the far shore, and the
 * result was a foreground *lighter* than ranges a hundred units behind it.
 *
 * `amount` is how far toward black: the island takes the full measure, the
 * loose rock standing on it a little less so five rocks and a censer do not
 * vanish into the platform under them.
 */
export function foregroundInk(ink, amount = 0.56) {
  return mixHex(ink, '#000000', amount);
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
