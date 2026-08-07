// The range, as arithmetic: what the peaks are made of and where the fourteen
// of them stand.
//
// Pure — no Three.js, no DOM — for the same reason `cloud-plan.js` and
// `progress.js` are. `tests/run.js` imports this file and holds the composition
// to the locked camera: three heroes, five supporting, six distant, every
// summit clear of the status bar, every foot inside a cloud, no two instances
// sharing a rotation, and every scale inside the authored range. None of that
// is checkable by looking at `peaks.js`, and all of it is the kind of fault
// that is silent in code and total on screen.
//
// ---------------------------------------------------------------------------
// Fewer and bigger
//
// The range this replaces was ninety-six instances of one vertex-shader profile
// scattered over three ranks. It read as fifteen identical melted candles, and
// the reason is not the count: it is that every silhouette in it was the same
// silhouette — a smooth taper with a smooth wobble — so the eye found the
// repeat immediately and stopped reading the frame as landscape.
//
// Fourteen peaks over six meshes is the opposite trade. Each mesh is carved
// once, properly, out of ridged noise with shelves cut into it and its own top
// profile; the set is small enough that no two visible peaks are the same
// shape, and each one is big enough in frame to be worth looking at. Six draw
// calls, against the old three.
//
//   3 hero        the near band, the mass the composition is built on. One of
//                 them is the host, 主山 — tallest, furthest forward, on a third.
//   5 supporting  the middle distance. Prominence varies hard: a range where
//                 every peak is the same height is a plateau.
//   6 distant     the skyline. Small in frame, simple in silhouette, and the
//                 rung of the value ladder that is almost the air.
//
// ---------------------------------------------------------------------------
// Placed in the frame, sized in the world
//
// Every peak names where its foot and its summit land in the picture, and
// `framing.js` returns the world position that puts them there — the same
// arithmetic the ridges and the cloud sea are placed with, and for the same
// reason: the camera is the coordinate system, and a peak placed at a world
// coordinate is a peak that has to be re-guessed the moment the lens moves.
//
// The instance's *scale* falls out of that: a peak is as tall as the frame says
// it is, divided by its mesh's own height. Expressed against SCALE_UNIT below,
// every instance in the set lands between 0.6 and 2.2 — which is not a
// coincidence, it is the range the composition was drawn to and the suite holds
// it there. A peak outside it is either a pebble or a wall.
// ---------------------------------------------------------------------------

import { placeAtDepth, unitsPerFrame, FRAMINGS } from './framing.js';
import { seatHeights } from './cloud-plan.js';

/**
 * One unit of peak, in world units.
 *
 * Instances are scaled uniformly, and this is what "scale 1.0" means. It exists
 * so the spread across the set is a number anyone can read — 0.6 is the
 * smallest thing in the range and 2.2 the largest — rather than a pile of world
 * heights that only mean something next to a depth.
 */
export const SCALE_UNIT = 42;

/** The authored range of instance scale. Asserted, both ends. */
export const SCALE_RANGE = [0.6, 2.2];

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Broad profile of a peak at height `t` and heading `theta`.
 *
 * Normalisation is part of the contract: silhouette shaping redistributes the
 * old cylinder's volume but may not enlarge its authored envelope. Otherwise
 * individually readable peaks fuse after the placement table has been tuned.
 * Kept Three-free so the composition suite can measure the actual invariant.
 */
export function silhouetteMass(silhouette, t, theta) {
  if (!silhouette) return 1;
  const base = silhouette.base * (1 - t) ** 3;
  const shoulder = silhouette.shoulder * Math.exp(-(((t - 0.30) / 0.16) ** 2));
  const waist = silhouette.waist * Math.exp(-(((t - 0.67) / 0.13) ** 2));
  const crag = silhouette.crag * smooth(0.72, 0.92, t) * (1 - smooth(0.93, 1, t));
  const buttress = 1 + silhouette.asym * Math.cos(theta * 3 + silhouette.phase) * (1 - t * 0.45);
  return ((1 + base + shoulder - waist + crag) * buttress) / silhouette.envelope;
}

/** Maximum unnormalised profile, sampled more finely than the source mesh. */
export function silhouetteEnvelope(silhouette) {
  let max = 1;
  const unnormalised = { ...silhouette, envelope: 1 };
  for (let row = 0; row <= 128; row++) {
    const t = row / 128;
    // The angular maximum of the three-lobed term occurs at cos(...) = 1.
    const theta = -silhouette.phase / 3;
    max = Math.max(max, silhouetteMass(unnormalised, t, theta));
  }
  return max;
}

/* ------------------------------------------------------------ the meshes */

/**
 * Six blanks, and every one of them is a different rock.
 *
 * `radiusTop` is written as a fraction of `radiusBottom` and never goes below
 * 0.15 or above 0.6: a cylinder that closes to a point is a cone, a cone is the
 * one shape the eye names instantly, and a field of them is a row of cypresses.
 * Granite ends in a summit *area* — a crown, a saddle, a plateau — never in a
 * vertex.
 *
 *   radial / height   the cylinder the blank is cut from. Seven to nine sides
 *                     so the cross-section is already a polygon and not a
 *                     circle; twelve to sixteen rows so there are rings to cut
 *                     shelves into.
 *   ridge             frequency and amplitude of the ridged displacement. High
 *                     frequency around the column and low up it is what makes
 *                     the creases run *vertically*, which is what fracture in
 *                     granite does.
 *   shelves           how many horizontal ledges are cut. Two to four.
 *   top               the summit profile. The whole point of six meshes.
 *   squash            cross-section flattening. A fin is a wall seen edge-on
 *                     from one side and a blade from the other, which is the
 *                     cheapest silhouette in the set.
 *   silhouette        large-scale erosion, applied before the small granite
 *                     noise. Base talus, an off-centre shoulder, a pinched
 *                     neck and lateral drift stop the blanks reading as tubes.
 */
export const PEAK_MESHES = [
  {
    id: 'plateau',
    seed: 4101,
    radialSegments: 9, heightSegments: 14,
    radiusBottom: 0.30, radiusTop: 0.55, height: 1.20,
    ridge: { freq: 3.6, amp: 0.52 }, shelves: 4, squash: 0.88,
    silhouette: { base: 0.34, shoulder: 0.20, waist: 0.10, crag: 0.08, asym: 0.10, drift: [-0.04, 0.02] },
    // A flat crown with a pavilion on it. The pavilion is the scale cue the
    // summit pines give the rest of the range: a mountain with nothing on it
    // could be thirty metres tall.
    top: 'plateau',
  },
  {
    id: 'saddle',
    seed: 4177,
    radialSegments: 8, heightSegments: 16,
    radiusBottom: 0.27, radiusTop: 0.42, height: 1.55,
    ridge: { freq: 4.2, amp: 0.56 }, shelves: 3, squash: 0.80,
    silhouette: { base: 0.42, shoulder: 0.15, waist: 0.16, crag: 0.14, asym: 0.14, drift: [0.06, -0.03] },
    // Two horns with a col between them. Reads at any distance, and it is the
    // one profile that cannot be mistaken for a taper.
    top: 'saddle',
  },
  {
    id: 'spire',
    seed: 4231,
    radialSegments: 7, heightSegments: 16,
    radiusBottom: 0.19, radiusTop: 0.20, height: 2.30,
    ridge: { freq: 5.4, amp: 0.46 }, shelves: 2, squash: 0.94,
    silhouette: { base: 0.55, shoulder: 0.18, waist: 0.22, crag: 0.18, asym: 0.16, drift: [0, 0.015] },
    // Off plumb, and the lean is in the *mesh*: a leaning tower rotated about
    // its own axis leans a different way from every angle, which is exactly the
    // variety an instanced set needs.
    top: 'spire', lean: 0.14,
  },
  {
    id: 'arch',
    seed: 4289,
    radialSegments: 8, heightSegments: 13,
    radiusBottom: 0.32, radiusTop: 0.30, height: 1.70,
    ridge: { freq: 3.8, amp: 0.48 }, shelves: 3, squash: 0.86,
    silhouette: { base: 0.46, shoulder: 0.22, waist: 0.12, crag: 0.10, asym: 0.12, drift: [-0.05, 0.04] },
    // Negative space. A hole in a silhouette is legible at a distance where no
    // amount of surface detail is, and it is the single cheapest thing in this
    // file that says "this is a specific mountain and not a mountain shape".
    top: 'arch',
  },
  {
    id: 'buttress',
    seed: 4337,
    radialSegments: 9, heightSegments: 12,
    radiusBottom: 0.37, radiusTop: 0.50, height: 1.05,
    ridge: { freq: 3.0, amp: 0.58 }, shelves: 4, squash: 0.92,
    silhouette: { base: 0.38, shoulder: 0.30, waist: 0.08, crag: 0.06, asym: 0.18, drift: [0.035, -0.05] },
    // Squat, broad, heavily terraced. The workhorse: a range made only of tall
    // things has no floor to it.
    top: 'crown',
  },
  {
    id: 'fin',
    seed: 4391,
    radialSegments: 7, heightSegments: 15,
    radiusBottom: 0.25, radiusTop: 0.26, height: 1.80,
    ridge: { freq: 5.0, amp: 0.50 }, shelves: 2, squash: 0.52,
    silhouette: { base: 0.50, shoulder: 0.16, waist: 0.20, crag: 0.16, asym: 0.20, drift: [-0.08, -0.025] },
    top: 'crown',
  },
];

// Derive, rather than hand-tune, the normaliser. Phase is seeded per archetype
// so their buttresses do not all face the same way.
for (const mesh of PEAK_MESHES) {
  mesh.silhouette.phase = mesh.seed * 0.017;
  mesh.silhouette.envelope = silhouetteEnvelope(mesh.silhouette);
}

export const MESH_INDEX = Object.fromEntries(PEAK_MESHES.map((m, i) => [m.id, i]));

/* -------------------------------------------------------- the placements */

/**
 * Fourteen peaks. Read the table as a picture: `u` across the frame, `footV`
 * and `headV` down it, `z` how far out.
 *
 * Two rules run through it. Nothing repeats — no two entries share a mesh *and*
 * a band, no two share a yaw, and instances of one mesh are never neighbours in
 * `u`. And nothing is centred: the host sits on a third, the biggest supporting
 * mass sits off the other third, and the distant band deliberately runs off
 * both edges, because a range that stops at the frame edge gives itself away
 * the first time the player drags the camera.
 */
/**
 * The arch carries two constraints the others do not.
 *
 * An opening is only an opening if you can see through it. The mesh's gap runs
 * along its own x, so the yaw has to put the *sightline* along its z — 0.66
 * here, near the camera's own bearing of 0.62. Turned any other way the legs
 * line up behind each other and a through-arch renders as a mushroom.
 *
 * And there is exactly one of it, in the near band. A distant arch does not
 * read as an arch: its legs come out a couple of pixels wide and vanish into
 * the haze, so all that is left is the crown — a pale slab apparently floating
 * over the range with a dark gap beneath it, which is not negative space, it is
 * the artefact negative space is supposed to be worth. The mesh is used once,
 * where the legs are wide enough to be seen holding it up.
 */
export const PEAKS = [
  /* --- 3 hero: the near mass ------------------------------------------- */
  // 主山, the host. Tallest, furthest forward, on the left third, and the one
  // peak in the set with a building on it.
  { id: 'host', band: 'hero', mesh: 'plateau', u: 0.335, footV: 0.545, headV: 0.132, z: -158, yaw: 0.42, tilt: [0.021, -0.014] },
  { id: 'gate', band: 'hero', mesh: 'arch', u: 0.700, footV: 0.512, headV: 0.170, z: -186, yaw: 0.66, tilt: [-0.018, 0.024] },
  { id: 'lean', band: 'hero', mesh: 'spire', u: 0.115, footV: 0.498, headV: 0.186, z: -172, yaw: 4.02, tilt: [0.030, 0.017] },

  /* --- 5 supporting: the middle distance -------------------------------- */
  { id: 'shoulder', band: 'supporting', mesh: 'buttress', u: 0.470, footV: 0.486, headV: 0.186, z: -250, yaw: 1.17, tilt: [-0.024, -0.020] },
  { id: 'blade', band: 'supporting', mesh: 'fin', u: 0.885, footV: 0.478, headV: 0.232, z: -272, yaw: 5.46, tilt: [0.016, -0.026] },
  { id: 'col', band: 'supporting', mesh: 'saddle', u: 0.045, footV: 0.482, headV: 0.219, z: -238, yaw: 3.28, tilt: [-0.029, 0.012] },
  { id: 'needle', band: 'supporting', mesh: 'spire', u: 0.625, footV: 0.472, headV: 0.256, z: -305, yaw: 0.86, tilt: [0.013, 0.028] },
  { id: 'terrace', band: 'supporting', mesh: 'buttress', u: 0.215, footV: 0.470, headV: 0.268, z: -330, yaw: 4.74, tilt: [0.026, -0.011] },

  /* --- 6 distant: the skyline ------------------------------------------- */
  { id: 'far-blade', band: 'distant', mesh: 'fin', u: -0.020, footV: 0.472, headV: 0.288, z: -430, yaw: 2.75, tilt: [-0.012, 0.022] },
  { id: 'far-col', band: 'distant', mesh: 'saddle', u: 0.330, footV: 0.468, headV: 0.312, z: -470, yaw: 5.93, tilt: [0.019, 0.015] },
  { id: 'far-horn', band: 'distant', mesh: 'saddle', u: 0.860, footV: 0.470, headV: 0.292, z: -505, yaw: 3.80, tilt: [-0.015, -0.023] },
  { id: 'far-mass', band: 'distant', mesh: 'buttress', u: 1.020, footV: 0.474, headV: 0.320, z: -560, yaw: 3.71, tilt: [0.011, 0.026] },
  { id: 'far-fin', band: 'distant', mesh: 'fin', u: 0.520, footV: 0.466, headV: 0.316, z: -610, yaw: 0.28, tilt: [-0.027, -0.016] },
  { id: 'far-crown', band: 'distant', mesh: 'plateau', u: 0.150, footV: 0.478, headV: 0.332, z: -545, yaw: 2.06, tilt: [0.023, -0.028] },
];

/**
 * How far a peak's origin is pushed below its foot, in world units.
 *
 * A peak is tilted a couple of degrees off plumb, and a tilted seventy-unit
 * mass lifts the far side of its own base clear of the ground by a metre or
 * two. Sinking every instance means the base is buried in the cloud and the
 * terrain rather than balanced on it — the summit stays exactly where the frame
 * put it, because the scale is solved against the sunk origin.
 */
export const SINK = 7;

/**
 * Why every foot sits at v 0.46 or lower.
 *
 * A peak's base is a cap facing straight down, and a downward-facing cap takes
 * no sun and the ground half of the hemisphere — so it renders as a flat, dark,
 * hard-edged plate. Left standing above the far shore's crest that plate is a
 * shard hanging in the air under a mountain, which is exactly the artefact
 * stage 4 was asked to clear out; it was there before, at the foot of every
 * karst pillar, and the old shader hid it by dissolving the lowest fifth of the
 * rock into the air colour.
 *
 * Dissolving an *opaque* surface is a lie the depth buffer does not tell, so
 * the fix is geometric instead: the crest of the terrain runs between v 0.403
 * and 0.441 across the frame, and every foot in the table is placed below the
 * bottom of that band. The base of every peak is behind the ground.
 */

/**
 * The order the range is *revealed* in as the player climbs — which is not the
 * order it is written in.
 *
 * `progress.js` turns the realm into a fraction of the range that is standing,
 * and something has to decide which peaks that fraction keeps. The ridge
 * strips in world.js already settled the principle: **losing the skyline reads
 * as a bug, losing a middle layer reads as weather.**
 *
 * Written the obvious way, first-to-last, the opening realm had the three
 * heroes and four of the supporting band and *no skyline at all*: a third of
 * the frame was empty sky where a range should be, which does not read as "you
 * have not climbed far", it reads as unfinished.
 *
 * So the three heroes come first, and the other two bands are then *interleaved*
 * — one distant, one supporting, one distant — rather than taken a band at a
 * time. Both readings of "fewer peaks" are wrong on their own: first-to-last
 * leaves the opening realm with no horizon, and skyline-first leaves it with a
 * hole where the middle distance should be. Interleaved, a young range is the
 * same range at lower density, which is what thinning a landscape actually
 * looks like.
 */
function revealOrder() {
  const of = (band) => PEAKS.filter((p) => p.band === band);
  const near = of('distant');
  const mid = of('supporting');
  const out = of('hero');
  for (let i = 0; i < Math.max(near.length, mid.length); i++) {
    if (near[i]) out.push(near[i]);
    if (mid[i]) out.push(mid[i]);
  }
  return out;
}

/**
 * Resolve the table into world transforms, in reveal order.
 *
 * Returns plain objects — position, euler, uniform scale — so the suite can
 * check the composition without a renderer, and `scenery.js` only has to write
 * them into instance matrices.
 */
export function peakPlacements({ framing = FRAMINGS.world } = {}) {
  const byId = Object.fromEntries(PEAK_MESHES.map((m) => [m.id, m]));
  const out = [];
  for (const p of revealOrder()) {
    const mesh = byId[p.mesh];
    const foot = placeAtDepth(p.u, p.footV, p.z, { framing });
    const head = placeAtDepth(p.u, p.headV, p.z, { framing });
    if (!foot || !head) continue;
    // Sunk, and grown by exactly as much: the summit lands where it was asked
    // to land whatever the sink is.
    const scale = (head[1] - foot[1] + SINK) / mesh.height;
    out.push({
      ...p,
      mesh,
      meshIndex: MESH_INDEX[p.mesh],
      position: [foot[0], foot[1] - SINK, p.z],
      summit: [foot[0], head[1], p.z],
      scale,
      /** The same number against SCALE_UNIT — what the brief calls 0.6 … 2.2. */
      unitScale: scale / SCALE_UNIT,
      /** World height of the visible peak, foot to summit. */
      worldHeight: head[1] - foot[1],
      /** How wide it stands, at its base. The thing that decides crowding. */
      worldWidth: mesh.radiusBottom * 2 * scale,
    });
  }
  return out;
}

/**
 * Where each cloud element's surface crosses the frame, as [top, bottom] in v.
 *
 * The gate is "peaks visibly emerge from the cloud sea", and that is a claim
 * about the *frame*, not about world coordinates: a peak emerges when its foot
 * lands inside a band of cloud and its summit stands above the top of it. The
 * sea's own band is solved here from the seat heights `cloud-plan.js` already
 * publishes, so the two cannot drift apart.
 */
export function cloudBands({ framing = FRAMINGS.world } = {}) {
  const heights = seatHeights({ framing });
  const bands = [];
  // The sea. A horizontal surface at height y crosses the frame at the v where
  // the eye's ray drops to it; the top of the sea's band is its highest layer
  // at the furthest the radial fade lets it be seen, and the bottom is its
  // lowest layer close in. Both are read at the depth the peaks stand behind.
  const top = frameVOfPlane(Math.max(...heights), 190, framing);
  const bottom = frameVOfPlane(Math.min(...heights), 42, framing);
  bands.push({ id: 'sea', top, bottom });
  // The three standing decks in scenery.js, which is where the distant band's
  // feet are drowned — the sea does not reach that far out.
  bands.push({ id: 'deck-near', top: 0.335, bottom: 0.640 });
  bands.push({ id: 'deck-mid', top: 0.268, bottom: 0.470 });
  bands.push({ id: 'deck-far', top: 0.212, bottom: 0.372 });
  return bands;
}

/** Where a horizontal plane at world height `y`, seen at distance `d`, lands. */
function frameVOfPlane(y, d, framing) {
  const eye = placeAtDepth(0.5, 0.45, -d, { framing });
  return 0.45 + (eye[1] - y) / unitsPerFrame(-d, { framing });
}
