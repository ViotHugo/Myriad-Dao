// The sea of cloud, as arithmetic: what it is made of, and where it sits.
//
// Everything in this file is pure — no Three.js, no DOM — for the same reason
// progress.js is: it is the half of the cloud sea that can be *checked*.
// `tests/run.js` imports it and holds the tile to its seamlessness and the
// layer stack to the locked camera, neither of which any amount of looking at
// cloud-sea.js would confirm. cloud-sea.js builds what this file describes and
// owns nothing of its own.
//
//   part 1   the tile — a seamless alpha field, generated at boot
//   part 2   the seat — where the four layers sit, solved from the frame
//
// ===========================================================================
// PART 1 — THE TILE
// ===========================================================================
//
// ---------------------------------------------------------------------------
// Why a texture at all, in a renderer with no textures in it
//
// Everything else in this build shades procedurally in the fragment shader,
// which is the right trade when the surface is a few hundred pixels of rock.
// The cloud sea is not that: it is four planes that between them cover most of
// the frame, seen at grazing incidence, so the same fbm that costs nothing on a
// spire is five octaves of noise per screen pixel over half the picture — and
// it aliases, because a procedural field sampled once per fragment has no
// mip chain to fall back on when a hundred metres of cloud land on one pixel
// near the horizon. A tile is sampled once, mipped by the driver, and filtered
// for free.
//
// So it is a texture. It is still not a *download*: it is generated here from
// a seed, in about the time one frame takes, and never leaves memory.
//
// ---------------------------------------------------------------------------
// Seamless is not a nicety — it is the whole job
//
// The tile is repeated across a 400-unit plane. Any discontinuity at its edge
// is therefore drawn as a ruled grid over the entire sea, and a ruled line is
// the one thing cloud must never have: it is exactly what makes a deck read as
// a painted flat instead of as weather. So every field below is *periodic by
// construction* rather than by fading its own edges out:
//
//   the lattice     value noise wraps its integer lattice modulo the octave's
//                   own period, so octave 3 tiles at 8 cells and octave 0 at 1
//   the cells       worley wraps its feature-point grid the same way, and its
//                   3×3 neighbour search wraps with it
//   the warp        a periodic offset field added to periodic coordinates is
//                   still periodic — which is what lets the puffs be domain
//                   warped, and warping is most of what stops worley reading as
//                   a bubble grid
//
// `tests/run.js` asserts the periodicity directly — f(u + 1, v) === f(u, v) at
// a spread of sample points — because a seam is silent in every unit test ever
// written and obvious in the frame.
//
// Pure arithmetic, no Three.js and no DOM: the suite imports this file.
// ---------------------------------------------------------------------------

import { placeAtDepth, unitsPerFrame, FRAMINGS } from './framing.js';

/**
 * The tile, in pixels. The brief's ceiling is 512²; this is a quarter of that
 * and it is not a compromise — the sea is soft-edged by nature and the plane it
 * is drawn on is tiled two to four times across, so the texel density on screen
 * is already finer than the softest thing in the picture. 256² is 256 KB, one
 * upload, and about 20 ms of arithmetic at boot.
 */
export const TILE = 256;

/* ------------------------------------------------------------------ hash */

/** Integer hash → [0, 1). Deterministic across engines: all 32-bit ops. */
function hash2i(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Positive modulo, so the lattice wraps on both sides of the origin. */
function wrap(i, n) { return ((i % n) + n) % n; }

/* ----------------------------------------------------------------- noise */

/**
 * Value noise on a lattice that wraps every `period` cells.
 *
 * `period` is what makes it tile: the four corners of a cell at the tile's
 * right edge are the same four hashes as the cell at its left edge, so the
 * interpolation runs continuously across the join instead of meeting a
 * different random value there.
 */
function valueTiled(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(xi, period);
  const y0 = wrap(yi, period);
  const x1 = wrap(xi + 1, period);
  const y1 = wrap(yi + 1, period);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed);
  const d = hash2i(x1, y1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** Fractal value noise, every octave wrapping at its own period. */
function fbmTiled(u, v, period, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueTiled(u * p, v * p, p, seed + i * 131);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/**
 * Worley F1 on a wrapping cell grid: the distance to the nearest feature
 * point, in cell units.
 *
 * Not the body of the cloud — that was the first thing tried and it is wrong.
 * Inverted worley is a field of round blobs with dark walls between them, and
 * at any coverage that leaves gaps it reads unmistakably as a bubble raft: the
 * eye finds the cell lattice in about a second, warped or not. Worley earns its
 * place as the *erosion*, lifting the threshold along its own boundaries so the
 * mass tears where a billow ends instead of ending on a smooth contour.
 */
function worleyTiled(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      // The point's *identity* wraps; its position does not, so a cell just off
      // the right edge holds the same point as the one at the left edge, one
      // tile further along. That is the whole of tiling worley.
      const wx = wrap(cx, cells);
      const wy = wrap(cy, cells);
      const px = cx + hash2i(wx, wy, seed);
      const py = cy + hash2i(wx, wy, seed + 977);
      const ex = px - x;
      const ey = py - y;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/* ------------------------------------------------------------ the field */

/**
 * The cloud field at (u, v), periodic with period 1 in both axes.
 *
 * Three things stacked, and each has a job:
 *
 *   warp      a low-frequency offset field displaces the lookup. Everything
 *             below is built on a square lattice, and this is what stops the
 *             lattice being legible.
 *   body      five octaves of tiling value noise. Soft masses with soft gaps —
 *             the shape of a cloud sea seen from just above it.
 *   erosion   the worley field lifts the threshold along its cell boundaries,
 *             so the mass tears where a billow ends. Without it the coverage
 *             contour is a smooth curve, and a smooth curve on cloud reads as
 *             a paint edge.
 *
 * `coverage` is the fraction of the tile the mass takes, roughly: it slides the
 * threshold window rather than clipping, so a thinner sea is a thinner sea and
 * not the same sea with holes punched in it.
 *
 * Returns 0..1 coverage — the alpha the plane is drawn with, not a colour. The
 * sea's colour is the realm's, mixed toward the sun and the air per vertex.
 */
export function cloudAlpha(u, v, { seed = 1, cells = 8, coverage = 0.5 } = {}) {
  const wx = fbmTiled(u + 0.31, v + 0.17, 2, 3, seed + 41) - 0.5;
  const wy = fbmTiled(u + 0.73, v + 0.59, 2, 3, seed + 83) - 0.5;
  const uu = u + wx * 0.35;
  const vv = v + wy * 0.35;

  const body = fbmTiled(uu, vv, 3, 5, seed + 7);
  const erode = Math.min(1, worleyTiled(uu, vv, cells, seed + 313) / 0.9);
  // Centred on 0.5 so erosion moves the edge without moving the coverage.
  const lift = (erode - 0.5) * 0.10 + (0.5 - coverage) * 0.30;

  // A tight window, and it matters more here than it would anywhere else. The
  // sea is sampled at five-to-one foreshortening, which smears every gradient
  // along the sightline into a wash: a soft threshold that reads as "soft cloud
  // edge" in the tile reads as "grey plate" in the frame. Crisp here comes back
  // as merely soft there.
  return smoothstep(0.41 + lift, 0.63 + lift, body);
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The tile as RGBA bytes, ready for a DataTexture.
 *
 * Every channel carries the same coverage value. That is not waste: three
 * reads `alphaMap` from the **green** channel specifically, and a single-channel
 * format would hand it a zero — an entirely invisible sea, from a texture that
 * is demonstrably correct in every dump of it. Written to all four, the same
 * tile also works as a `map` if a later stage wants one.
 */
export function cloudTile({ size = TILE, seed = 1, cells = 8, coverage = 0.5 } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = cloudAlpha(x / size, y / size, { seed, cells, coverage });
      const byte = Math.round(a * 255);
      const i = (y * size + x) * 4;
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = byte;
    }
  }
  return data;
}

/* ===========================================================================
 * PART 2 — THE SEAT
 *
 * Where the four layers stand, and what each one does. Solved from the frame
 * rather than authored, because the camera is the coordinate system every art
 * decision in this build is made in — see cloud-sea.js for what the brief's
 * own heights do at this camera, and framing.js for why placement works this
 * way at all.
 * ======================================================================== */

/** The brief's plane: 400 × 400, and a 200-unit radius of sea around the eye. */
export const PLANE = 400;

/**
 * The drift rate: this fraction of the 400-unit plane per second, per rung.
 *
 * The brief writes it as `offset.x += dt * 0.0015 * (i + 1)`, and `offset` is
 * in texture units — so with the tile repeated thirteen times along an axis
 * that number comes out thirteen times too slow. cloud-sea.js multiplies it
 * back by the repeat, which makes 0.0015 mean what it reads as: six tenths of a
 * unit a second on one rung of the stack. The nearest layer takes two rungs and
 * the furthest a half, so the near sea leads the parallax.
 */
export const SCROLL = 0.0015;

/**
 * Where the stack sits, in the frame — three numbers, and every height is
 * solved from them.
 *
 *   v      how far down the frame the **lowest** layer's surface crosses
 *          `depth`. Below the horizon (0.45), because a horizontal surface at
 *          eye level *is* the horizon; above the foreground island's far lip,
 *          or the sea is behind the shelf and there is nothing to see.
 *   step   how much of the frame one rung of the stack is worth, at the same
 *          depth. This is the number the brief misses by a factor of four, and
 *          it is the whole difference between four layers and one sheet.
 *   depth  how far out the near edge of the sea stands. The foreground island
 *          — shelf, standing rocks, the plum on its ledge — reaches about 30
 *          units, and cloud nearer than that is cloud in the room.
 */
export const SEAT = { v: 0.585, step: 0.026, depth: -64 };

/**
 * The camera's own bearing, in the plane's uv space: 2.19 radians.
 *
 * ---------------------------------------------------------------------------
 * Why a horizontal cloud sea has to be built out of ribbons
 *
 * The locked camera looks out level. The horizon is at v = 0.45 and the UI owns
 * the bottom 30%, so the whole sea is seen between 0 and about 11 degrees of
 * depression — and a horizontal surface seen at 11 degrees is foreshortened by
 * 1/tan(11°), better than five to one. Round billows drawn on it come back as
 * flat smears whatever size they are: at 100 units a 50-unit puff is wider than
 * the frame and 1.5% of its height. Measured, and the first two attempts at
 * this stage both died on it.
 *
 * What survives foreshortening is a *ribbon* — long across the sightline, short
 * along it. Across the view it stays as wide as it was drawn; along the view it
 * is squashed into a band of a few percent of frame height, which is exactly
 * what a bank of cloud lying in a valley looks like from its own level, and
 * exactly what 横云 is in every painting of this subject. So the tile is
 * sampled anisotropically — short period along this bearing, long period across
 * it — and the sea is banks rather than billows. It is not a workaround for the
 * camera; it is what the camera is looking at.
 *
 * The number itself: the plane's local +x is world +x and its uv.y runs against
 * world z, so the hero camera's view direction (-0.58, -0.81) in world xz is
 * (-0.58, +0.81) in uv, and atan2 of that is 2.19. `tests/run.js` re-derives it
 * from the framing so it cannot drift away from the camera it describes.
 */
export const VIEW_UV = 2.19;

/**
 * The layers are rotated a quarter turn off that, so the texture's own u axis
 * runs **across** the sightline and its v axis along it.
 *
 * Which makes the brief's `map.offset.x += …` mean what it says: u is the axis
 * a cloud visibly drifts along, and the y drift is a slow creep toward the
 * viewer. Left as u-along-the-sightline — the obvious way to write it — the
 * whole scroll is spent on the one axis the perspective compresses by five to
 * one, and the sea reads as still.
 */
export const ACROSS_UV = VIEW_UV - Math.PI / 2;

/**
 * The four layers, lowest and nearest first.
 *
 * Reading down the list is reading *away*: each layer sits a rung higher, so it
 * lies flatter in the frame, and starts its bank further out. That is what
 * turns four planes into a sea with a near shore you look across and a far edge
 * that thins into the air — the height stack alone would only draw four lines,
 * and the fade stack alone four rings at one height.
 *
 *   repeat    tiles across the 400-unit plane: [across the sightline, along it].
 *             They are nothing like the same number, and that is the single
 *             thing that makes this sea legible at all — see VIEW_UV below.
 *             Across, a period of 55–90 units puts two or three banks in the
 *             frame; along, 22–36 units survives the foreshortening as a band a
 *             dozen pixels deep instead of a wash.
 *   rotation  radians of uv spin, which is what decides *which* axis is "along
 *             the view". Authored as a spread about VIEW_UV rather than
 *             arbitrarily: a bank that runs exactly across the sightline in
 *             every layer reads as a target centred on the player. The tile is
 *             seamless, so a rotated repeat is also just a different window on
 *             the same infinite field — the cheapest variety there is.
 *   heading   the direction this layer drifts, in radians off the x axis. Its
 *             sine is the brief's "slight y drift"; every layer has a different
 *             one, so they shear across each other instead of sliding as one
 *             mass.
 *   crest     how far this layer is mixed from the realm's cloud toward its
 *             crest colour. The top of a sea catches the light; the body of it
 *             does not.
 *   near/far  the radial fades, in units from the eye. Near is deliberately
 *             short — 20-odd units of ramp against a 50-unit billow, so a
 *             bank's leading edge is torn by the alpha map instead of ending in
 *             a smooth wash. Far is long, and the haze has taken most of it
 *             before the fade does.
 *   order     render order. Above the ridge strips and the standing cloud decks
 *             (-6 … -17), which is what lets the sea drown their feet, and
 *             below the near mist (-3).
 *
 *             **Descending down the list**, and that is not a detail. These
 *             planes write no depth, so they are a painter's stack and the
 *             furthest has to go down first; ordered the other way — which is
 *             the way it reads naturally, nearest layer first — the palest,
 *             highest, furthest layer is composited last and paints over the
 *             three in front of it. The whole sea then resolves to one flat
 *             sheet in the top layer's colour, which is exactly the failure
 *             this stage is gated on, arrived at by a sort order.
 *   seed      the swell this layer rides. Different per layer or the four
 *             surfaces undulate in lockstep and read as one thick one.
 */
export const LAYERS = [
  { repeat: [5.2, 13.0], rotation: ACROSS_UV + 0.00, heading: 0.10, opacity: 0.74, crest: 0.12, near: [38, 62], far: [150, 198], order: -4.25, seed: 17 },
  { repeat: [6.4, 16.5], rotation: ACROSS_UV - 0.21, heading: -0.24, opacity: 0.64, crest: 0.38, near: [62, 88], far: [155, 198], order: -4.5, seed: 53 },
  { repeat: [4.4, 11.0], rotation: ACROSS_UV + 0.27, heading: 0.31, opacity: 0.54, crest: 0.64, near: [88, 118], far: [160, 198], order: -4.75, seed: 91 },
  { repeat: [7.2, 18.5], rotation: ACROSS_UV - 0.12, heading: -0.09, opacity: 0.44, crest: 0.90, near: [116, 152], far: [165, 198], order: -5, seed: 137 },
];

/**
 * The swell: how far the sea's surface rises and falls, and over what distance.
 *
 * A flat plane at this camera is foreshortened five to one or worse, so a
 * billow drawn *on* it is a smear — the only thing that survives is a billow
 * the surface actually has. Relief is the one cue here that is not compressed
 * by the grazing angle: 2.6 units of swell at 100 units is 1.5 degrees, which
 * is 3.4% of frame height, against the 1% a whole ribbon of alpha gets. It is
 * what makes one layer *cross* another rather than lie alongside it.
 *
 * Static, while the alpha scrolls over it. A sea whose swell moves with its
 * mass would be more correct and would cost a vertex buffer re-upload every
 * frame; at this amplitude and this speed nothing in the frame can tell.
 */
export const SWELL = { amplitude: 2.6, cells: 7 };

/**
 * The swell height at a point on the plane, in [-0.5, 0.5]. Periodic over the
 * plane exactly, so the surface meets itself at the edges — the same property
 * the tile has, for the same reason.
 */
export function swellAt(u, v, seed) {
  return fbmTiled(u, v, SWELL.cells, 3, seed) - 0.5;
}

/**
 * The height of every layer, in world units.
 *
 * A horizontal plane at height `y` seen from a level-ish eye breaks the frame
 * at whatever depth you look at it, so naming the depth and the frame position
 * fixes the height; one rung is worth `step` of frame height at that same
 * depth, which fixes the spacing. Retune the camera and the sea follows it.
 */
export function seatHeights({ framing = FRAMINGS.world, seat = SEAT, count = LAYERS.length } = {}) {
  const p = placeAtDepth(0.5, seat.v, seat.depth, { framing });
  const base = p ? p[1] : 0;
  const step = seat.step * unitsPerFrame(seat.depth, { framing });
  return Array.from({ length: count }, (_, i) => base + i * step);
}
