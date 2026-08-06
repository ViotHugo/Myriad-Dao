// 梅 — the plum, as a plan.
//
// ---------------------------------------------------------------------------
// What was here before, and why it had to go
//
// The foreground tree was a recursive branch function: grow a segment, throw
// two or three children off it at a randomised angle, recurse five deep. That
// is a perfectly good *deciduous* tree — and that is precisely the problem. A
// self-similar fan of thinning twigs with a floor of blossom on it is an oak in
// February. It read as Northern European winter in a picture whose entire
// subject is a Chinese mountain, and no amount of pink at the ends was going to
// fix a silhouette that was already saying something else.
//
// Plum is not a fractal. It is a chain of decisions:
//
//   the trunk    four to six short tapered lengths with a **hard angular change
//                of direction at every joint**. Old plum wood does not curve —
//                it turns, stops, and turns again, and the joints are where the
//                character is. A smooth arc, however gnarled its texture, is a
//                willow.
//   the branches three or four mains, each with two or three subs, and nothing
//                below that. Thinning aggressively: a plum branch is a third of
//                its parent within one joint, which is why the ends read as
//                *twigs* against the sky rather than as a fan.
//   the blossom  clustered at the tips, in bunches, never spread along the
//                wood. 梅 flowers on bare branches — the flowers *are* the
//                foliage, and they arrive in knots.
//
// So the shape is authored rather than generated. The tables below are the
// drawing; the seeded random only jitters what is already decided, which is the
// difference between a tree somebody drew and a tree a function emitted.
//
// ---------------------------------------------------------------------------
// The framing branch
//
// The second export is not a tree. It is a *device*: a large near-black branch
// entering from the top-right corner, mostly out of frame, of the kind that
// opens half the surviving Song landscapes. It does more for the depth of this
// picture than anything else in the stage, and the reason is worth stating —
// the frame gets an object it can see is *in front of everything*, at a depth
// the eye can name, and every other plane in the picture is then read against
// it. A range of mountains with nothing between it and the viewer has no scale
// but its own.
//
// It is authored in **world coordinates**, unlike the tree, because where it
// lands in the *frame* is the whole point and the camera is locked. Its target
// is the top-right fifth of the picture; `tests/run.js` projects every segment
// through framing.js and holds it to that.
//
// Pure and Three-free, like the other `*-plan` modules.

import { mulberry32 } from '../rng.js';
import { placeAtDepth } from './framing.js';

/* ------------------------------------------------------------ tiny vectors */

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** The angle between two directions, in radians. Used by the tests as well. */
export function turnBetween(a, b) {
  const p = norm(a); const q = norm(b);
  return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
}

/* ------------------------------------------------------------------ the tree */

/**
 * Where the tree is planted.
 *
 * On the platform's back-left shoulder, at radius 9.2 against an outline that
 * reaches 9.97 on that bearing — inside the bevelled lip, so the roots sit on
 * rock rather than over the edge. It used to stand on a crag of its own out at
 * z = −16, sixteen units back and *below the rim*, which meant the platform
 * occluded its whole trunk and what the player saw was a scribble of twigs
 * floating over the drop with nothing holding it up.
 *
 * `tilt` and `lean` throw it out over the fall, which is what an old plum on a
 * cliff shoulder does and what puts its crown clear of the range behind it.
 */
export const PLUM = {
  at: [-6.90, -0.05, -6.40],
  yaw: 2.20,
  tilt: 0.10,
  lean: 0.20,
  scale: 1.26,
};

/**
 * The trunk: five lengths, and a hard turn at each of the four joints.
 *
 * Every consecutive pair here is 40°–55° apart. That is a lot — it is meant to
 * be. Under fifteen degrees the chain reads as one slightly bent pole, and the
 * segment boundaries become a subdivision artefact instead of the point of the
 * shape.
 *
 * The horizontal components very nearly cancel (−0.28 over 5.4 of height), so
 * the tree zigzags without walking off its own roots. The lean is applied to
 * the whole tree by whoever plants it, not baked in here.
 */
const TRUNK = [
  { dir: [0.20, 1.00, -0.10], len: 1.70, r0: 0.40, r1: 0.31 },
  { dir: [-0.46, 1.00, 0.26], len: 1.35, r0: 0.31, r1: 0.24 },
  { dir: [0.34, 1.00, -0.40], len: 1.15, r0: 0.24, r1: 0.185 },
  { dir: [-0.55, 1.00, 0.06], len: 0.95, r0: 0.185, r1: 0.14 },
  { dir: [0.06, 1.00, -0.44], len: 0.80, r0: 0.14, r1: 0.10 },
];

/**
 * Four mains, one off each trunk joint, thrown well clear of the trunk's own
 * line and of each other's. `subs` is how many sub-branches it carries at full
 * quality; the low tier drops one from each.
 *
 * `joint` indexes the *end* of that trunk segment, so main 0 leaves the tree a
 * third of the way up and main 3 just under the crown.
 */
const MAINS = [
  { joint: 0, dir: [-1.00, 0.34, -0.22], len: 1.95, subs: 3, kink: [0.45, 0.30, 0.62] },
  { joint: 1, dir: [0.86, 0.42, 0.54], len: 1.70, subs: 2, kink: [-0.30, 0.26, -0.70] },
  { joint: 2, dir: [-0.42, 0.40, 0.94], len: 1.55, subs: 3, kink: [0.66, 0.34, -0.28] },
  { joint: 3, dir: [0.74, 0.55, -0.60], len: 1.30, subs: 2, kink: [-0.24, 0.42, 0.58] },
];

/**
 * The plum, in its own space: foot at the origin, growing up +y.
 *
 * Returns flat lists rather than a tree, because both consumers want flat ones:
 * `segments` becomes one instanced draw of a single tapered cylinder, and
 * `tips` is where the blossom clusters go.
 */
export function plumSkeleton({ seed = 77, subs = 3, scale = 1 } = {}) {
  const rand = mulberry32(seed);
  const segments = [];
  const tips = [];
  const joints = [];
  const trunkDirs = [];

  // A hard turn: rotate `dir` toward `toward` by most of the angle between
  // them, then nudge it. Authored turns, jittered — never a random walk.
  const turn = (dir, toward, amount) => norm([
    dir[0] + (toward[0] - dir[0]) * amount + (rand() - 0.5) * 0.10,
    dir[1] + (toward[1] - dir[1]) * amount + (rand() - 0.5) * 0.06,
    dir[2] + (toward[2] - dir[2]) * amount + (rand() - 0.5) * 0.10,
  ]);

  const grow = (from, dir, len, r0, r1) => {
    const d = norm(dir);
    const to = add(from, d, len * scale);
    segments.push({ from, to, r0: r0 * scale, r1: r1 * scale, dir: d });
    return to;
  };

  /* the root flare */
  //
  // Four short fat stubs splaying out of the foot and dipping just under the
  // rock. They cost nothing — the same instanced cylinder as everything else —
  // and they are the difference between a tree growing out of a platform and a
  // pole standing on one. The old tree needed a whole extra crag mesh under it
  // to avoid looking planted in mid-air; this is that draw call, deleted.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6 + (rand() - 0.5) * 0.4;
    const reach = 0.52 + rand() * 0.26;
    grow([0, 0.32, 0], [Math.cos(a), -0.85, Math.sin(a)], reach, 0.26, 0.14);
  }

  /* the trunk */
  let at = [0, 0, 0];
  for (const s of TRUNK) {
    const d = norm(s.dir);
    trunkDirs.push(d);
    joints.push(at);
    at = grow(at, d, s.len, s.r0, s.r1);
  }
  // The crown is a tip too: the trunk ends in blossom, not in a stump.
  tips.push(at);

  /* mains, and the subs off them */
  MAINS.forEach((m, mi) => {
    const base = joints[m.joint + 1] || at;
    // Two lengths with a kink between them, the same rule as the trunk.
    const d0 = norm(m.dir);
    const mid = grow(base, d0, m.len * 0.58, 0.125, 0.090);
    const d1 = turn(d0, norm(m.kink), 0.55);
    const end = grow(mid, d1, m.len * 0.42, 0.090, 0.058);
    tips.push(end);

    const n = Math.max(2, Math.min(m.subs, subs));
    for (let i = 0; i < n; i++) {
      // Subs leave the main at alternating sides, along the length of it.
      const side = i % 2 ? 1 : -1;
      const from = i === 0 ? mid : add(mid, d1, m.len * 0.42 * (i / n));
      const away = norm([
        d1[0] * 0.35 + m.kink[2] * side * 0.9 + (rand() - 0.5) * 0.3,
        d1[1] * 0.30 + 0.62 + (rand() - 0.5) * 0.2,
        d1[2] * 0.35 - m.kink[0] * side * 0.9 + (rand() - 0.5) * 0.3,
      ]);
      const len = m.len * (0.42 + rand() * 0.16);
      const knee = grow(from, away, len * 0.6, 0.062, 0.040);
      // Thinning aggressively: a sub ends at a quarter of the main it left.
      const twig = turn(away, norm([away[0] * 0.2, 1, away[2] * 0.2]), 0.5);
      tips.push(grow(knee, twig, len * 0.5, 0.040, 0.018));
    }
    void mi;
  });

  return { segments, tips, trunkDirs, height: at[1] };
}

/* -------------------------------------------------------- the framing branch */

/**
 * The branch, written as **where it lands in the picture**.
 *
 * Every other placement in this renderer that matters is authored this way (see
 * framing.js), and nothing has a better claim to it than this: the entire job
 * of a framing device is which corner of the frame it occupies and how far in
 * it reaches. Authored as world coordinates it was retuned four times by hand
 * and still only covered nine percent of the frame, because a limb hanging two
 * and a half units at a depth of six moves eight percent down the picture and
 * no distance along its own axis was going to change that.
 *
 * The fix is depth, and it is why `z` is on every waypoint and runs *positive*.
 * The eye stands at z = 12.2, so z = +3.6 is eight units from the lens where a
 * world unit is a ninth of the frame's height, against a twentieth of it out at
 * the tree. That is the whole of "large, near-black, partially out of frame":
 * the branch is not big, it is **close**, which is also the only way it can do
 * the job it is here for. A framing element has to be at a depth the eye can
 * name, in front of everything, so that every other plane in the picture is
 * read against it.
 *
 * The first waypoint is off the corner at u = 1.38 on purpose. Nothing in the
 * frame should show where this branch begins, or it stops being a device and
 * becomes a prop.
 */
const FRAMING_SPINE = [
  { u: 1.44, v: -0.22, z: 4.4, r: 0.300 },
  { u: 1.26, v: -0.15, z: 3.8, r: 0.260 },
  { u: 1.11, v: -0.06, z: 3.2, r: 0.225 },
  { u: 1.00, v: -0.02, z: 2.6, r: 0.190 },
  { u: 0.89, v: 0.04, z: 2.0, r: 0.160 },
  { u: 0.80, v: 0.03, z: 1.4, r: 0.135 },
  { u: 0.70, v: 0.09, z: 0.8, r: 0.110 },
  { u: 0.62, v: 0.08, z: 0.2, r: 0.085 },
  { u: 0.54, v: 0.15, z: -0.4, r: 0.060 },
];

/**
 * The droppers: three limbs hanging inward and down off the spine's joints,
 * each with a knee in it. They are what carries the branch into the frame — the
 * spine alone runs along the very top edge and reads as a bar across it.
 *
 * The lowest tip lands at v = 0.42, just above the horizon at 0.45. Lower than
 * that and it starts competing with the cultivator rather than framing her.
 *
 * The `u` in each column is the part that took three attempts. Written as three
 * limbs hanging *down* — which is what "dropper" says and what the first two
 * passes did — they came out as three near-parallel vertical lines of even
 * width, which is a gantry, and the shape of a gantry does not care how
 * carefully its members are tapered. Every segment here moves 0.07–0.09 across
 * the frame as well as down it, and the sign alternates, so the limb zigzags at
 * roughly forty-five degrees. That is what plum wood does, and it is the whole
 * difference between a branch and a piece of scaffolding.
 */
const FRAMING_DROPS = [
  {
    joint: 2,
    r: 0.135,
    way: [{ u: 1.12, v: 0.05, z: 3.0 }, { u: 1.04, v: 0.13, z: 2.9 },
      { u: 1.12, v: 0.21, z: 2.8 }, { u: 1.05, v: 0.30, z: 2.7 }],
  },
  {
    joint: 4,
    r: 0.115,
    way: [{ u: 0.82, v: 0.11, z: 1.9 }, { u: 0.90, v: 0.19, z: 1.8 },
      { u: 0.81, v: 0.30, z: 1.7 }, { u: 0.88, v: 0.41, z: 1.6 }],
  },
  {
    joint: 6,
    r: 0.090,
    way: [{ u: 0.72, v: 0.17, z: 0.7 }, { u: 0.64, v: 0.25, z: 0.6 },
      { u: 0.72, v: 0.33, z: 0.5 }],
  },
];

/**
 * Twigs: four short, thin offshoots reaching back up and out of frame.
 *
 * They are the difference between a branch and a jointed arm, and it took two
 * rounds on the contact sheet to see why. A spine plus three droppers is eight
 * limbs of comparable weight meeting at sharp elbows — which is a crane, and it
 * read as one no matter how the angles were retuned. What no piece of machinery
 * has is *fine wood*: short offshoots an eighth the thickness of what they leave,
 * going the wrong way. Adding them costs eight instances in a mesh that already
 * exists.
 */
const FRAMING_TWIGS = [
  { joint: 1, r: 0.075, way: [{ u: 1.30, v: -0.03, z: 3.6 }, { u: 1.37, v: 0.05, z: 3.5 }] },
  { joint: 3, r: 0.065, way: [{ u: 0.94, v: 0.05, z: 2.5 }, { u: 1.00, v: 0.13, z: 2.4 }] },
  { joint: 5, r: 0.055, way: [{ u: 0.86, v: 0.09, z: 1.3 }, { u: 0.80, v: 0.16, z: 1.2 }] },
  { joint: 7, r: 0.048, way: [{ u: 0.58, v: 0.13, z: 0.1 }, { u: 0.63, v: 0.21, z: 0.0 }] },
  { joint: 4, r: 0.058, way: [{ u: 0.95, v: 0.10, z: 2.0 }, { u: 1.02, v: 0.18, z: 2.0 }] },
  { joint: 6, r: 0.046, way: [{ u: 0.75, v: 0.05, z: 0.8 }, { u: 0.81, v: 0.11, z: 0.8 }] },
];

const seat = (w) => placeAtDepth(w.u, w.v, w.z);

/**
 * The framing branch, in world space: same segment shape as the tree's, so the
 * two share a mesh, a material and a cylinder.
 */
export function framingBranch() {
  const segments = [];
  const tips = [];
  const joints = FRAMING_SPINE.map(seat);

  const grow = (from, to, r0, r1) => {
    segments.push({ from, to, r0, r1, dir: norm([to[0] - from[0], to[1] - from[1], to[2] - from[2]]) });
    return to;
  };

  for (let i = 0; i < joints.length - 1; i++) {
    grow(joints[i], joints[i + 1], FRAMING_SPINE[i].r, FRAMING_SPINE[i + 1].r);
  }
  tips.push(joints[joints.length - 1]);

  // Each dropper has a knee that goes *back* on itself in u — the little
  // reversal that reads as plum wood rather than as a rope hanging off a spar.
  for (const d of FRAMING_DROPS.concat(FRAMING_TWIGS)) {
    let at = joints[d.joint];
    d.way.forEach((w, i) => {
      const r = d.r * (0.68 ** i);
      at = grow(at, seat(w), r, r * 0.68);
    });
    tips.push(at);
  }

  return { segments, tips };
}
