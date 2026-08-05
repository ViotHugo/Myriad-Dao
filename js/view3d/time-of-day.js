// The day, as data. Four authored states and everything between them.
//
// ---------------------------------------------------------------------------
// Why this file exists, and why it exists *before* the art it lights
//
// A landscape tuned against one lighting condition is not a landscape, it is a
// coincidence. Peaks chosen to read against a warm sunset horizon go invisible
// against a pale noon one; a rim light that separates a figure at night blows
// her silhouette out at midday; a fog density that gives depth at dawn erases
// the far rank at night. Every one of those is silent — nothing throws, the
// picture just stops working at three of the four times of day and the fault
// looks like "it needs more contrast".
//
// So the day is defined as data first, all four states at once, and everything
// downstream reads from here. Four keys, and **every value between them is a
// continuous lerp**. Nothing in this renderer is allowed to hard-swap on a time
// of day: a switch at some threshold is exactly the pop the transition exists
// to prevent, and it is also how a value that is only correct at the four keys
// gets shipped without anyone noticing.
//
//   Dawn    a cold blue zenith over a pale skyline, the sun barely up, hazy.
//   Day     the brightest sky and the thinnest air, sun high, exposure up.
//   Sunset  a warm low sun raking across everything, the classic ink-wash light.
//   Night   near-black zenith, a high cold moon, stars, and the deepest haze.
//
// ---------------------------------------------------------------------------
// The two rules the rest of the renderer depends on
//
//   1. **The fog colour IS the sky's horizon colour.** Not "close to it" —
//      the same value, read from the same field. Distant geometry hazes toward
//      whatever the air is, and if the air is not exactly the colour of the sky
//      it stands in, every far object comes out as a slightly-wrong rectangle
//      pasted onto the horizon. `world.js` builds `THREE.FogExp2` from
//      `tod.horizon` and the ink shaders take their air colour from the same
//      place. One value, one air.
//
//   2. **The sun's elevation belongs to the day, its bearing to the realm.**
//      How high the light stands is a property of the hour and nothing else,
//      so it lives here. Which compass point it comes from is a composition
//      decision made against the locked camera — it decides which flank of a
//      rock is lit and where the cultivator's shadow falls — so that stays in
//      palette.js, per realm, where framing.js can hold it to its 60° floor.
// ---------------------------------------------------------------------------

import { mixHex, desaturateHex, luminance } from './palette.js';

/**
 * How far below the horizon stop the third stop sits, as a mix toward the
 * zenith. Below the skyline the dome is not sky — it is the far air of the
 * valley seen through everything else — and painting it flat in the horizon
 * colour puts a plate of one value behind the whole lower frame. A little of
 * the zenith in it gives the valley somewhere to recede to.
 */
const BELOW_MIX = 0.32;

/**
 * The four states. Every field here is lerped; nothing is switched.
 *
 *   zenith        the top of the dome
 *   horizon       the skyline — and therefore the fog, and therefore the air
 *                 every distant surface hazes toward
 *   sun           the disc, and the colour of the key light. At night this is
 *                 the moon; it is the same object with a colder colour.
 *   sunElevation  degrees above the horizon. 4–6° at dawn and sunset is a
 *                 raking light with long shadows, which is the point of them.
 *   fogDensity    exponential-squared, so this is nearly all of the depth cue
 *   exposure      the one grade dial, read off renderer.toneMappingExposure
 *   accent        the colour a thing that is *emitting* takes so it still
 *                 reads against this sky. Foreground only — no background
 *                 element may wear it.
 *   sunPower      how hard the key is. A night key is a fifth of a noon one.
 *   stars         the star field on the sky sphere
 *   bloom         UnrealBloomPass strength — night blooms harder, because at
 *                 an exposure of 0.75 the few bright things left are the whole
 *                 picture
 *   rim           the character's rim light. Night shifts it blue: the sky is
 *                 the only thing behind her, and it is blue.
 */
export const TIMES = [
  {
    id: 'dawn', label: 'dawn', at: 0.00,
    zenith: '#2b3a52', horizon: '#8fa3b8', sun: '#e8d5c0',
    sunElevation: 6, fogDensity: 0.018, exposure: 0.90, accent: '#9fe3d0',
    sunPower: 0.62, stars: 0.15, bloom: 0.40, rim: '#e8d5c0',
  },
  {
    id: 'day', label: 'day', at: 0.25,
    zenith: '#4a7ba8', horizon: '#cfe0ea', sun: '#fff6e6',
    sunElevation: 55, fogDensity: 0.010, exposure: 1.10, accent: '#8fe0c8',
    sunPower: 1.10, stars: 0.00, bloom: 0.40, rim: '#fff6e6',
  },
  {
    id: 'sunset', label: 'sunset', at: 0.50,
    zenith: '#6b3f52', horizon: '#f0a860', sun: '#ff9a4d',
    sunElevation: 4, fogDensity: 0.016, exposure: 1.00, accent: '#ffd98a',
    sunPower: 1.00, stars: 0.00, bloom: 0.40, rim: '#ffb877',
  },
  {
    id: 'night', label: 'night', at: 0.75,
    zenith: '#0d1626', horizon: '#2a3752', sun: '#cfe0ff',
    sunElevation: 40, fogDensity: 0.020, exposure: 0.75, accent: '#7fd4ff',
    sunPower: 0.45, stars: 1.00, bloom: 0.55, rim: '#8fb8ff',
  },
];

/** Which fields are colours, and which are numbers. Everything is one or the other. */
const COLOR_KEYS = ['zenith', 'horizon', 'sun', 'accent', 'rim'];
const NUMBER_KEYS = ['sunElevation', 'fogDensity', 'exposure', 'sunPower', 'stars', 'bloom'];

/**
 * The day is a circle, not a line.
 *
 * Night runs back into dawn, so the dial wraps: `t` and `t + 1` are the same
 * sky, and scrubbing off either end is continuous rather than clamping to a
 * stop. A line would put a discontinuity at exactly the place a day loops, and
 * a discontinuity is a pop.
 */
export function wrapDay(t) {
  return ((t % 1) + 1) % 1;
}

/**
 * The sky at `t`, 0 → 1 across dawn, day, sunset, night and back to dawn.
 *
 * Returns a whole time-of-day object — same shape as an authored one, plus the
 * derived stops — so anything that eats a `TIMES` entry eats this without
 * knowing it was made up.
 */
export function timeOfDayAt(t) {
  const x = wrapDay(t) * TIMES.length;      // 0..4, one unit per key
  const i = Math.floor(x) % TIMES.length;
  const j = (i + 1) % TIMES.length;
  const k = x - Math.floor(x);
  const a = TIMES[i];
  const b = TIMES[j];

  const out = { id: k < 0.5 ? a.id : b.id, at: wrapDay(t), from: a.id, to: b.id, blend: k };
  for (const key of COLOR_KEYS) out[key] = k === 0 ? a[key] : mixHex(a[key], b[key], k);
  for (const key of NUMBER_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;

  // Derived, so that nothing downstream can invent its own version of them.
  out.below = mixHex(out.horizon, out.zenith, BELOW_MIX);
  out.fog = out.horizon;   // rule 1, said out loud: the air is the skyline
  return out;
}

/**
 * Ease one position on the day toward another, the short way round.
 *
 * The day is a circle, so "from ascension's daybreak back to first light" is a
 * distance of zero, not a distance of one. Eased as a plain number it would run
 * the whole day backwards — sunset, noon, dawn — over the three seconds a realm
 * change takes, which is a rewind, not a transition.
 */
export function lerpDay(from, to, k) {
  const a = wrapDay(from);
  let d = wrapDay(to) - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return wrapDay(a + d * k);
}

/** The authored state nearest `t` — for a readout, never for rendering. */
export function nearestTime(t) {
  const x = wrapDay(t);
  let best = TIMES[0];
  let dist = 2;
  for (const time of TIMES) {
    const d = Math.min(Math.abs(x - time.at), 1 - Math.abs(x - time.at));
    if (d < dist) { dist = d; best = time; }
  }
  return best;
}

/**
 * The sun's direction as a unit vector pointing *at* it, from a compass bearing
 * (degrees, `atan2(x, z)` — the convention framing.js measures against) and the
 * day's elevation.
 *
 * The two halves come from different owners on purpose. See the header.
 */
export function sunDirection(bearingDeg, elevationDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(e);
  return [Math.sin(b) * c, Math.sin(e), Math.cos(b) * c];
}

/* -------------------------------------------------------- aerial perspective */

/**
 * Three tiers of distance, as three material colours. No shader.
 *
 * A picture with no texture and no atmosphere model has exactly one cue for
 * depth: what distance does to a colour. Two things happen to a mountain twenty
 * kilometres away — it gets **lighter**, because there is a column of lit air
 * in front of it, and it gets **less saturated**, because that air is grey and
 * it is most of what you are looking at. Doing only the first gives a range of
 * pale versions of the same hue, which reads as a range of closer mountains
 * painted badly.
 *
 * So each tier mixes its ink toward the air and then desaturates on top, and
 * because both operations are monotonic the value ladder holds by construction
 * at every time of day rather than by eight hand-authored ramps that were only
 * ever checked against one sky.
 *
 * `fogCap` is how much of the exponential haze that tier is allowed to take.
 * Uncapped, exp² fog is total by about 400 units, which is right for mist and
 * wrong for mountains: an ink-wash horizon is pale, not absent.
 */
export const AERIAL = [
  { id: 'near', air: 0.10, desat: 0.12, fogCap: 0.22, sun: 1.00 },
  { id: 'mid', air: 0.26, desat: 0.26, fogCap: 0.42, sun: 0.80 },
  { id: 'far', air: 0.44, desat: 0.40, fogCap: 0.60, sun: 0.55 },
];

/**
 * The three tier colours for one ink against one air.
 *
 * Desaturation is toward the colour's own luminance, so it never changes a
 * tier's *value* — which is what keeps the ladder (near darkest, far palest,
 * all of them darker than the air) a property of the arithmetic instead of
 * something to be re-checked whenever a palette moves.
 */
export function aerialTiers(ink, air) {
  // How much airlight there is to add, from how bright the air is.
  //
  // Haze is lit air, and at night there is no light in it: a far range under a
  // night sky stays black and reads as a silhouette, it does not go pale. Mix
  // the same 44% toward a night horizon and the furthest rank lands within a
  // dozen levels of the sky behind it — the exact smear this ramp exists to
  // avoid, arrived at from the other direction.
  const lit = Math.min(1, luminance(air) / 170);
  return AERIAL.map((tier) => desaturateHex(mixHex(ink, air, tier.air * lit), tier.desat));
}
