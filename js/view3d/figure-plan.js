// The cultivator's garment, as a plan.
//
// ---------------------------------------------------------------------------
// Why there is a plan file for a figure who is 13% of the frame tall
//
// Because at 13% of the frame she is a *silhouette*, and a silhouette is
// arithmetic before it is modelling. Up to stage 5 she was one `LatheGeometry`
// from hem to collar with two tori round it — which is to say a cone, and a
// cone is what the eye names her. Nothing about that reads as cloth, as a robe,
// or as a person from anywhere in particular; it reads as an object left on the
// rock.
//
// Everything in this file exists to answer one of three questions with a number
// rather than a feeling:
//
//   is it there at all?     the crossed collar, the pleats, the cuffs, the sash
//                           tails. Each one is a measurable fact about the plan.
//   can it be seen?         every feature is checked against the locked camera
//                           in `tests/run.js` — how many CSS pixels wide the
//                           collar band is on a 414×896 phone, whether the
//                           cuffs clear the body's own outline from all four QA
//                           cameras, how far the sash tails stand off the skirt.
//   is she a person?        `asymmetryScore()`. Perfect bilateral symmetry is
//                           most of why she read as an object, so the pose is
//                           authored asymmetric and the asymmetry is asserted.
//
// Pure and Three-free, like the other `*-plan` modules, so all of it runs in
// Node.
//
// ---------------------------------------------------------------------------
// The island was seated and this file follows it
//
// `SEAT` is the single most load-bearing number here and it is *measured*, not
// chosen. The composition contract puts her feet at y = 0 and calls her 1.71
// tall — but the rock under her does not top out at zero. `slabGeometry` builds
// an `ExtrudeGeometry` with `bevelEnabled`, and three adds the bevel *outside*
// the extrusion, so a slab's top cap sits a full `bevelThickness` above the
// y = 0 its own documentation claims. Measured off the built geometry:
//
//   the platform's top face under the figure    y = +0.36
//   the meditation stone's top face             y = +0.42
//
// So the bottom quarter of her is inside the rock — as are the censer, the
// plum's root stubs and the standing rocks, all placed at "y = 0, the top of
// the platform". That is a stage-5 defect and fixing it means lowering the
// whole foreground island, which moves the platform rim, the treads that notch
// the skyline and every composition number stage 5 was gated on. It is not a
// change to make quietly inside a stage about clothes.
//
// What this stage does instead is **compose the garment against the surface she
// actually sits on**: the hem lands on the stone at y ≈ 0.455 and pools, and no
// authored feature — trim band, pleat, cuff, tail — is placed below it where
// the rock would eat it. She reads 10.2% of frame height rather than the
// contract's 13.5% until the island is fixed, and that is the one number in
// this build that is knowingly wrong.

import { mulberry32 } from '../rng.js';
import { SEAT as ROCK_SEAT } from './platform-plan.js';

/* ------------------------------------------------------------- the anchors */

/**
 * Where she sits, and the heights everything else is hung off. World units,
 * with the avatar group at the origin, so these are also world y.
 */
export const SEAT = ROCK_SEAT;

export const FIGURE = {
  seat: SEAT,
  /** Hem line, before the per-pleat wobble below. It rests on the stone. */
  hem: 0.035,
  /** Under the sash: where the lower robe ends and the upper robe takes over. */
  waist: 0.782,
  /** The shoulder line, and the top of the upper robe. */
  shoulder: 1.11,
  collar: 1.16,
  neck: 1.20,
  head: 1.38,
  /** Feet to the top of the topknot — the composition contract's own number. */
  crown: 1.71,
};

/**
 * The garment as a solid of revolution: mean radius against height, hem to
 * collar. The lower robe and the upper robe are separate meshes and this is
 * what makes them agree about the waist — both lathe this table, one from the
 * hem to 0.80 and the other from 0.76 up, so they overlap under the sash and
 * cannot open a seam.
 *
 * It is also what the collar panels and the sash tails are wrapped onto, so a
 * panel is on the body by construction rather than by a radius typed twice.
 */
const RINGS = [
  [0.035, 0.648], [0.130, 0.622], [0.240, 0.596], [0.350, 0.575],
  [0.455, 0.556], [0.520, 0.545], [0.610, 0.516], [0.700, 0.472],

/** The mean radius of the garment at a height. Clamped past either end. */
export function bodyRadius(y) {
  if (y <= RINGS[0][0]) return RINGS[0][1];
  const last = RINGS[RINGS.length - 1];
  if (y >= last[0]) return last[1];
  for (let i = 1; i < RINGS.length; i++) {
    const [y0, r0] = RINGS[i - 1];
    const [y1, r1] = RINGS[i];
    if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  }
  return last[1];
}

/** The rings of the lower robe, hem to a little past the waist. */
export function skirtRings() {
  return RINGS.filter(([y]) => y <= 0.80).map(([y, r]) => [y, r]);
}

/**
 * The rings of the upper robe, from under the sash to the neck.
 *
 * The first two are the overlap: the 袍 laps *over* the 裳 by seven centimetres
 * and stands a centimetre proud of it, so the two lathes cannot z-fight along a
 * shared ring and the seam reads as one garment over another rather than as a
 * join.
 */
export function robeRings() {
  return [
    [0.712, bodyRadius(0.712) + 0.014],
    [0.782, bodyRadius(0.782) + 0.010],
    ...RINGS.filter(([y]) => y > 0.782).map(([y, r]) => [y, r]),
  ];
}

/* ------------------------------------------------------------- 裳 the skirt */

/**
 * The pleats, and why there are exactly this many of them.
 *
 * A pleated skirt is the cheapest cloth cue there is, and it is cheap because
 * it is *lighting*: a ridge and a valley alternating around the body means
 * every second facet turns toward the key and every other one away, so the
 * skirt has a dozen tonal steps across it under a single light and reads as
 * fabric with weight instead of as a moulded shell.
 *
 * The count is bounded from both ends by the camera rather than by taste. The
 * hem is 1.10 units across and a world unit is 70.6 CSS pixels at the hero
 * framing, so the visible front of the skirt is about 77 px wide, crossed by
 * half the pleats. At 12 that is ~13 px from ridge to ridge; at 20 it would be
 * 8 px and land under the resolution of a phone held at arm's length, where a
 * fluted surface stops being pleats and becomes noise. `tests/run.js` asserts
 * the on-screen spacing rather than the count, because the count is only ever a
 * proxy for it.
 *
 * The alternation is strict — `2 × count` segments, ridge, valley, ridge — so
 * every facet of the lathe is a plane between one of each. The jitter is
 * small on purpose: pleats are made by a person folding cloth and *should*
 * repeat, which is the exact opposite of the rule the platform outline lives
 * under. What may not repeat is the hem, below.
 */
export const PLEATS = {
  count: 12,
  /** Valley radius as a fraction of the ridge's. 0.86 ≈ 8 cm of fold. */
  valley: 0.86,
  /** Per-pleat variation, so no two folds are identical twins. */
  jitter: 0.035,
  /** How far the hem wanders either side of `FIGURE.hem`. */
  hemWobble: 0.062,
  /** The contrasting band at the hem, and how far it stands proud. */
  trim: { height: 0.078, lift: 0.014 },
};

/**
 * The per-segment table the skirt is lathed from: `2 × count` entries, each
 * one a radial multiplier and a hem height.
 *
 * Seeded and evaluated once, so the same figure is built in the renderer and in
 * the test suite and neither can drift from the other.
 */
function pleatTable() {
  const n = PLEATS.count * 2;
  const rand = mulberry32(6081);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ridge = i % 2 === 0;
    const jit = (rand() - 0.5) * 2 * PLEATS.jitter;
    out.push({
      angle: (i / n) * Math.PI * 2,
      /** Ridge or valley, with a little variation on the ridge radius. */
      scale: (ridge ? 1 : PLEATS.valley) * (1 + jit),
      ridge,
      /** Filled in below: the hem's own, deliberately un-periodic wander. */
      hem: 0,
    });
  }

  // The hem is the one part of the skirt that may not repeat. A level hem is a
  // machined edge and reads as the bottom of a lampshade; a hem that wanders
  // reads as cloth that has been sat down in. The wander is drawn from three
  // waves whose periods do not divide the segment count and do not divide each
  // other, so the edge never comes back into phase with the pleats — if it did,
  // the eye would find the repeat and the whole skirt would go back to being a
  // solid of revolution with grooves in it.
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const w = (Math.sin(t * 1 + 0.7) * 0.55
      + Math.sin(t * 2.6 + 2.1) * 0.31
      + Math.sin(t * 4.3 + 4.4) * 0.19);
    out[i].hem = FIGURE.hem + w * PLEATS.hemWobble;
  }
  return out;
}

const PLEAT_TABLE = pleatTable();

/** The skirt's segment table: `{ angle, scale, ridge, hem }`, hem to hem. */
export function pleatSegments() {
  return PLEAT_TABLE.map((s) => ({ ...s }));
}

/** The hem line as `[x, y, z]` points — the irregular bottom edge, in world. */
export function hemOutline() {
  return PLEAT_TABLE.map((s) => {
    const r = bodyRadius(s.hem) * s.scale;
    return [Math.sin(s.angle) * r, s.hem, Math.cos(s.angle) * r];
  });
}

/* ------------------------------------------------ 交领右衽 the crossed collar */

/**
 * The one element that decides what she is.
 *
 * A cone with a light V on its front is a robe; the same cone without it is a
 * bell, a chess piece or a lampshade. 交领右衽 — crossed collar, closing to the
 * right — is the single most specific thing in the whole figure and it costs
 * three quads: the wearer's left panel laps *over* the right one, which is what
 * "右衽" means and is the difference between a Chinese robe and a bathrobe. It
 * is also the difference between a figure and a silhouette, at any distance
 * where the face is not modelled — which, at this poly budget, is every
 * distance.
 *
 * Authored as a drawing on the front of the chest: each panel is a centre-line
 * in (x, y), and `collarPanels()` below wraps it onto the body's own radius, so
 * a panel cannot float off the torso or sink into it however the profile is
 * retuned. `lift` is the radial standoff and it is the layering: left 0.026
 * over right 0.017 over the inner robe's 0.010, all of them clear of the robe
 * surface, so the crossing renders in the right order from every camera without
 * a single `renderOrder` or `polygonOffset`.
 *
 * `width` is a *frame* number in disguise. 0.105 world units is 7.4 CSS px on a
 * 414-px-wide phone at the hero framing and 19 px at the QA close camera; below
 * about 5 px a light band on a dark robe stops being a shape and becomes an
 * edge artefact. The suite measures it rather than trusting it.
 */
export const COLLAR = {
  width: 0.092,
  innerWidth: 0.048,
  panels: [
    // The wearer's right panel, underneath. It runs from the right of the neck
    // down across the sternum and vanishes under the left one.
    {
      id: 'right', lift: 0.017, width: 0.092, tone: 'trim',
      line: [[-0.108, 1.152], [-0.046, 1.052], [0.020, 0.960], [0.092, 0.900]],
    },
    // The wearer's left panel, on top: 右衽, closing to her right. Its lower
    // end runs past the centre line and tucks under the sash.
    {
      id: 'left', lift: 0.026, width: 0.092, tone: 'trim',
      line: [[0.112, 1.150], [0.046, 1.042], [-0.030, 0.940], [-0.104, 0.872]],
    },
    // 中衣 — the inner robe, a narrower and paler V peeking above the outer
    // collar. Two tones instead of one is what stops the crossing reading as a
    // single painted stripe.
    {
      id: 'inner', lift: 0.010, width: 0.048, tone: 'inner',
      line: [[0.076, 1.180], [0.026, 1.120], [-0.024, 1.074], [-0.072, 1.040]],
    },
  ],
};

/**
 * A collar panel as a strip of world-space quads: `[[outer, inner], …]`, one
 * pair per point on the centre-line.
 *
 * The offset is perpendicular to the line *in the (x, y) drawing*, then both
 * edges are wrapped onto the body — so the band keeps its width where the V
 * turns and does not pinch at the corner.
 */
export function collarPanels() {
  return COLLAR.panels.map((panel) => {
    const pts = panel.line;
    const rows = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      // Normal in the drawing plane, pointing up-and-outward along the V.
      const nx = -dy / len;
      const ny = dx / len;
      const h = panel.width / 2;
      return [
        wrapToBody(p[0] + nx * h, p[1] + ny * h, panel.lift),
        wrapToBody(p[0] - nx * h, p[1] - ny * h, panel.lift),
      ];
    });
    return { id: panel.id, tone: panel.tone, lift: panel.lift, rows };
  });
}

/**
 * A point drawn on the front of the chest, wrapped onto the garment.
 *
 * `x` is where it sits across the body and `y` how far up; the result is on the
 * cylinder of radius `bodyRadius(y) + lift`, on the +z side, which is the side
 * she faces. Past the tangent the wrap is clamped, so a panel that overshoots
 * the body's width lies along its edge instead of turning inside out.
 */
export function wrapToBody(x, y, lift = 0) {
  const r = bodyRadius(y) + lift;
  const k = Math.max(-0.94, Math.min(0.94, x / Math.max(1e-4, bodyRadius(y))));
  return [k * r, y, Math.sqrt(Math.max(0, r * r - (k * r) * (k * r)))];
}

/* --------------------------------------------------------- 广袖 arms, sleeves */

/**
 * Arms, and the sleeves that are most of what anybody sees of them.
 *
 * Before this stage the arms were two capsules at x = ±0.29 with a radius of
 * 0.10, inside a robe whose radius at the same height was 0.46 — so they were
 * not hidden by the sleeves, they were *inside the body*, and the figure had no
 * arms at all in any shipped frame. The forms below are outside the garment by
 * construction and the suite checks it.
 *
 * The cuff is the point. 广袖 is a sleeve with a mouth wider than the arm and a
 * fall well below the hand, and that mass is one of the three or four shapes
 * that say wuxia on sight — the others being the collar above and the sash
 * below. It is authored as a flared tube from the upper arm down past the hand
 * to a mouth just above the seat, so the figure's outline is broken twice on
 * each side: once where the sleeve leaves the shoulder and once where it hangs
 * clear of the skirt.
 *
 * The two sides are deliberately different — see POSE. The left hangs lower and
 * further out, because the left shoulder is the low one.
 */
export const ARMS = [
  {
    side: 'left',
    shoulder: [0.272, 1.058, 0.020], elbow: [0.336, 0.876, 0.098], wrist: [0.152, 0.706, 0.428],
    upper: [0.106, 0.090], fore: [0.084, 0.070],
    /**
     * The sleeve, as horizontal rings: `[y, centre x, centre z, radius]`, top
     * to mouth. Horizontal is the load-bearing word — cloth hangs under gravity
     * whatever the arm inside it is doing, and a tube swept along a slanted
     * axis has a slanted mouth, which at this scale dipped the far lip of the
     * cuff thirteen centimetres into the rock she is sitting on.
     */
    sleeve: {
      rings: [
        [0.930, 0.290, 0.048, 0.132], [0.812, 0.396, 0.086, 0.168],
        [0.686, 0.478, 0.106, 0.196], [0.582, 0.524, 0.112, 0.212],
        [0.505, 0.540, 0.110, 0.220],
      ],
    },
    hand: { at: [0.076, 0.694, 0.508], r: 0.060, tilt: 0.22 },
  },
  {
    side: 'right',
    shoulder: [-0.268, 1.089, 0.014], elbow: [-0.326, 0.906, 0.086], wrist: [-0.144, 0.716, 0.408],
    upper: [0.102, 0.086], fore: [0.080, 0.067],
    // Hers is the high shoulder, and this sleeve fell to her side instead of
    // draping forward over the lap. Same garment, different accident.
    sleeve: {
      rings: [
        [0.940, -0.288, 0.036, 0.128], [0.820, -0.386, 0.026, 0.162],
        [0.690, -0.470, 0.018, 0.188], [0.570, -0.522, 0.014, 0.204],
        [0.478, -0.542, 0.012, 0.210],
      ],
    },
    hand: { at: [-0.038, 0.664, 0.522], r: 0.055, tilt: -0.10 },
  },
];

/**
 * The shoulder line's drop, in degrees, measured off ARMS rather than declared.
 *
 * `POSE.shoulderDropDeg` is the intention and this is what was built; the suite
 * holds the two together, so the pose cannot be documented as three degrees and
 * modelled as none.
 */
export function shoulderDropDeg() {
  const [left, right] = ARMS;
  const run = Math.hypot(left.shoulder[0] - right.shoulder[0], left.shoulder[2] - right.shoulder[2]);
  return (Math.atan2(right.shoulder[1] - left.shoulder[1], run) * 180) / Math.PI;
}

/** The trim band round each sleeve mouth, matching the hem's. */
export const SLEEVE_TRIM = { height: 0.070, lift: 0.012, roll: 0.052 };

/**
 * Each sleeve mouth as a centre and a radius — what the silhouette gate is
 * measured on, and what stage 8 will swing.
 */
export function cuffs() {
  return ARMS.map((arm) => {
    const [y, cx, cz, r] = arm.sleeve.rings[arm.sleeve.rings.length - 1];
    return { side: arm.side, at: [cx, y, cz], r };
  });
}

/** How far each cuff hangs below the hand it is meant to be swallowing. */
export function cuffDrop() {
  return ARMS.map((arm) => {
    const [y] = arm.sleeve.rings[arm.sleeve.rings.length - 1];
    return { side: arm.side, drop: arm.hand.at[1] - y };
  });
}

/* ------------------------------------------------------------- 腰带 the sash */

/**
 * Two bands, a knot off to the front-left, and two tails hanging down the
 * skirt.
 *
 * The bands were already here and they were the only thing breaking the cone,
 * which is why they are kept. What they were not was a *sash*: a belt with no
 * ends is a hoop, and the knot and the tails are what turn a hoop into
 * something somebody tied. They are also the only element on the figure with a
 * free end, which is what stage 8 will have to move.
 *
 * The tails hang against the flare of the skirt rather than out in the air,
 * because the skirt widens faster than a ribbon falls — a tail that kept 8 cm
 * of daylight all the way down would have to fly outward at forty degrees, and
 * a sash tail doing that reads as a streamer in a wind that is not blowing.
 * They stand off by `standoff` instead and the last segment kicks out, so the
 * tip is clear of the cloth behind it; the separation the gate asks for is
 * carried by the standoff, by the trim tone against the robe, and by the tip.
 */
export const SASH = {
  bands: [
    { y: 0.782, tube: 0.034, lift: 0.012 },
    { y: 0.856, tube: 0.030, lift: 0.010 },
  ],
  /** Front-left, at bearing ~33° off the way she faces. */
  knot: { at: [0.386, 0.818, 0.278], size: [0.098, 0.084, 0.062], tilt: 0.92 },
  /** How far a tail stands off the skirt surface at every sample. */
  standoff: 0.052,
  /**
   * The tails, as (bearing, y) pairs: the radius is the skirt's own plus the
   * standoff, so a tail cannot end up inside the cloth however the profile is
   * retuned. Different lengths and different widths — this is a knot, not a
   * pair of ribbons on a maypole.
   */
  tails: [
    { width: 0.082, bearings: [[0.985, 0.792], [1.022, 0.706], [1.052, 0.636], [1.108, 0.590]] },
    { width: 0.062, bearings: [[0.872, 0.788], [0.890, 0.700], [0.882, 0.628], [0.846, 0.566]] },
  ],
};

/**
 * A sash tail as a chain of world-space points, standing off the skirt.
 *
 * The last point kicks a little further out — a ribbon end lifts away from what
 * it has been lying against, and it is the one place along the tail where the
 * eye can see daylight.
 */
export function sashTails() {
  return SASH.tails.map((tail) => ({
    width: tail.width,
    points: tail.bearings.map(([bearing, y], i, all) => {
      const kick = i === all.length - 1 ? 0.036 : 0;
      const r = bodyRadius(y) + SASH.standoff + kick;
      return [Math.sin(bearing) * r, y, Math.cos(bearing) * r];
    }),
  }));
}

/* ---------------------------------------------------------------- the pose */

/**
 * The asymmetry, written down.
 *
 * A figure with a perfect mirror plane is read by the eye as manufactured — it
 * is the same signal a regular polygon sends, and stage 5 spent a whole file on
 * that for the platform. Three degrees of shoulder drop and a couple of degrees
 * of head tilt cost nothing and are most of the difference between a person
 * sitting still and a moulded ornament of one.
 *
 * Every number here has a partner in ARMS and SASH: the low shoulder is the
 * left, so the left sleeve hangs lower and further out, the hands rest one in
 * front of the other rather than side by side, and the knot is off-centre to
 * the same side. `asymmetryScore()` below is the gate, and it is measured over
 * the whole assembled figure rather than over this list — a pose is only
 * asymmetric if the *parts* end up asymmetric.
 */
export const POSE = {
  /** She faces +z; a few degrees toward the lens opens the collar V. */
  bodyYaw: 0.095,
  /** Degrees of roll on the shoulder line. Left shoulder low. */
  shoulderDropDeg: 3.2,
  /** The head, which does not follow the shoulders. */
  headTiltDeg: 3.4,
  headTurnDeg: -5.6,
  headNodDeg: 2.2,
};

/**
 * Everything the figure is made of, as centres and sizes — the list the
 * asymmetry is measured over.
 *
 * Only parts that have a left and a right to get wrong are in it. The lathed
 * garment is a solid of revolution and cannot be asymmetric, so including it
 * would only dilute the score.
 */
export function figureParts() {
  const parts = [];
  for (const arm of ARMS) {
    parts.push({ id: `${arm.side}-shoulder`, at: arm.shoulder, r: arm.upper[0] });
    parts.push({ id: `${arm.side}-elbow`, at: arm.elbow, r: arm.upper[1] });
    parts.push({ id: `${arm.side}-wrist`, at: arm.wrist, r: arm.fore[1] });
    parts.push({ id: `${arm.side}-hand`, at: arm.hand.at, r: arm.hand.r });
    arm.sleeve.rings.forEach(([y, cx, cz, r], i) => {
      parts.push({ id: `${arm.side}-sleeve-${i}`, at: [cx, y, cz], r });
    });
  }
  parts.push({ id: 'knot', at: SASH.knot.at, r: SASH.knot.size[0] });
  sashTails().forEach((tail, i) => {
    parts.push({ id: `tail-${i}`, at: tail.points[tail.points.length - 1], r: tail.width / 2 });
  });
  return parts;
}

/**
 * How far the figure is from its own mirror image, as a fraction of her visible
 * height. A perfectly bilateral figure scores 0.
 *
 * Every part is reflected through x = 0 and matched to the nearest part of the
 * original set — position and size together, so a left cuff that is merely a
 * fatter version of the right one still counts as a difference. The score is
 * the *mean* rather than the worst case, because one wildly placed hand should
 * not be able to certify a figure that is otherwise a mirror of itself.
 */
export function asymmetryScore(parts = figureParts()) {
  const height = FIGURE.crown - FIGURE.seat;
  let sum = 0;
  for (const p of parts) {
    const mirrored = [-p.at[0], p.at[1], p.at[2]];
    let best = Infinity;
    for (const q of parts) {
      const d = Math.hypot(mirrored[0] - q.at[0], mirrored[1] - q.at[1], mirrored[2] - q.at[2])
        + Math.abs(p.r - q.r);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / parts.length / height;
}

/* ======================================================================== */
/*  Stage 7 — the head, the two marks that are her face, and the sword       */
/* ======================================================================== */

/**
 * The head, in **head-local** coordinates: the origin is the head's own centre
 * at `FIGURE.head`, so the whole assembly can be tilted as one and every number
 * here stays readable. Nothing in this block is authored against world y.
 *
 * The topknot was already here and stays; what it lacked was a reason to be a
 * knot rather than a ball, which is what the 冠 band at its base is — a wrap of
 * cloth in the trim tone, the one line that says the hair has been *dressed*.
 *
 * The strands are the other half of the same idea. A sphere with a smaller
 * sphere on top is a silhouette with no information in it: four loose locks at
 * the temples and the nape cost sixty triangles and break the outline in four
 * places, which is where the eye looks for whether something is alive.
 */
export const HEAD = {
  radius: 0.205,
  scale: [0.92, 1.06, 0.94],
  /**
   * Not a modelled jaw — a taper. Below the equator the section narrows and
   * lifts, so the profile goes from circle to a soft wedge and the chin has a
   * plane the key light can find. A modelled jaw at this size is a lump.
   */
  jaw: { taper: 0.26, lift: 0.055 },
  cap: { radius: 0.213, lift: 0.015, theta: 0.40 },
  knot: { at: [0, 0.222, -0.012], radius: 0.085, scale: [1, 1.25, 1] },
  /** 冠 — the cloth wrap round the base of the knot. */
  band: { at: [0, 0.150, -0.006], radius: 0.094, tube: 0.027, tilt: 0.10 },
  /**
   * 簪 — the hairpin, and the one thing on her in a material of its own.
   *
   * Pale jade against black hair is a value step of about five to one, which is
   * why it is the piece that reads at this size when nothing else on the head
   * does. It is also the only part of the figure with a specular lobe worth the
   * name (roughness 0.25) and a small emissive lift, so it is the one thing on
   * her that crosses the composer's bloom threshold and sparkles.
   */
  pin: { at: [0, 0.216, -0.006], length: 0.345, radius: 0.0125, tilt: Math.PI / 2.5, bead: 0.027 },
  /** Loose locks: two at the temples, two at the nape. Four different lengths. */
  strands: [
    { width: 0.040, points: [[0.158, 0.052, 0.098], [0.178, -0.030, 0.116], [0.184, -0.118, 0.122]] },
    { width: 0.034, points: [[-0.152, 0.064, 0.110], [-0.166, -0.042, 0.116], [-0.172, -0.146, 0.118]] },
    { width: 0.046, points: [[0.062, -0.018, -0.184], [0.074, -0.138, -0.196], [0.082, -0.262, -0.192]] },
    { width: 0.036, points: [[-0.086, 0.004, -0.176], [-0.096, -0.108, -0.188], [-0.102, -0.216, -0.184]] },
  ],
};

/**
 * The face, and the argument for not having one.
 *
 * Two dark marks. No mouth, no nose, no brow. At 13% of frame height her whole
 * head is about twenty-five pixels tall, and a modelled face at twenty-five
 * pixels is not a face — it is four dark smudges that the eye keeps trying to
 * resolve and cannot, which is precisely the uncanny read. Journey and Sky both
 * carry entire casts of characters on exactly this: a shape, a silhouette, and
 * two marks where the eyes go. The player supplies the rest, and what they
 * supply is always calmer than anything that could be modelled here.
 *
 * The two marks are not the same size or at the same height, for the same
 * reason nothing else on this figure is mirrored.
 */
export const FACE = {
  eyes: [
    { at: [0.074, 0.014, 0.178], radius: 0.030, scale: [1.0, 0.56, 0.5] },
    { at: [-0.069, 0.006, 0.180], radius: 0.028, scale: [1.0, 0.60, 0.5] },
  ],
};

/**
 * 剑 — a jian, planted in the rock at her right hand.
 *
 * The highest-signal object available for this setting: a straight
 * double-edged sword in a scabbard says *wuxia* faster than anything else that
 * can be built out of six primitives, and it does a second job the character
 * cannot do for herself. She is a seated triangle, wider than she is tall; the
 * sword is a hard vertical a third of a frame-height long, standing right
 * beside her. A composition of one mound gets an axis.
 *
 * Planted rather than laid across her lap for three reasons: her lap is under
 * two wide sleeves and a sash by the time stage 6 is done, a sword laid in it
 * would be four visible pixels of guard, and a vertical against the sea of
 * cloud is the only version of it that survives being 13% of the frame.
 *
 * Placement is measured, not chosen. At the hero framing it lands at u 0.27
 * with the figure's own outline reaching u 0.33 — a clear gap of nineteen CSS
 * pixels, so the two never merge into one shape — and its head sits at v 0.50,
 * just under the horizon at 0.45 and just under her crown at 0.475, so it reads
 * against the bright cloud and does not compete with her. The tip is at y 0.30,
 * twelve centimetres inside a stone whose top face is at 0.42: it is *in* the
 * rock, not standing on it.
 *
 * Everything below is a fraction along the axis from tip to head, so the whole
 * sword can be moved or re-scaled by moving the two ends.
 */
export const JIAN = {
  tip: [1.10, -0.12, 0.22],
  head: [1.19, 1.00, 0.10],
  /** 鞘 — the scabbard, widening a little toward its mouth. */
  scabbard: { to: 0.700, r: [0.040, 0.058] },
  /** 珌 and 口 — the fittings at either end of it. */
  chape: { span: [0.010, 0.080], r: 0.065 },
  throat: { span: [0.630, 0.700], r: 0.067 },
  /** 镡 — the guard: flattened across the blade, not a disc. */
  guard: { at: 0.722, size: [0.128, 0.026, 0.058] },
  /**
   * 柄 — the grip, and the cord wrapped round it.
   *
   * Six rings alternating proud and slack. It is the same trick as the pleats
   * one scale down: at six CSS pixels wide a smooth cylinder and a wrapped one
   * differ by nothing at all, but a *ribbed* one catches the key light six
   * times and reads as bound cord.
   */
  grip: { span: [0.735, 0.945], r: 0.038, cords: 6, cord: 0.010 },
  /** 首 — the pommel the tassel hangs from. */
  pommel: { span: [0.945, 1.0], r: 0.056 },
  /**
   * 剑穗 — the tassel.
   *
   * The one thing in the frame that has no reason to be still, which is exactly
   * why it is here: stage 8 gets a free piece of motion at the far end of a
   * fixed object, and motion at the end of something rigid reads as air moving
   * rather than as an animation playing.
   */
  tassel: {
    cord: { points: [[1.206, 0.984, 0.136], [1.232, 0.900, 0.186], [1.248, 0.822, 0.216]], width: 0.020 },
    bundle: { at: [1.250, 0.816, 0.220], length: 0.208, strands: 5, spread: 0.040, r: 0.016 },
  },
};

/**
 * The material table, as data rather than as five numbers scattered through the
 * builder.
 *
 * Roughness is the interesting column and it is *spent*, not stored: the ink
 * material grew a Blinn lobe in stage 7 so these mean something (see
 * `specularFrom` in shaders.js). The mapping is steep — everything at 0.85 and
 * above contributes essentially nothing — so the robe and the skin keep the
 * flat ink look the whole renderer is built on, and the three glossy things
 * are the ones that were meant to be glossy.
 *
 * `accent` and `accentGlow` are the art rule, not a look. The accent is the
 * player's own qi, and stage 7's discipline gives it to exactly four things:
 * the sash trim, the hairpin, the qi effects and the particles. Nothing else
 * on this figure and nothing at all in the landscape may carry it, which is
 * asserted rather than remembered.
 */
export const SURFACES = {
  robe: { roughness: 0.85 },
  trim: { roughness: 0.40, accent: 1, accentGlow: 0.05 },
  inner: { roughness: 0.45 },
  hair: { roughness: 0.60 },
  skin: { roughness: 0.90 },
  pin: { roughness: 0.25, emissive: 0.55, accent: 1, accentGlow: 0.12, color: '#d8e8d6' },
  eye: { roughness: 0.9, color: '#14171c' },
  lacquer: { roughness: 0.55, color: '#20242c' },
  cord: { roughness: 0.7, color: '#5c4a44' },
  tassel: { roughness: 0.5, color: '#a8564c' },
};

/** A point on the jian's axis, at a fraction from tip to head. */
export function jianAt(t) {
  return [
    JIAN.tip[0] + (JIAN.head[0] - JIAN.tip[0]) * t,
    JIAN.tip[1] + (JIAN.head[1] - JIAN.tip[1]) * t,
    JIAN.tip[2] + (JIAN.head[2] - JIAN.tip[2]) * t,
  ];
}

/** How long the sword is, tip to pommel. */
export function jianLength() {
  return Math.hypot(
    JIAN.head[0] - JIAN.tip[0], JIAN.head[1] - JIAN.tip[1], JIAN.head[2] - JIAN.tip[2],
  );
}

/** The tassel's hanging strands, as world-space segments. */
export function tasselStrands() {
  const { bundle } = JIAN.tassel;
  return Array.from({ length: bundle.strands }, (_, i) => {
    const a = (i / bundle.strands) * Math.PI * 2;
    const sx = Math.sin(a) * bundle.spread;
    const sz = Math.cos(a) * bundle.spread;
    // Each one a different length, so the bundle ends in a ragged line rather
    // than a machined one.
    const len = bundle.length * (0.78 + ((i * 7) % 5) / 5 * 0.28);
    return {
      from: [bundle.at[0] + sx * 0.35, bundle.at[1], bundle.at[2] + sz * 0.35],
      to: [bundle.at[0] + sx, bundle.at[1] - len, bundle.at[2] + sz],
      r: bundle.r * (0.7 + ((i * 3) % 4) / 4 * 0.5),
    };
  });
}
