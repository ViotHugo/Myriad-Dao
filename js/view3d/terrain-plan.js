// The ground, as arithmetic.
//
// ---------------------------------------------------------------------------
// What was wrong with a plane
//
// The valley floor was a flat `PlaneGeometry(320, 130, 1, 1)` with the water
// shader on it, and the sea of cloud lay over it as four more flat planes. Flat
// is not the fault on its own — the fault is what a flat horizontal surface
// does at this camera. The eye is 11° above the sea at most, so a horizontal
// plane is foreshortened better than five to one, and the *whole* of its far
// half is compressed into a couple of percent of frame height. Every gradient
// on it — including the radial fade that is supposed to make it end softly —
// collapses into a single ruled horizontal line across the picture.
//
// That line is the razor-straight ground/sky seam, and no amount of softening
// the fade can remove it: the softness is being flattened by the projection,
// not by the shader. The only thing that survives a grazing angle is *relief* —
// a surface that is genuinely at different heights in different places, so its
// silhouette against the sky is decided by the land and not by where the plane
// happens to stop.
//
// So the ground is a subdivided plane displaced by low-frequency noise over a
// long section, and the section is authored so that the far shore rises to a
// crest that stands **above** where the cloud sea's own far edge lands. The
// ruled line is not softened; it is covered by a ridgeline.
//
// ---------------------------------------------------------------------------
// Why the noise is not ridged
//
// The peaks are carved with `1 - |noise|` because rock fractures. Land does
// not: a valley floor built out of creases reads as crumpled paper, and the
// eye is very good at telling the two apart at a glance. The terrain takes
// plain fractal noise at a period of about 130 units — low frequency on
// purpose, because this is a landform, and detail here would only alias.
//
// Pure: no Three.js. `tests/run.js` imports this file and checks the things
// that decide whether the seam is gone — that the crest is a ridgeline rather
// than a line, that it stands above the cloud sea's far edge everywhere across
// the frame, and that the ground never rises through the meditation shelf.
// ---------------------------------------------------------------------------

import { makeNoise3, fbm3 } from './noise.js';

/** The plane the ground is cut from, and how finely. */
export const TERRAIN = {
  /** 860 × 460 world units, centred behind and to the left of the island. */
  width: 860,
  depth: 460,
  centre: [-250, -240],
  /**
   * ~6 units a cell. Fine enough that the crest reads as a ridgeline rather
   * than as a dozen facets, coarse enough that the whole ground is 20k
   * triangles in one draw call. This is *not* polygon density standing in for
   * form — the form is in the displacement; this is only enough resolution to
   * carry it.
   */
  segX: 142,
  segZ: 72,
  seed: 3607,
};

/**
 * The long section: how high the ground is at a given depth, before relief.
 *
 * Read it as a walk away from the shelf. It drops out of the bottom of the
 * frame at the near edge, crosses the valley the river runs in, climbs to the
 * far shore of the cloud sea — the crest, and the whole reason this file
 * exists — then falls away behind it so the ranges and the ridge strips are not
 * walled off.
 *
 * ---------------------------------------------------------------------------
 * Why the crest is *here*, at 118 units, and not further out
 *
 * This is the one number in the file that was arrived at rather than chosen,
 * and the reasoning is worth keeping because it is not obvious and it is easy
 * to undo.
 *
 * The sea of cloud is four horizontal planes that fade out at 198 units. Where
 * they stop, they stop along a *ring* — and a ring on a horizontal plane seen
 * from just above it projects to a horizontal line. Worse, the fade that is
 * supposed to soften it spans 48 units of ground and about half a percent of
 * frame height, so it is not soft at all: it is the razor-straight seam.
 *
 * Nothing done to the sea can fix that. A wobblier fade moves the ring in and
 * out by thirty units and the line by four pixels, because at a grazing angle
 * radial distance barely maps to frame height. The sea cannot end in the air
 * without drawing a line; it has to end *behind something*.
 *
 * So the ground has to break the surface of the sea while still inside it —
 * nearer than 198 units and higher than the topmost layer at y = -2.4. From the
 * eye at (9, 12) the frame's own columns reach that at about z = -115 on the
 * left and z = -140 on the right, so the crest sits at -110 and stands at +4
 * with six or seven units of relief on it. Land, not cloud, decides where the
 * sea ends, and land has a ridgeline.
 */
const SECTION = [
  [-8, -54], [-32, -27], [-56, -21], [-80, -8], [-110, 4], [-146, -10],
  [-192, -24], [-250, -33], [-320, -39], [-400, -46], [-490, -58],
];

/** Where the crest is, and how wide the band around it carries extra relief. */
export const SHORE = { z: -110, halfWidth: 44 };

/**
 * Relief. Eleven units of low-frequency noise over the valley, and half again
 * as much along the crest, biased upward.
 *
 * Both halves of that are load-bearing. The extra amplitude is what makes the
 * crest a *ridgeline* rather than a line: at this depth one world unit is 0.43%
 * of frame height, so a crest that wanders by four units wanders by a dozen
 * pixels and the eye still reads it as ruled. The upward bias is what keeps it
 * honest — the crest has one job, to stand above the height at which the cloud
 * sea's far edge lands, everywhere across the frame, and unbiased noise takes
 * it under that line somewhere. A single segment under it puts the ruled edge
 * straight back into the picture at exactly the place the ridgeline was there
 * to remove.
 */
const RELIEF = { amp: 10, crest: 0.55, freq: 0.0125, bias: 0.36 };

/**
 * The tarn, and the hollow it sits in.
 *
 * It was a river first, and a river is what this valley cannot have. The
 * section climbs the whole way from the eye to the far shore — that is what
 * makes the shore a shore — so a channel cut along it has its downhill bank
 * *below* the water on the near side, and a flat sheet with a bank missing runs
 * out of its own bed and draws a straight edge across the valley: the exact
 * fault this stage exists to remove, reintroduced by the fix for it.
 *
 * A hollow works where a channel does not. It is closed on all four sides by
 * construction, so the one flat plane left in the scene is bounded by ground
 * higher than it everywhere — which `tests/run.js` checks by walking the rim
 * rather than by trusting the section.
 */
export const TARN = {
  x: -130, z: -64, rx: 100, rz: 16,
  bed: -36,
  /** The surface, four units up off the bed. */
  surface: -33,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The section, interpolated smoothly. */
function sectionAt(z) {
  if (z >= SECTION[0][0]) return SECTION[0][1];
  const last = SECTION[SECTION.length - 1];
  if (z <= last[0]) return last[1];
  for (let i = 1; i < SECTION.length; i++) {
    const [z1, y1] = SECTION[i];
    if (z >= z1) {
      const [z0, y0] = SECTION[i - 1];
      return y0 + (y1 - y0) * smooth(z0, z1, z);
    }
  }
  return last[1];
}

/**
 * The ground at (x, z).
 *
 * `noise` is a field from `makeNoise3`; pass the same one for every sample or
 * the surface will not be continuous. `terrainField()` below hands out the one
 * this build uses.
 */
export function terrainHeight(x, z, noise) {
  const base = sectionAt(z);
  // Held steadier along the crest, and pushed up rather than centred: see
  // RELIEF above for why that is not a taste decision.
  const onCrest = 1 - smooth(0, SHORE.halfWidth, Math.abs(z - SHORE.z));
  const amp = RELIEF.amp * (1 + RELIEF.crest * onCrest);
  const n = fbm3(noise, x, 0, z, { freq: RELIEF.freq, octaves: 4, gain: 0.62 });
  let y = base + (n - RELIEF.bias) * amp;

  // The tarn's hollow, cut into whatever is there. Blended rather than
  // subtracted, so the ground falls into it instead of ending on a step.
  const dx = (x - TARN.x) / TARN.rx;
  const dz = (z - TARN.z) / TARN.rz;
  const inTarn = 1 - smooth(0, 1, Math.min(1, Math.hypot(dx, dz)));
  y += (TARN.bed - y) * inTarn;

  return y;
}

/** The one field this build's ground is made of. */
export function terrainField() {
  return makeNoise3(TERRAIN.seed);
}

/**
 * The crest line, sampled: the height of the highest ground within the shore
 * band, at a given x.
 *
 * This is what the suite measures the ridgeline with — both that it varies (a
 * ridgeline, not a rule) and that it never drops below the height the cloud
 * sea's far edge is seen at.
 */
export function crestAt(x, noise) {
  let best = -Infinity;
  for (let z = SHORE.z - SHORE.halfWidth; z <= SHORE.z + SHORE.halfWidth; z += 6) {
    const y = terrainHeight(x, z, noise);
    if (y > best) best = y;
  }
  return best;
}
