// 云海 — the sea of cloud, as four scrolling layers.
//
// ---------------------------------------------------------------------------
// What this is for
//
// Peaks that rise *out of* a moving cloud layer read as murim. The same peaks
// standing in even fog read as peaks with a haze problem. The difference is not
// the fog density and it is not the rock: it is that a sea has a **surface**,
// the surface is at a height, and things stand above it or drown in it. One
// plane cannot say that — one plane is a sheet, and a sheet has no depth to be
// above. Four, at four heights, moving at four speeds, do: the near layer
// crosses the far one, the gap between them is somewhere the eye can put a
// peak, and the whole thing turns from a texture into a place.
//
// ---------------------------------------------------------------------------
// Where the surface sits, and why it is not where the brief said
//
// The build was specified as four planes at y = 2.0, 2.6, 3.2 and 3.8. Against
// the camera stage 0 locked, the eye stands at y = 2.0251 — so those four
// heights are, in order: 25 mm below the eye, and then three above it. Drawn
// literally that is not a sea at all:
//
//   * the y = 2.0 plane is 0.025 below the eye and 400 units across, so its
//     entire visible extent projects into the 6% of frame height between the
//     horizon and where the 0.5 near plane cuts it — a band about two pixels
//     tall on a phone, with a ruled clip edge under it.
//   * the other three are *above* the eye, so they are seen from below and
//     converge on the horizon from the top of the frame: an overcast ceiling
//     drawn over the entire sky and over every summit in it. That is the one
//     thing the value ladder cannot survive — cloud is the brightest rung, and
//     laying it over the peaks puts the brightest thing in the frame in front
//     of the darkest.
//
// The 0.6 spacing goes the same way and for the same reason. One rung of the
// brief's stack is 0.8% of frame height at the middle of this sea — about four
// pixels on a phone — so four layers 0.6 apart are one sheet drawn four times,
// which is precisely the gate this stage has to pass. Both facts are measured,
// not argued: `tests/run.js` asserts them against the real projection maths, so
// the reason the numbers moved is checked rather than remembered.
//
// What is kept is everything that is actually the design: four layers, ordered
// low to high, one 400 × 400 plane each, a tiling noise alpha map under 512²,
// independent scroll at the brief's own rate, a slight drift and a different
// direction per layer, a tint toward the sun on the sun-facing side, and the
// whole thing drawn after the opaque world. What moves is where the stack sits
// and how far apart its rungs are — and both are *solved from the frame* rather
// than authored, like every other placement in this renderer, so retuning the
// camera moves the sea with it instead of silently invalidating it.
//
// ---------------------------------------------------------------------------
// Why MeshBasicMaterial, in a renderer with no stock materials in it
//
// Cloud is not lit in this picture: in shan shui the unpainted paper *is* the
// cloud, and everything else is read against it. A shaded cloud is a cloud with
// a dark side, and a dark side puts it somewhere on the ladder other than the
// top. So there is nothing for a light model to do here, and the two things
// that do vary across the sea — which way the sun is, and how much air is in
// front of it — are smooth over hundreds of units and belong on the vertices,
// where they cost nothing and interpolate for free.
//
// Two flags on that material are load-bearing and silent if wrong:
//
//   toneMapped: false   the renderer's ACES curve is applied once, in the post
//                       pass. A stock material would apply it again in its own
//                       fragment shader, and the sea would come back milky and
//                       wrong in a way that looks like a colour choice.
//   fog: false          scene.fog is exponential-squared and total by about 400
//                       units, which is right for mist and wrong for a surface
//                       drawn to the horizon: it would take the sea to exactly
//                       the sky colour and there would be no sea. The haze is
//                       applied per vertex instead, capped, from the same
//                       `env.uFogColor` and `env.uFogDensity` every other
//                       material reads. One air, still.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  TILE, cloudTile, LAYERS, PLANE, SCROLL, SWELL, seatHeights, swellAt,
} from './cloud-plan.js';
import { cameraBasis, FRAMINGS } from './framing.js';

/**
 * Vertex grid. Everything carried on it — the sun gradient, the aerial haze,
 * the two radial fades — varies over tens of units, so this is about eight
 * times finer than anything it interpolates.
 */
const SEGMENTS = 24;

/**
 * How much of the sun's own colour the lit side of the sea takes. Small on
 * purpose: this is the difference between a sea that belongs to the sky above
 * it and a sea painted in the sunset. Past about 0.3 the cloud stops being the
 * top rung of the ladder and starts being a coloured object.
 */
const SUN_TINT = 0.24;

/**
 * The most air the sea is allowed to take at its far fade.
 *
 * Low, and it has to be. Uncapped exp² haze is total by 150 units at the day's
 * own density, which would take the far half of the sea to exactly the skyline
 * colour — and cloud that has become the air is not the top rung of the value
 * ladder any more, it is the middle one. 0.30 is enough recession to say
 * "further away" and not enough to say "gone". (Measured at 0.62 first: the sea
 * came back reading as haze, which is the fault this whole stage exists to fix,
 * arrived at from the inside.)
 */
const HAZE_CAP = 0.30;

/* ---------------------------------------------------------------- texture */

// One tile, generated once per session and shared by every layer and every
// scene rebuild. It costs about 70 ms of arithmetic; a quality change must not
// pay that again, and neither must a second view.
let tileData = null;
function sharedTile() {
  if (!tileData) tileData = cloudTile({ seed: 3, cells: 8, coverage: COVERAGE });
  return tileData;
}

/**
 * How much of the tile is cloud — and the number that decides whether the sea
 * has any contrast at all.
 *
 * Four layers is four draws of this coverage stacked, and stacked alphas
 * converge: at 0.50 a layer, the union comes out around 0.77 *everywhere*, with
 * the variance averaged away, and the sea renders as one even pale plate with
 * the tile's structure statistically cancelled out of it. Which is the exact
 * failure the layering was added to fix, arrived at by adding layers. At 0.36
 * the union is nearer half, the gaps stay open, and what shows through them —
 * the dark valley and the river — is what gives the cloud an edge to be read
 * against.
 */
const COVERAGE = 0.36;

function makeTexture([repeatU, repeatV], rotation) {
  const tex = new THREE.DataTexture(sharedTile(), TILE, TILE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  // A ground plane seen at grazing incidence is the textbook case for
  // anisotropy, and this one is seen at two degrees. Three clamps the request
  // to whatever the device actually has.
  tex.anisotropy = 16;
  // Anisotropic on purpose, and heavily: after the layer's rotation `repeatU`
  // runs across the sightline and `repeatV` along it, where five to one of
  // foreshortening is waiting. See VIEW_UV.
  tex.repeat.set(repeatU, repeatV);
  tex.center.set(0.5, 0.5);
  tex.rotation = rotation;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------------------------------------------------------- the sea */

export function createCloudSea(env, tier) {
  const group = new THREE.Group();
  const count = Math.max(0, Math.min(tier.cloudLayers ?? LAYERS.length, LAYERS.length));
  const heights = seatHeights();
  // The sea is centred on the eye, not on the origin. A 400-unit square centred
  // anywhere else has corners at 280 units and edges at 200, so a radial fade
  // tuned to clear one shows the other the moment the player swings the camera;
  // centred here the fade is a ring and there is no rectangle to find.
  const eye = cameraBasis(FRAMINGS.world).pos;

  const layers = [];
  for (let i = 0; i < count; i++) {
    const L = LAYERS[i];
    const map = makeTexture(L.repeat, L.rotation);

    const geo = new THREE.PlaneGeometry(PLANE, PLANE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const verts = geo.attributes.position.count;

    // The swell. Baked in here rather than animated: it is the surface's shape,
    // and the alpha map scrolling over it is its mass.
    {
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let v = 0; v < verts; v++) {
        pos.setY(v, swellAt(uv.getX(v), uv.getY(v), L.seed) * SWELL.amplitude);
      }
      pos.needsUpdate = true;
    }

    // RGBA vertex colour: the resolved cloud colour, and the spatial fade in
    // alpha. Three multiplies both into the material, so the material stays
    // white and every per-place decision lives here.
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 4), 4));

    const mat = new THREE.MeshBasicMaterial({
      alphaMap: map,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      fog: false,
      toneMapped: false,
      opacity: L.opacity,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(eye[0], heights[i], eye[2]);
    // Transparent, so three already draws it after everything opaque; this
    // orders it against the other transparents. Above the ridge strips and the
    // standing cloud decks (-6 … -17), which is what lets the sea drown their
    // feet, and below the near mist and the foreground (-3 and up).
    mesh.renderOrder = L.order;
    // 400 units of plane with a fade in the middle of it: the bounding sphere
    // says "off screen" long before the visible part is.
    mesh.frustumCulled = false;
    group.add(mesh);

    layers.push({ mesh, mat, map, spec: L, index: i, geo });
  }

  /* ------------------------------------------------------------- painting */

  const tmpBase = new THREE.Color();
  const tmpCol = new THREE.Color();
  const sunXZ = new THREE.Vector2();

  /**
   * Repaint every vertex from the day and the realm.
   *
   * Called once a frame while a realm transition runs and once when it settles,
   * so it has to be cheap: four layers of 625 vertices is 2 500 iterations of
   * arithmetic and no allocation.
   *
   *   cloud/crest  the realm's own two cloud colours, already eased.
   *   sun          the key light's colour and direction, read from `env` — the
   *                same uniforms the ink shaders read, so the sea cannot
   *                disagree with the rock about where the light is.
   *   air          `env.uFogColor` and `env.uFogDensity`: one air.
   */
  function apply(cloud, crest) {
    const dir = env.uLightDir.value;
    sunXZ.set(dir.x, dir.z);
    if (sunXZ.lengthSq() < 1e-6) sunXZ.set(0, 1);
    sunXZ.normalize();
    const sun = env.uLightColor.value;
    const air = env.uFogColor.value;
    const density = env.uFogDensity.value;

    for (const layer of layers) {
      const pos = layer.geo.attributes.position;
      const col = layer.geo.attributes.color;
      const arr = col.array;
      tmpBase.copy(cloud).lerp(crest, layer.spec.crest);
      const [n0, n1] = layer.spec.near;
      const [f0, f1] = layer.spec.far;
      const y = layer.mesh.position.y - eye[1];

      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const z = pos.getZ(v);
        const r = Math.hypot(x, z);          // the plane is centred on the eye
        const d = Math.hypot(r, y + pos.getY(v));

        // Toward the sun, in plan. The lit half of a sea is the half the light
        // is coming from; the far half is the shadow side of every billow on it.
        const face = r > 1e-3 ? (x * sunXZ.x + z * sunXZ.y) / r : 0;
        const lit = smoothstep(-0.45, 0.9, face);

        // The swell's own light. The top of a rise is what the sky sees and the
        // trough beside it is not, and that difference is the only thing in the
        // sea that describes its *shape* — the alpha map can only describe where
        // it is. Reading the height back off the vertex rather than re-deriving
        // it means the shading cannot drift from the geometry it shades.
        const rise = smoothstep(-0.9, 1.1, pos.getY(v));

        tmpCol.copy(tmpBase).lerp(crest, rise * 0.42).lerp(sun, SUN_TINT * lit);
        // Aerial perspective, capped, from the same air as everything else.
        const t = density * d;
        const haze = (1 - Math.exp(-t * t)) * HAZE_CAP;
        tmpCol.lerp(air, haze);

        const fade = smoothstep(n0, n1, d) * (1 - smoothstep(f0, f1, d));

        const k = v * 4;
        arr[k] = tmpCol.r;
        arr[k + 1] = tmpCol.g;
        arr[k + 2] = tmpCol.b;
        arr[k + 3] = fade;
      }
      col.needsUpdate = true;
    }
  }

  /**
   * Scroll. Each layer at its own speed and its own heading, and nothing else
   * moves — no vertex animation, no per-frame noise. The parallax between four
   * layers crossing at four rates is the whole of the motion, which is why it
   * can be this slow and still read as weather rather than as a still.
   *
   * Two corrections to the brief's `offset.x += dt * 0.0015 * (i + 1)`, both
   * arithmetic rather than art:
   *
   *   × repeat   `offset` is in *texture* units, so with the tile repeated
   *              thirteen times along the sightline the brief's rate comes out
   *              thirteen times too slow — 0.05 units a second, which is a
   *              still frame with extra steps. Multiplying it back by the
   *              repeat makes 0.0015 mean what it reads as: fifteen ten-
   *              thousandths of the *plane* per second.
   *   reversed   layer 0 is the lowest and therefore the nearest, so it is the
   *              one that has to move fastest. Taken as written, the index ramp
   *              runs the furthest layer quickest, which is parallax backwards
   *              and reads as the sea sliding apart.
   *
   * The result: 1.2 units a second on the near layer down to 0.3 on the far.
   * At the depth that layer is seen, 1.2 units/s is 2.7% of frame width in a
   * second — a billow takes the better part of a minute to cross the picture.
   */
  function update(dt, reduced = false) {
    const rate = reduced ? 0.35 : 1;
    const rungs = layers.length;
    for (const layer of layers) {
      const [repeatU, repeatV] = layer.spec.repeat;
      const step = dt * SCROLL * ((rungs - layer.index) / 2) * rate;
      layer.map.offset.x += step * repeatU * Math.cos(layer.spec.heading);
      layer.map.offset.y += step * repeatV * Math.sin(layer.spec.heading);
    }
  }

  return {
    group,
    layers,
    apply,
    update,
    /** Where every layer ended up. The lowest is "the sea's surface". */
    heights,
  };
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
