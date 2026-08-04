// The locked camera. One object, and every number the composition depends on
// is in it.
//
// ---------------------------------------------------------------------------
// Why this file exists
//
// A framing is not a preference, it is the coordinate system every other art
// decision is made in. Move the camera after the scene is built and every call
// that was made — how tall a ridge is, where the skyline sits, how small the
// figure reads — was made against a crop that no longer exists, and none of it
// can be re-judged without redoing all of it. So the camera is frozen first,
// here, in one place, and the rest of the world is composed against it.
//
// The contract below is not decoration. tests/run.js asserts every line of it
// against the real projection maths in framing.js, so if a number here drifts
// the suite fails rather than the picture quietly going wrong.
//
//   fov 45, portrait          the frame the whole game is authored for
//   horizon at v = 0.45       above centre, never centred — a centred horizon
//                             splits the frame in two and neither half wins
//   character base at 0.61    she sits in the lower third, under the horizon
//   character 13.5% tall      small. The landscape is the subject; she is the
//                             thing that gives it scale
//   top 12% / bottom 30%      reserved for the status bar and the UI. Nothing
//                             that has to be read may land inside either band
//
// Frame coordinates are (u, v) fractions: (0,0) top-left, (1,1) bottom-right,
// so "45% down the frame" is v = 0.45. The same convention framing.js uses.
// ---------------------------------------------------------------------------

/** Field of view, degrees. The one number the whole composition hangs off. */
const FOV = 45;

/** Portrait phone — 414×896 CSS px. Wider screens see more to the sides. */
const REFERENCE_ASPECT = 414 / 896;

/**
 * The hero framing, solved from the contract rather than eyeballed.
 *
 *   pitch   from the horizon target: the rig's own position formula carries a
 *           +0.06·dist vertical bias, so the pitch that puts the horizon at
 *           v = 0.45 is slightly negative, not zero.
 *   dist    from the character's height on screen — she is 1.71 world units
 *           tall and must occupy 13.5% of the frame, which fixes how far the
 *           eye stands from her.
 *   target  from where her feet have to land, (u 0.44, v 0.61). The pivot sits
 *           at her depth so the player's nudge arc orbits the figure.
 *
 * Anything that changes here changes all four, together. Re-derive; do not
 * nudge one number and hope.
 */
const HERO = {
  target: [0.246, 1.392, -0.259],
  dist: 15.29,
  yaw: 0.62,
  pitch: -0.01859,
  fov: FOV,
  drift: 1,
};

/**
 * Named framings. Opening the Sect tab moves the camera; it does not hide the
 * world. Every fov is written as an offset from FOV so there is exactly one
 * place to retune the lens, and the set pieces keep their relative feel.
 */
const framings = {
  world: HERO,
  close:   { target: [0.0, 1.3, 0.0],     dist: 5.6,  yaw: 0.45, pitch: 0.10,  fov: FOV - 2,  drift: 0.6 },
  // The sheet covers the lower ~68% of a phone screen, so the sect framing aims
  // well below the valley: that lifts the sect into the strip the player can
  // actually still see. Otherwise "the camera moves to the sect" is a lie.
  sect:    { target: [2.0, -26.0, -52.0], dist: 46,   yaw: 0.95, pitch: 0.30,  fov: FOV + 2,  drift: 0.7 },
  trib:    { target: [0.0, 2.2, 0.0],     dist: 14.0, yaw: 0.30, pitch: 0.02,  fov: FOV + 8,  drift: 0.3 },
  forge:   { target: [5.2, 1.1, 3.4],     dist: 4.6,  yaw: 0.90, pitch: 0.14,  fov: FOV - 2,  drift: 0.4 },
  duel:    { target: [26, -2.9, -14],     dist: 14.5, yaw: 0.16, pitch: 0.05,  fov: FOV + 2,  drift: 0.3 },
  rebirth: { target: [0.0, 3.0, 0.0],     dist: 20.0, yaw: 0.62, pitch: -0.02, fov: FOV + 13, drift: 0.2 },
};

/**
 * The four QA cameras behind the debug panel's `C` key, and the rows of the
 * contact sheet. They are stills, so none of them breathes — `drift: 0` makes
 * a capture byte-for-byte repeatable.
 *
 * All four keep the hero's lens and tilt, so the horizon sits at v = 0.45 in
 * every one of them and the four rows of a contact sheet are directly
 * comparable. `wide` is the hero pulled back along its own axis; `profile` is
 * the hero swung a quarter turn around the figure; `close` is solved to put her
 * at 34% of frame height, big enough to judge the silhouette and still clear of
 * the top band.
 */
const debugPresets = [
  { id: 'hero', label: 'hero', framing: { ...HERO, drift: 0 } },
  { id: 'wide', label: 'wide', framing: { ...HERO, dist: HERO.dist * 3.2, drift: 0 } },
  {
    id: 'close',
    label: 'close',
    framing: {
      target: [-0.036, 1.409, -0.051], dist: 6.08,
      yaw: HERO.yaw, pitch: HERO.pitch, fov: FOV, drift: 0,
    },
  },
  // A quarter turn *anticlockwise*. Clockwise puts a standing rock squarely
  // between the eye and the figure, and a QA camera that cannot see its
  // subject is not an instrument.
  { id: 'profile', label: 'profile', framing: { ...HERO, yaw: HERO.yaw - 1.35, drift: 0 } },
];

/**
 * The four skies the contact sheet samples, as positions on the 0→1 scrubber.
 * They land exactly on authored palettes — dawn, the amber sunset, the starry
 * indigo, and the golden sea of cloud — rather than between them, so a cell
 * that looks wrong is a palette that is wrong and not an artefact of blending.
 */
const timesOfDay = [
  { id: 'dawn', label: 'dawn', t: 0 },
  { id: 'dusk', label: 'dusk', t: 2 / 7 },
  { id: 'night', label: 'night', t: 4 / 7 },
  { id: 'gold', label: 'gold', t: 1 },
];

export const CAMERA = {
  fov: FOV,
  near: 0.5,
  far: 900,
  referenceAspect: REFERENCE_ASPECT,

  /** Bands the UI owns. Nothing that must be read may land inside them. */
  safeZone: { top: 0.12, bottom: 0.30 },

  /**
   * The composition contract, and the tolerance each line is judged at. The
   * tolerances are the brief's own ranges: 60–62% down the frame is
   * `anchorV ± 0.01`, 12–15% of frame height is `characterHeightV ± 0.015`.
   */
  composition: {
    horizonV: 0.45,
    anchorU: 0.44,
    anchorV: 0.61,
    /** Where the cultivator stands, and how tall she is: feet to hair knot. */
    characterAnchor: [0, 0, 0],
    characterHeight: 1.71,
    characterHeightV: 0.135,
    tolerance: { horizonV: 0.01, anchorU: 0.02, anchorV: 0.01, characterHeightV: 0.015 },
  },

  framings,
  debugPresets,
  timesOfDay,
};

export { FOV, REFERENCE_ASPECT };
export const FRAMINGS = CAMERA.framings;
