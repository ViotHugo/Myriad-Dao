// The foreground platform, as a plan.
//
// ---------------------------------------------------------------------------
// Why the platform is hand-authored and not a cylinder
//
// It was `CylinderGeometry(9.5, 12.5, 3.2, 7)` — a regular heptagon, and the
// largest single object in the frame. A regular polygon is the one silhouette
// the eye solves instantly: it finds the repeat, names the shape, and stops
// reading that part of the picture as rock. Worse, it does it *in grayscale*,
// where the foreground has no colour left to distract from the outline, which
// is the exact instrument this build judges itself with.
//
// Subdividing does not fix it. A 64-sided cylinder is a circle, which is the
// same fault with the repeat moved below the resolution of the eye — you get a
// dinner plate instead of a stop sign. The fix has to be in the *plan*: eleven
// points at angles that do not divide the circle evenly, with radii that do not
// repeat. Then no rotation of the outline lands on itself and there is nothing
// for the eye to solve.
//
// `symmetryScore` below is that statement as a number, and `tests/run.js`
// holds the outline to it, because "looks irregular" is exactly the kind of
// judgement that decays the next time somebody retunes a radius.
//
// ---------------------------------------------------------------------------
// The frame this is composed against
//
// The camera is locked (see camera-config.js) and looks in along a diagonal, so
// only a wedge of the platform is ever on screen: the arc of rim from world
// bearing ~205° to ~265°, which lands at u 0.0 … 1.1 and v ≈ 0.55. Everything
// nearer than that is below the frame or off its right edge. Two consequences
// that every number in this file obeys:
//
//   - the irregularity has to be *in that arc*. An outline that is lively on
//     the camera's side and round at the back is a round platform.
//   - **nothing below the top plane and beyond the rim can be seen.** The eye
//     is 2.03 units up and the rim is a couple of tenths under it, so the
//     platform's own mass occludes every point past its edge that sits below it
//     — measured, not assumed: a flight of steps descending off the back edge is
//     completely invisible from this camera however carefully it is placed. So
//     the steps run *across* the top and leave by the side of the frame instead.
//
// Pure and Three-free, like the other `*-plan` modules, so the composition can
// be asserted in Node.

/**
 * Where the cultivator's feet are, and therefore where the top of whatever she
 * is sitting on has to be.
 *
 * `CAMERA.composition.characterAnchor` is `[0, 0, 0]` and the avatar's lowest
 * vertex is its own y = 0, so this is not a preference — it is the number the
 * whole composition contract is solved from. **Nothing on this island may be
 * authored above it where she stands**, and for a while everything was: the
 * platform's top face sat at +0.30 and the meditation stone's at +0.42 (see the
 * translate in `slabGeometry`), so her lower quarter was inside the rock and she
 * measured 10.2% of frame height against a contract that says 13.5%.
 */
export const SEAT = 0;

/**
 * How far the meditation stone stands proud of the platform around it.
 *
 * It is a low worn slab, not a plinth, and 0.16 is doing two jobs. It has to be
 * enough to read — at radius 2.7 that is about 1.1% of frame height, ten pixels,
 * which is a visible kerb. And it may not be much more than that, because the
 * stone's top *is* the seat, so every unit it stands proud is a unit the whole
 * platform drops: the strip of rock visible between the rim and her feet is only
 * 3.6% of the frame with the platform at zero, 2.6% here, and closed entirely by
 * −0.60.
 */
export const STONE_PROUD = 0.16;

/** The extrusion. `depth` is the wall; `slabGeometry` adds the bevel outside it. */
export const PLATFORM = {
  /** World units the unit outline below is multiplied by. */
  radius: 10.6,
  /**
   * Top face height — the flat rock around the stone, so it sits one stone's
   * thickness below the seat. Everything that stands on the island is seated
   * from `surfaceAt()` rather than from this directly.
   */
  top: SEAT - STONE_PROUD,
  depth: 3.5,
  /** A *small* bevel: a chamfered lip, not a rounded pebble. */
  bevel: { thickness: 0.30, size: 0.46, segments: 2 },
  /** How far a top-face vertex is thrown for chipping, either way. */
  chip: 0.05,
};

/** The meditation stone, whose top face is the seat itself. */
export const STONE = {
  radius: 2.75,
  depth: 0.78,
  bevel: { thickness: 0.10, size: 0.14, segments: 1 },
  chip: 0.04,
};

/**
 * Eleven points, hand-placed.
 *
 * Angles first: eleven gaps, all different, none of them a divisor of 360. Then
 * radii, jittered 0.79–1.15 and never twice the same, with the widest and the
 * narrowest deliberately adjacent (189° and 208°) so the outline has a corner
 * in it rather than a gentle swell.
 *
 * They are **not evenly spread**, and that is the load-bearing part. Only the
 * arc from about 190° to 290° is ever on screen; the rest of the rim is off the
 * left edge, below the frame, or behind the camera. Eleven points spread evenly
 * put two of them in that arc and a straight line between — a lively plan that
 * renders as a smooth curve. Six of the eleven live in the visible arc, at
 * 16–22° apart, which is where a chipped edge actually has to be.
 *
 * The third column is the one the picture actually depends on, and it took
 * measuring to find out. The eye is 2.03 units above a slab twenty-one units
 * across, so the rim is seen very nearly edge-on: swinging a radius by four
 * world units — a third of the whole platform — moves that piece of the
 * silhouette by 1.4% of frame height. A *height* of half a unit at the same
 * place moves it by 2.5%. Radial irregularity is what stops the shape being a
 * polygon in plan; vertical relief is what makes the edge look broken from the
 * one place the game is ever seen from, and a platform authored without it is a
 * ruled horizontal line across the bottom third however lively its plan.
 *
 * Written out rather than generated because it is a *drawing*: thirty-three
 * numbers are cheaper to read, to argue with and to retune than a noise
 * function that has to be run to find out what it did.
 */
const OUTLINE = [
  // deg    r     lift
  [6, 1.00, 0.14], [52, 0.86, -0.22], [104, 1.09, 0.30], [151, 0.83, -0.09],
  [189, 1.15, 0.36], [208, 0.79, -0.42], [224, 1.04, 0.19], [241, 0.90, -0.31],
  [259, 1.12, 0.38], [281, 0.84, -0.16], [317, 0.96, 0.25],
];

/** The plan, as `[x, z]` pairs at world scale. */
export function platformOutline(radius = PLATFORM.radius) {
  return OUTLINE.map(([deg, r]) => {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a) * r * radius, Math.sin(a) * r * radius];
  });
}

/**
 * How high the top face stands at a point on it, relative to `PLATFORM.top`.
 *
 * A pure function of position, which is not an implementation detail: an
 * `ExtrudeGeometry` is not indexed, so a vertex on a shared edge is stored two
 * or three times, and a displacement drawn from anything but the position
 * itself gives those copies different answers and tears the cap open. Same rule
 * the peaks are carved under.
 *
 * It fades to zero over the middle of the platform, because the middle is where
 * the cultivator sits: the seat is `SEAT` exactly, and relief under her would
 * push rock up through the figure whose feet the whole composition contract is
 * solved from. Out at the rim it is free to stand higher than the seat, and
 * does — that is a broken terrace rather than a table.
 */
export function topRelief(x, z, radius = PLATFORM.radius) {
  const r = Math.hypot(x, z);
  if (r < 1e-6) return 0;
  const a = Math.atan2(z, x);
  // The same polar lerp radialProfile uses, on the lift column.
  const pts = OUTLINE
    .map(([deg, , lift]) => ({ a: ((((deg * Math.PI) / 180 + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI, lift }))
    .sort((p, q) => p.a - q.a);
  let hi = pts.findIndex((p) => p.a >= a);
  if (hi < 0) hi = 0;
  const lo = (hi - 1 + pts.length) % pts.length;
  let da = pts[hi].a - pts[lo].a;
  if (da <= 0) da += Math.PI * 2;
  let t = a - pts[lo].a;
  if (t < 0) t += Math.PI * 2;
  const lift = pts[lo].lift + (pts[hi].lift - pts[lo].lift) * (t / da);
  // Flat under the figure, full relief at the rim.
  const k = Math.min(1, Math.max(0, (r / radius - 0.34) / 0.66));
  return lift * k * k * (3 - 2 * k);
}

/**
 * How high the rock actually is at a point on the island — the one answer to
 * "what am I standing on", and the only thing anything up here may seat itself
 * from.
 *
 * It exists because there were four different answers. The platform's own top
 * came out at `+bevel.thickness` rather than at `PLATFORM.top`, the censer was
 * seated on bare `topRelief()`, the standing rocks on a hardcoded −0.35, and the
 * plum on a hand-tuned −0.05 — so three of the four were underground and the
 * fourth was floating, and every one of them was individually plausible.
 */
export function surfaceAt(x, z) {
  return PLATFORM.top + topRelief(x, z);
}

/**
 * The meditation stone: the same idea at a tenth the size.
 *
 * It was a nine-sided cylinder sitting on a seven-sided one — two regular
 * polygons stacked concentrically, which is a target, not a rock.
 */
const STONE_PLAN = [
  [14, 1.00], [58, 0.83], [97, 1.10], [141, 0.88], [190, 1.06], [243, 0.79], [299, 0.97],
];

export function stoneOutline(radius = STONE.radius) {
  return STONE_PLAN.map(([deg, r]) => {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a) * r * radius, Math.sin(a) * r * radius];
  });
}

/* --------------------------------------------------------- symmetry maths */

/**
 * The outline resampled as radius-against-angle, at even angular steps.
 *
 * Every outline in this file is star-shaped about the origin — every ray from
 * the centre crosses it exactly once — so the polar form is complete and the
 * resample is a lerp between neighbouring points rather than a ray cast.
 */
export function radialProfile(points, samples = 240) {
  const polar = points
    .map(([x, z]) => ({ a: Math.atan2(z, x), r: Math.hypot(x, z) }))
    .sort((p, q) => p.a - q.a);
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = -Math.PI + ((i + 0.5) / samples) * Math.PI * 2;
    let hi = polar.findIndex((p) => p.a >= a);
    if (hi < 0) hi = 0;
    const lo = (hi - 1 + polar.length) % polar.length;
    let da = polar[hi].a - polar[lo].a;
    if (da <= 0) da += Math.PI * 2;
    let t = a - polar[lo].a;
    if (t < 0) t += Math.PI * 2;
    out[i] = polar[lo].r + (polar[hi].r - polar[lo].r) * (t / da);
  }
  return out;
}

/**
 * How far the outline is from its own best symmetry, as a fraction of its mean
 * radius. Bigger is more irregular; a regular n-gon scores 0.
 *
 * Every rotation is tried, and every reflection. A shape that matches itself
 * under any of them has a symmetry the eye can find, and the gate for this
 * stage is that the platform has none — so the score is the *worst case*, the
 * closest any of those comparisons comes to a match.
 *
 * `minTurn` is why this is not a two-line function. A rotation of one and a
 * half degrees matches almost anything: the profile is piecewise linear over
 * spans of twenty degrees or more, so a lag of one sample scores near zero on a
 * shape with no symmetry at all, and the minimum over *all* lags is therefore
 * always ~0 and says nothing. Only rotations big enough for the eye to be
 * comparing two different parts of the outline count, and fifteen degrees is
 * that floor — well under the tightest repeat a regular eleven-gon could have
 * (32.7°), so nothing real is excluded with it.
 */
export function symmetryScore(points, samples = 240, minTurn = Math.PI / 12) {
  const r = radialProfile(points, samples);
  const mean = r.reduce((a, b) => a + b, 0) / samples;
  const skip = Math.ceil((minTurn / (Math.PI * 2)) * samples);
  let best = Infinity;

  const rms = (at) => {
    let s = 0;
    for (let i = 0; i < samples; i++) { const d = r[i] - at(i); s += d * d; }
    return Math.sqrt(s / samples) / mean;
  };

  // Rotations, excluding the identity and its immediate neighbourhood.
  for (let k = skip; k <= samples - skip; k++) best = Math.min(best, rms((i) => r[(i + k) % samples]));
  // Reflections, about every axis the sampling can express. A reflection is
  // never near the identity, so every one of them counts.
  for (let k = 0; k < samples; k++) best = Math.min(best, rms((i) => r[(((k - i) % samples) + samples) % samples]));
  return best;
}

/* ------------------------------------------------------------ set dressing */

/**
 * Worn steps, descending over the platform's back shoulder and leaving by the
 * side of the frame — the one cue in the picture that says the world does not
 * stop at the crop.
 *
 * ---------------------------------------------------------------------------
 * Why they are on the *rim* and not on the floor
 *
 * A stair laid across the middle of the platform is invisible, and the reason
 * is the foreshortening this whole file keeps running into. The visible top of
 * the platform occupies v 0.55 … 0.60 — five percent of the frame — and
 * everything past radius four is crammed into the top two percent of that. Six
 * treads out there came to about twelve pixels *in total*, dark rock on dark
 * rock, and the contact sheet showed nothing at all where they were.
 *
 * What does read at this camera is a break in a **silhouette**. Set just inside
 * the rim and standing half a unit proud, each tread's top lands at v ≈ 0.525
 * against a rim line at v ≈ 0.54 — so it notches the platform's own skyline and
 * is seen against the cloud sea rather than against the rock. The flight sinks
 * as it goes right, u 0.62 … 1.11, until the last tread is level with the rim
 * and half off the edge of the picture.
 *
 * `at` is inside the outline by 1.7 at every bearing (the outline runs 9.0–11.7
 * along this arc), so no tread overhangs. `h` is deep enough that the riser
 * stays buried whatever the rim relief is doing under it. The flight starts at
 * bearing 244° because 220°–230° is where the plum is planted, and at u = 0.62
 * because anything left of that is behind the cultivator.
 *
 * `proud` is how far the tread stands above **the rock directly under it**, and
 * that is the only sane way to author it. It used to be an absolute world
 * height, hand-tuned against a platform that was secretly 0.30 higher than the
 * code believed (see the translate in `slabGeometry`): every tread came out a
 * third of a unit low, and re-tuning by eye pushed them lower still, because
 * what was actually visible was two treads poking through a rim that was
 * covering the other four. Measured properly, four of the six were *below their
 * own surface* — a flight of steps buried in the rock it is cut into.
 *
 * The values descend, so the path is a stair rather than a shelf. What does not
 * descend is the *world height*: the rim relief swings ±0.42 under it, so the
 * flight climbs over the shoulder at 260° before it drops away to the right and
 * out of the picture, which is what a path over a shoulder does.
 */
export const STEPS = [
  { at: [-3.53, -7.27], proud: 0.29, w: 2.60, d: 1.55, h: 1.6, yaw: 1.06, seed: 311 },
  { at: [-2.87, -8.83], proud: 0.25, w: 2.55, d: 1.50, h: 1.6, yaw: 1.20, seed: 733 },
  { at: [-1.74, -9.84], proud: 0.21, w: 2.50, d: 1.52, h: 1.6, yaw: 1.34, seed: 197 },
  { at: [-0.31, -8.98], proud: 0.17, w: 2.45, d: 1.46, h: 1.6, yaw: 1.48, seed: 941 },
  { at: [0.82, -7.83], proud: 0.13, w: 2.40, d: 1.48, h: 1.6, yaw: 1.62, seed: 419 },
  { at: [1.72, -7.02], proud: 0.09, w: 2.35, d: 1.42, h: 1.6, yaw: 1.76, seed: 587 },
];

/** A tread's top, in world height. */
export const stepTop = (s) => surfaceAt(s.at[0], s.at[1]) + s.proud;

/**
 * The anchoring prop: a small incense burner, off the cultivator's right where
 * the platform is otherwise empty.
 *
 * The brief offers a flagstone, a stone marker or a censer, and the censer is
 * the one that adds something no other object in the frame does — a *human*
 * trace, and a thin vertical of near-white smoke standing against the one
 * near-black band in the picture. The rocks around it are geology; this is the
 * only thing on the mountain somebody put there.
 *
 * `at` is a plan position; it stands on `surfaceAt()`, like everything else.
 */
export const CENSER = { at: [1.05, -2.35], radius: 0.44, height: 0.62, yaw: 0.7 };

/** Where the smoke goes: how tall the ribbon is and how far it leans off. */
export const SMOKE = { height: 2.9, width: 0.22, lean: [-0.55, 0.35], rows: 16 };
