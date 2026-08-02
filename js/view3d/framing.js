// The authored camera framings, and the maths to compose against them.
//
// The scenery is a painting, not a simulation: a peak matters because of where
// its summit lands in the frame, not where it stands in world space. Placing by
// world coordinate means re-guessing every number the moment the camera is
// retuned — and guessing badly, because the world framing looks down a diagonal,
// so the visible slice of world x at z = -140 is [-147, -65], not something
// centred on zero. Half a range placed "around x = 0" is simply off-screen.
//
// So this module inverts the projection: name a depth and a point in the frame,
// get back the world position that lands there. It is deliberately free of
// Three.js — the same arithmetic runs in the test suite.

/** Named framings. Opening the Sect tab moves the camera; it does not hide the world. */
export const FRAMINGS = {
  world:  { target: [0.8, 2.6, -1.0], dist: 12.5, yaw: 0.62, pitch: 0.17, fov: 42, drift: 1 },
  close:  { target: [0.0, 1.3, 0.0],  dist: 5.6,  yaw: 0.45, pitch: 0.10, fov: 40, drift: 0.6 },
  // The sheet covers the lower ~68% of a phone screen, so the sect framing aims
  // well below the valley: that lifts the sect into the strip the player can
  // actually still see. Otherwise "the camera moves to the sect" is a lie.
  sect:   { target: [2.0, -26.0, -52.0], dist: 46, yaw: 0.95, pitch: 0.30, fov: 44, drift: 0.7 },
  trib:   { target: [0.0, 2.2, 0.0],  dist: 14.0, yaw: 0.30, pitch: 0.02, fov: 50, drift: 0.3 },
  forge:  { target: [5.2, 1.1, 3.4],  dist: 4.6,  yaw: 0.90, pitch: 0.14, fov: 40, drift: 0.4 },
  duel:   { target: [26, -2.9, -14],  dist: 14.5, yaw: 0.16, pitch: 0.05, fov: 44, drift: 0.3 },
  rebirth: { target: [0.0, 3.0, 0.0], dist: 20.0, yaw: 0.62, pitch: -0.02, fov: 55, drift: 0.2 },
};

/**
 * Portrait phone, the frame the composition is authored for. Wider screens see
 * more to the sides, which is why placement overscans rather than filling
 * exactly to the edges.
 */
export const REFERENCE_ASPECT = 414 / 896;

/**
 * The camera basis for a framing, matching what the rig builds each update:
 * position from yaw/pitch/dist about the target, then `lookAt(target)` with
 * world up. Returned as plain arrays.
 */
export function cameraBasis(f = FRAMINGS.world) {
  const [tx, ty, tz] = f.target;
  const cp = Math.cos(f.pitch);
  // Mirrors the rig's own position formula, including its slight vertical bias.
  const pos = [
    tx + Math.sin(f.yaw) * cp * f.dist,
    ty + Math.sin(f.pitch) * f.dist + f.dist * 0.06,
    tz + Math.cos(f.yaw) * cp * f.dist,
  ];

  // Three's lookAt: z points back toward the camera, x = up × z, y = z × x.
  const z = norm([pos[0] - tx, pos[1] - ty, pos[2] - tz]);
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return { pos, x, y, z };
}

/**
 * Where in the frame a world point lands, as fractions of width and height
 * (0,0 top-left; 1,1 bottom-right). `behind` is true when the point is on the
 * wrong side of the camera, where the fractions are meaningless.
 */
export function frameOf(p, { framing = FRAMINGS.world, aspect = REFERENCE_ASPECT } = {}) {
  const b = cameraBasis(framing);
  const v = [p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]];
  const cz = dot(v, b.z);
  if (cz >= -1e-6) return { u: NaN, v: NaN, behind: true };
  const tanH = Math.tan((framing.fov * Math.PI) / 360);
  const ndcX = dot(v, b.x) / -cz / (tanH * aspect);
  const ndcY = dot(v, b.y) / -cz / tanH;
  return { u: ndcX * 0.5 + 0.5, v: 0.5 - ndcY * 0.5, behind: false };
}

/**
 * The inverse: the world point on the plane `z = worldZ` that lands at frame
 * position (u, v). Both projection equations are affine in (x, y) once the
 * depth plane is fixed, so this is a two-by-two solve rather than a search.
 */
export function placeAtDepth(u, v, worldZ, { framing = FRAMINGS.world, aspect = REFERENCE_ASPECT } = {}) {
  const b = cameraBasis(framing);
  const tanH = Math.tan((framing.fov * Math.PI) / 360);
  // Target NDC, and the slope each axis must satisfy against depth.
  const a = (u * 2 - 1) * tanH * aspect;
  const c = (1 - v * 2) * tanH;

  // camX + a·camZ = 0 and camY + c·camZ = 0, with cam* affine in world x,y.
  const konst = (axis) => (
    axis[0] * -b.pos[0] + axis[1] * -b.pos[1] + axis[2] * (worldZ - b.pos[2])
  );
  const r1 = [b.x[0] + a * b.z[0], b.x[1] + a * b.z[1], konst(b.x) + a * konst(b.z)];
  const r2 = [b.y[0] + c * b.z[0], b.y[1] + c * b.z[1], konst(b.y) + c * konst(b.z)];

  const det = r1[0] * r2[1] - r2[0] * r1[1];
  if (Math.abs(det) < 1e-9) return null; // degenerate: the plane is edge-on
  return [
    (-r1[2] * r2[1] + r2[2] * r1[1]) / det,
    (-r1[0] * r2[2] + r2[0] * r1[2]) / det,
    worldZ,
  ];
}

/** World units per frame-height at a given depth — how big to build things. */
export function unitsPerFrame(worldZ, opts = {}) {
  const top = placeAtDepth(0.5, 0, worldZ, opts);
  const bottom = placeAtDepth(0.5, 1, worldZ, opts);
  if (!top || !bottom) return 1;
  return Math.abs(top[1] - bottom[1]);
}

/* ------------------------------------------------------------ tiny vectors */

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
