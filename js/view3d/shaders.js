// Ink-wash shading kit.
//
// Everything here is authored GLSL — no stock PBR, no textures, no downloads.
// A shared `env` uniform bundle is passed by reference into every material, so
// one realm transition re-lights the whole world at once.

import * as THREE from 'three';
import { LUMA } from './palette.js';

/* ------------------------------------------------------------ GLSL chunks */

/**
 * The luminance weights, as GLSL. Every desaturation in this file and the
 * debug grayscale pass read from here, and `luminance()` in palette.js reads
 * from the same constant — so the withering, the QA instrument and the value
 * ladder the test suite asserts are all measuring with one ruler.
 */
export const LUMA3 = `vec3(${LUMA[0]}, ${LUMA[1]}, ${LUMA[2]})`;

// Cheap value noise. Used for mist, paper fibre, water and ridge texture.
export const NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

// Aerial perspective, applied by hand so it matches the sky gradient exactly.
//
// "Exactly" is the whole of it. `uFogColor` is the day's **horizon** colour and
// `uFogHigh` is its **zenith** — the same two values the sky sphere is drawn
// with and the same colour `scene.fog` carries, all read from one time-of-day
// object. Air that is merely close to the colour of the sky it stands in is
// what makes distant geometry read as a rectangle pasted onto the horizon;
// there is no second opinion about the air anywhere in this renderer.
//
// Air is not one colour, either. Mixing every distant surface toward a single
// grey is what flattens a landscape into a decal: a summit high in the frame
// and a foot down in the valley converge on the same value, and the range stops
// sitting *in* anything. So `airAt` walks from the skyline colour to the zenith
// colour with world height, which is what you are actually looking through.
//
// `cap` is the most haze a surface is allowed to take. Exponential-squared fog
// is total by about 400 units, which is right for mist and wrong for a range of
// mountains: an ink-wash horizon is pale, not absent. Capping a distant rank
// leaves it a few percent darker than the air it stands in, which is the whole
// of how depth reads in a painting with no texture and no atmosphere model.
export const FOG = /* glsl */ `
  uniform vec3 uFogColor;   // the day's horizon: air along the skyline
  uniform vec3 uFogHigh;    // the day's zenith: air up where the summits are
  uniform float uFogDensity;

  vec3 airAt(float worldY) {
    return mix(uFogColor, uFogHigh, smoothstep(-18.0, 34.0, worldY));
  }
  float hazeAmount(float depth, float cap) {
    return clamp(1.0 - exp(-uFogDensity * uFogDensity * depth * depth), 0.0, 1.0) * cap;
  }
  vec3 applyFogCapped(vec3 color, float depth, float cap) {
    return mix(color, uFogColor, hazeAmount(depth, cap));
  }
  vec3 applyFogCapped(vec3 color, float depth, float cap, float worldY) {
    return mix(color, airAt(worldY), hazeAmount(depth, cap));
  }
  vec3 applyFog(vec3 color, float depth) {
    return applyFogCapped(color, depth, 1.0);
  }
`;

/**
 * ACES filmic, the Narkowicz fit, plus the linear→sRGB encode that has to
 * follow it.
 *
 * The reason the whole renderer works in linear now and only converts here:
 * ACES is a curve on *light*, and its whole value is the shoulder — the bit
 * that takes a value of three and lands it near white instead of clipping it
 * to a flat plate. Applied to numbers that have already been gamma-encoded it
 * has nothing to roll off, because everything is already inside 0..1.
 */
const ACES = /* glsl */ `
  vec3 acesFilmic(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  vec3 linearToSRGB(vec3 c) {
    return mix(c * 12.92,
      1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055,
      step(vec3(0.0031308), c));
  }
`;

// Instancing-aware position/normal, so one shader serves meshes and swarms.
const INSTANCE_VERT = /* glsl */ `
  vec4 localPos = vec4(position, 1.0);
  vec3 localNormal = normal;
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
    localNormal = mat3(instanceMatrix) * localNormal;
  #endif
`;

/* ------------------------------------------------------- shared uniforms */

/**
 * One bundle, shared by reference. Mutate `.value` and the world re-lights.
 *
 * Everything under "the rig" is written by lighting.js from the three real
 * lights, so the hand-written shading below and the THREE.Light that renders
 * the shadow map are always describing the same sun. Nothing else may write
 * them.
 */
export function createEnv() {
  return {
    uTime: { value: 0 },

    // the rig — see lighting.js
    uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
    uLightColor: { value: new THREE.Color('#fff2dc') },
    uSunPower: { value: 1.9 },
    // The hemisphere that replaced the ambient term. Sky above, ground below;
    // there is no flat fill anywhere in this renderer any more.
    uHemiSky: { value: new THREE.Color('#333c46') },
    uHemiGround: { value: new THREE.Color('#2b3038') },
    uHemiIrradiance: { value: 0.35 },
    uRimLightDir: { value: new THREE.Vector3(-0.58, 0.55, -0.79).normalize() },
    uRimLightColor: { value: new THREE.Color('#ffe8cf') },
    uRimLightPower: { value: 0.55 },

    uFogColor: { value: new THREE.Color('#0b0e12') },
    uFogHigh: { value: new THREE.Color('#0b0e12') },
    uFogDensity: { value: 0.006 },
    uRimColor: { value: new THREE.Color('#8fd8c0') },
    uDesat: { value: 0 },      // withering drains the world
    uBands: { value: 4.0 },    // toon ramp steps
  };
}

function envUniforms(env, extra = {}) {
  return Object.assign({
    uTime: env.uTime,
    uLightDir: env.uLightDir,
    uLightColor: env.uLightColor,
    uSunPower: env.uSunPower,
    uHemiSky: env.uHemiSky,
    uHemiGround: env.uHemiGround,
    uHemiIrradiance: env.uHemiIrradiance,
    uRimLightDir: env.uRimLightDir,
    uRimLightColor: env.uRimLightColor,
    uRimLightPower: env.uRimLightPower,
    uFogColor: env.uFogColor,
    uFogHigh: env.uFogHigh,
    uFogDensity: env.uFogDensity,
    uRimColor: env.uRimColor,
    uDesat: env.uDesat,
    uBands: env.uBands,
  }, extra);
}

/**
 * The key light's response curve, as GLSL.
 *
 * This was `dot(n, L) * 0.5 + 0.5` — a full half-lambert wrap, which hands a
 * surface pointing *directly away from the sun* half of the key. Combined with
 * the ambient term it meant the difference between the lit face of a rock and
 * its shadowed face was a few percent of the total, and there is no amount of
 * shadow map or rim light that can rescue a picture from that: the shading has
 * no range left to spend.
 *
 * A quarter-unit wrap keeps what the wrap was for — an ink-wash shadow side is
 * soft, not a hard terminator, and a fully lambertian toon ramp puts a black
 * crescent on every sphere — while giving the shadow side an actual zero to
 * fall to. The hemisphere is what fills it back in, which is the difference
 * between a shadow and a hole.
 */
const KEY = /* glsl */ `
  uniform vec3 uLightDir;
  float keyResponse(vec3 n) {
    return clamp((dot(n, normalize(uLightDir)) + 0.25) / 1.25, 0.0, 1.0);
  }
`;

/**
 * The hemisphere fill, as GLSL.
 *
 * This is the whole of the indirect light in the renderer. It is one lerp, so
 * it costs nothing next to the flat ambient it replaced — but it is a function
 * of the normal, which the flat one was not, and that difference is most of
 * why the shelf now has a top and a side instead of being one grey.
 */
const HEMI = /* glsl */ `
  uniform vec3 uHemiSky, uHemiGround;
  uniform float uHemiIrradiance;
  vec3 hemisphere(vec3 n) {
    return mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * uHemiIrradiance;
  }
`;

/**
 * The sun's shadow, sampled through three's own machinery.
 *
 * `renderer.shadowMap` renders the depth map from the DirectionalLight in
 * lighting.js; these are the stock chunks that read it, so `shadowMap.type`,
 * `shadow.bias`, `shadow.normalBias`, `shadow.radius` and `shadow.intensity`
 * all do exactly what they say on the light. When shadows are off — or when
 * nothing in the scene casts — `USE_SHADOWMAP` is never defined and every line
 * of this compiles away to `1.0`.
 *
 * `receiveShadow` is a per-object uniform the renderer sets from the mesh, so
 * the same material can be shared by the shelf (which receives) and the far
 * midground (which is nowhere near the shadow camera and should not pay for a
 * lookup that can only ever return "lit").
 */
const SHADOW_PARS_VERT = /* glsl */ `
  #include <common>
  #include <shadowmap_pars_vertex>
`;

/**
 * The chunks want a `vec4 worldPosition` and a view-space `transformedNormal`
 * in scope under exactly those names; this is the adapter from the names these
 * materials use.
 */
const SHADOW_VERT = /* glsl */ `
  #ifdef USE_SHADOWMAP
    vec4 worldPosition = world;
    vec3 transformedNormal = mat3(viewMatrix) * vNormalW;
    #include <shadowmap_vertex>
  #endif
`;

const SHADOW_PARS_FRAG = /* glsl */ `
  #include <common>
  #include <packing>
  #include <shadowmap_pars_fragment>
  #ifdef USE_SHADOWMAP
    uniform bool receiveShadow;
  #endif
  float sunShadow() {
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      if (!receiveShadow) return 1.0;
      DirectionalLightShadow s = directionalLightShadows[ 0 ];
      return getShadow(directionalShadowMap[ 0 ], s.shadowMapSize, s.shadowIntensity,
        s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[ 0 ]);
    #else
      return 1.0;
    #endif
  }
`;

/**
 * Light uniforms the renderer fills in for any ShaderMaterial that declares
 * `lights: true` — the shadow map, its matrix and the bias struct among them.
 *
 * Merged by assignment rather than by UniformsUtils.merge, because merge deep
 * *clones*: it would hand every material its own private copy of `uTime` and
 * `uLightDir`, and the one thing this whole file is built around is that those
 * are shared by reference so a single realm transition re-lights the world.
 */
function litUniforms(env, extra = {}) {
  return Object.assign(
    THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    envUniforms(env, extra),
  );
}

/* ------------------------------------------------------ banded ink solids */

/**
 * The workhorse: a quantised light ramp with a rim light and hand-rolled fog.
 * Everything solid in the world uses this — cultivator, buildings, stone.
 */
export function makeInkMaterial(env, {
  color = '#5a6472', rim = 0.55, bands = null, emissive = 0, flat = false,
  transparent = false, opacity = 1, fogCap = 1,
} = {}) {
  return new THREE.ShaderMaterial({
    // Required for the renderer to upload the shadow map and its matrix; see
    // litUniforms() and SHADOW_PARS_FRAG.
    lights: true,
    uniforms: litUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uRim: { value: rim },
      uEmissive: { value: emissive },
      uOpacity: { value: opacity },
      uBandsOverride: { value: bands === null ? -1 : bands },
      uFogCap: { value: fogCap },
    }),
    transparent,
    flatShading: flat,
    vertexShader: /* glsl */ `
      ${SHADOW_PARS_VERT}
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec3 vLocal;
      varying float vWorldY;
      void main() {
        ${INSTANCE_VERT}
        vLocal = localPos.xyz;
        vec4 world = modelMatrix * localPos;
        vWorldY = world.y;
        vNormalW = normalize(mat3(modelMatrix) * localNormal);
        vViewDir = normalize(cameraPosition - world.xyz);
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
        ${SHADOW_VERT}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uLightColor, uRimColor, uRimLightDir, uRimLightColor;
      uniform float uRim, uEmissive, uOpacity, uBands, uBandsOverride, uDesat, uFogCap;
      uniform float uSunPower, uRimLightPower;
      ${SHADOW_PARS_FRAG}
      ${KEY}
      ${HEMI}
      ${FOG}
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec3 vLocal;
      varying float vWorldY;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(vViewDir);
        float ndl = keyResponse(n);
        float bands = uBandsOverride > 0.0 ? uBandsOverride : uBands;
        float ramp = floor(ndl * bands) / bands;
        ramp = mix(ramp, ndl, 0.25); // keep a little softness in the step

        // The sun, and what the shelf takes out of it. The shadow multiplies
        // the key only — an occluded surface still sees the sky, which is what
        // keeps a contact shadow reading as shade rather than as a hole.
        vec3 col = uColor * (hemisphere(n) + uLightColor * uSunPower * ramp * sunShadow());

        // The edges.
        //
        // A fresnel term is only an *edge* on something with a silhouette. On a
        // shelf twenty-five units across, seen from eight degrees above it,
        // 1 - dot(n, v) is 0.87 over the whole surface — so at the exponent
        // this used to run at, two thirds of the light on the entire foreground
        // was a view-dependent wash that no sun and no shadow could touch. That
        // is a third of the frame that could not be lit, and it is the other
        // half of why the picture was flat. A tighter exponent puts the term
        // back where the word "rim" means something.
        //
        // Gating it on the key is the other half: an edge light is what you see
        // where the key is not. Where the sun is already on a surface, the rim
        // has nothing to separate it from.
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0) * (1.0 - 0.7 * ramp);

        // The rim light proper: it appears where the surface faces the light
        // standing behind her, so it is a light with a position rather than a
        // halo painted evenly around every outline.
        float back = smoothstep(0.20, 0.80, dot(n, normalize(uRimLightDir)));
        col += uRimLightColor * fres * back * uRimLightPower * uRim;

        // The ink-wash edge that was already here, halved: the directional rim
        // above now carries the separation, and two full-strength rims stacked
        // on one silhouette is a glow.
        col += uRimColor * fres * uRim * 0.5;
        col += uColor * uEmissive;

        col = applyFogCapped(col, vDepth, uFogCap, vWorldY);
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
  });
}

/* ----------------------------------------------------------------- karst */

// One column of rock, reshaped per instance in the vertex shader.
//
// An InstancedMesh draws one geometry, so a field of them is a field of the same
// silhouette — and a repeated silhouette reads as a picket fence no matter how
// the instances are scattered, which is exactly what the first range did. The
// fix is not more geometries (that is more draw calls); it is to give each
// instance a seed and let the shader carve the profile: needles and blunt
// towers, twin summits, overhanging bellies, and a lean off plumb. The mesh is
// built as a plain fluted column and every silhouette decision is made here.
const KARST_PROFILE = /* glsl */ `
  // Radius multiplier at height t (0 foot, 1 summit) for a rock with this seed.
  float karstProfile(float t, float s) {
    // Needle at one end, flat-topped tower at the other. The blunt ones are what
    // stop a range looking like a bed of nails.
    float blunt = fract(s * 2.71);
    float taperStart = mix(0.40, 0.88, blunt);
    float taperTo = mix(0.05, 0.46, blunt);
    float w = 1.0 - smoothstep(taperStart, 1.0, t) * (1.0 - taperTo);

    // Undercut just above the foot: karst is dissolved out of a plateau, not
    // piled up, so the pillar is narrowest a little above where it lands.
    w *= 1.0 - 0.15 * sin(min(1.0, t / 0.42) * 3.14159265);

    // A shoulder — a lesser summit beside the main one. Real ranges are full of
    // them, and it is the cheapest way to break the one-peak-one-point rhythm.
    float sh = fract(s * 5.317);
    float at = mix(0.48, 0.74, fract(s * 9.73));
    w += step(0.52, sh) * exp(-pow((t - at) / 0.085, 2.0)) * (0.16 + 0.46 * (sh - 0.52));

    // A few carry an overhanging belly, so not every wall is a plumb drop.
    float ov = fract(s * 13.11);
    w *= 1.0 + step(0.70, ov) * exp(-pow((t - 0.32) / 0.20, 2.0)) * 0.34;

    return max(w, 0.02);
  }
`;

/**
 * The ten thousand peaks. Instanced, seed-carved, lit as ink: a dark body, a
 * lit edge where the sun catches the ridge, horizontal bedding, vertical
 * fluting, and a foot that dissolves into the air it stands in.
 */
export function makeRockMaterial(env, {
  color = '#1d2632', rim = 0.5, fogCap = 0.5, strata = 0.16, lean = 1.8,
  sunColor = '#ffe3bc', sun = 0.5, foot = 0.20,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uSunColor: { value: new THREE.Color(sunColor) },
      uRim: { value: rim },
      uSun: { value: sun },
      uFogCap: { value: fogCap },
      uStrata: { value: strata },
      uLean: { value: lean },
      uFoot: { value: foot },
    }),
    vertexShader: /* glsl */ `
      uniform float uLean;
      attribute float aSeed;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying float vWorldY;
      varying float vT;
      varying float vSeed;
      varying float vAngle;
      ${KARST_PROFILE}
      void main() {
        float s = aSeed;
        vSeed = s;
        // The mesh is a unit column: y is height, xz the fluted ring. uv.x is
        // the angle around it, carried as an attribute so the fluting never
        // picks up a seam where atan would wrap from +pi to -pi.
        float t = clamp(position.y, 0.0, 1.0);
        vT = t;
        vAngle = uv.x * 6.2831853;
        float r0 = length(position.xz);
        vec2 radial = r0 > 1e-4 ? position.xz / r0 : vec2(1.0, 0.0);
        vec3 p = position;
        p.xz = radial * (r0 * karstProfile(t, s));
        // Off plumb. Local x is scaled by the instance's width, so the shear has
        // to be large here to shift a summit by a visible fraction of its height.
        p.x += (fract(s * 13.77) - 0.5) * uLean * t * t;
        p.z += (fract(s * 17.31) - 0.5) * uLean * 0.8 * t * t;

        // A pillar is scaled ~1:20 by its instance matrix, so a normal built in
        // local space and pushed through that matrix comes out with its vertical
        // component multiplied by twenty — every summit ends up facing straight
        // at the sun and the whole range bleaches white. (Normals want the
        // inverse transpose, not the matrix.) So the slope is converted into the
        // instance's real proportions here, and only its *rotation* is applied.
        float wI = 1.0, hI = 1.0, dI = 1.0;
        #ifdef USE_INSTANCING
          wI = length(instanceMatrix[0].xyz);
          hI = length(instanceMatrix[1].xyz);
          dI = length(instanceMatrix[2].xyz);
        #endif
        float slope = (karstProfile(t + 0.02, s) - karstProfile(t, s)) / 0.02;
        vec2 nrm2 = normalize(vec2(hI, -slope * wI));
        vec3 n = vec3(radial.x * nrm2.x, nrm2.y, radial.y * nrm2.x);

        vec4 localPos = vec4(p, 1.0);
        vec3 localNormal = n;
        #ifdef USE_INSTANCING
          localPos = instanceMatrix * localPos;
          localNormal = mat3(
            instanceMatrix[0].xyz / wI,
            instanceMatrix[1].xyz / hI,
            instanceMatrix[2].xyz / dI
          ) * n;
        #endif
        vec4 world = modelMatrix * localPos;
        vWorldY = world.y;
        vNormalW = normalize(mat3(modelMatrix) * localNormal);
        vViewDir = normalize(cameraPosition - world.xyz);
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uSunColor, uLightColor, uRimColor;
      uniform float uRim, uSun, uFogCap, uStrata, uFoot, uDesat, uBands, uSunPower;
      ${KEY}
      ${HEMI}
      ${FOG}
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying float vWorldY;
      varying float vT;
      varying float vSeed;
      varying float vAngle;
      void main() {
        vec3 n = normalize(vNormalW);
        float ndl = keyResponse(n);
        float ramp = mix(floor(ndl * 3.0) / 3.0, ndl, 0.35);

        // Rock is dark. It reads as rock because of what happens at its edges
        // and its bedding, not because the body is modelled.
        //
        // No shadow lookup and no rim light out here, and both are deliberate:
        // the shadow camera is fitted to the foreground island, and the rim is
        // a light aimed at the cultivator. A range four hundred units away
        // takes the sun and the sky and nothing else.
        vec3 col = uColor * (hemisphere(n) + uLightColor * uSunPower * ramp * 0.85);

        // Bedding planes: horizontal steps, stronger low down where the strata
        // are thicker, and offset per instance so no two pillars share a seam.
        float bed = fract(vT * (7.0 + floor(fract(vSeed * 3.9) * 6.0)) + vSeed * 4.7);
        col *= 1.0 - uStrata * smoothstep(0.62, 0.98, bed) * (1.0 - vT * 0.55);

        // Vertical fluting: the grooves that run a karst wall its whole height.
        float flute = sin(vAngle * 7.0 + vSeed * 30.0) * 0.5 + 0.5;
        col *= 1.0 - 0.12 * flute;

        // The sun on the rock. Two terms, and it matters that they are separate:
        //
        //   the face — the whole sunward flank of the pillar takes warm light,
        //     with a hard step where it turns away. This is what gives a range
        //     its planes, and it is why a mountain reads as carved rather than
        //     as cut from paper. A fresnel rim alone lights two pixels at the
        //     silhouette and leaves the body dead flat.
        //   the edge — a narrow bright line where the surface turns away from
        //     the eye, which keeps a dark pillar from becoming a hole punched
        //     in the sky.
        float ndlRaw = dot(n, normalize(uLightDir));
        float face = smoothstep(0.02, 0.42, ndlRaw);
        col += uSunColor * uColor * face * uSun * 1.2;
        float edge = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 2.4);
        col += uSunColor * edge * smoothstep(-0.1, 0.5, ndlRaw) * uSun * 0.45;
        col += uRimColor * edge * uRim * 0.30;

        col = applyFogCapped(col, vDepth, uFogCap, vWorldY);
        // The foot dissolves into the air, so the range stands *in* the cloud
        // rather than being sliced off by whatever plane happens to be there.
        col = mix(airAt(vWorldY), col, smoothstep(0.0, uFoot, vT));
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------- sky */

/**
 * The sky sphere: three stops, one disc, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what was deliberately taken off it
 *
 * A backdrop is the largest surface in the frame and the one thing every other
 * value is judged against, so it is built out of as few decisions as possible:
 *
 *   - a **three-stop vertical gradient**, zenith → horizon → below-horizon,
 *     all three read from the time-of-day object and nothing else;
 *   - a **sun or moon disc** at the key light's own direction, with a wide soft
 *     halo, so the light in the picture and the light in the sky are the same
 *     light;
 *   - nothing else. The per-pixel dither that keeps a gradient this shallow
 *     from banding lives at the end of the post pass, where the frame is
 *     actually quantised — see the bottom of makePostMaterial;
 *   - stars, and the two realm set-dressings (aurora, golden sea).
 *
 * There is **no texture on the sky**. The fabric-like vertical striping that
 * used to lie over it came from the post pass' paper fibre and is gone from
 * there (see makePostMaterial); the faint vertical seams that survived that
 * came from reading the gradient off `normalize(position)` on a 32-segment
 * sphere, which interpolates a chord where it wants an arc and steps the
 * gradient once per segment. The direction is per-fragment from the camera now,
 * and world.js builds the sphere at twice the resolution.
 *
 * The hardcoded moon is gone too. It hung at a fixed direction — a set piece
 * lit for one hour of one realm — which is exactly the thing this stage exists
 * to stop: the moon is the night's sun now, drawn by the same three lines at
 * the same place the key light stands.
 * ---------------------------------------------------------------------------
 */
export function makeSkyMaterial(env) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: envUniforms(env, {
      // The three stops. All three come from time-of-day.js; `below` is derived
      // there rather than here so the fog, the sky and the water cannot each
      // invent their own version of the same colour.
      uZenith: { value: new THREE.Color('#2b3a52') },
      uHorizon: { value: new THREE.Color('#8fa3b8') },
      uBelow: { value: new THREE.Color('#6e7c96') },
      // The disc, at the key light's direction. `uSunColor` is the day's sun —
      // or its moon, which is the same field with a colder colour in it.
      uSunColor: { value: new THREE.Color('#e8d5c0') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.1, 0.55).normalize() },
      uStars: { value: 0 },
      uAurora: { value: 0 },
      uAuroraColor: { value: new THREE.Color('#4fe8c4') },
      uCloudSea: { value: 0 },
      uStorm: { value: 0 },
    }),
    vertexShader: /* glsl */ `
      varying vec3 vRay;
      void main() {
        // The ray from the eye, not the vertex normal. On a coarse sphere those
        // are different things, and the difference is a visible seam once per
        // segment across a gradient this shallow.
        vec4 world = modelMatrix * vec4(position, 1.0);
        vRay = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uBelow, uSunColor, uSunDir, uAuroraColor;
      uniform float uStars, uAurora, uCloudSea, uTime, uStorm, uDesat;
      ${NOISE}
      varying vec3 vRay;

      // The disc, as two angles. A cosine rather than a distance because that
      // is what a dot product already is, and because it stays exact when the
      // sun is nearly overhead.
      const float DISC_COS = 0.999781;   // cos(1.2°) — the disc's edge
      const float DISC_SOFT = 0.00012;   // ~0.4° of softness on that edge
      const float HALO_COS = 0.788;      // cos(38°) — a wide, soft halo
      const float DISC_POWER = 2.8;      // linear light: the disc is allowed to blow

      void main() {
        vec3 d = normalize(vRay);

        // The bright stop belongs AT the horizon (d.y ~ 0), not at the nadir:
        // a dawn glows along the skyline and darkens toward the zenith.
        //
        // The band is pitched at what the locked camera can actually see. A 45°
        // lens with the horizon at v = 0.45 puts the top of the frame about 20°
        // above horizontal — d.y ~ 0.34 — and the set-piece framings widen that
        // to about 25°. Spread over the 0..0.8 a sky dome usually wants, the
        // whole visible band would come out as one pale grey a few levels wide
        // and the zenith colour would never be reached in play; the exponent
        // packs more of the change into the low sky, where the composition is.
        float up = smoothstep(0.0, 0.46, d.y);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.78));

        // Below the skyline the dome is not sky, it is the far air of the
        // valley seen through everything else. It is the horizon colour with a
        // little of the zenith in it, so the lower third of the frame recedes
        // instead of standing there as one flat plate behind the ranges.
        col = mix(col, uBelow, smoothstep(0.0, -0.12, d.y));

        // Stars: a sparse hash field that twinkles, fading out near the horizon.
        // Driven by the day, not by the realm — they come up through dusk and
        // are still faintly there at first light.
        if (uStars > 0.0) {
          vec2 sp = d.xz / max(abs(d.y) + 0.25, 0.05) * 6.0;
          float s = hash21(floor(sp * 40.0));
          float star = smoothstep(0.9965, 1.0, s);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 90.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.004, 0.075, d.y);
        }

        // The sun, or the moon: one disc at the key light's own bearing and
        // elevation. At noon and at midnight it stands above the top of the
        // frame and only the halo is in shot, which is correct — a camera
        // pointed at a mountain range does not have the noon sun in it.
        float cosA = dot(d, normalize(uSunDir));
        float halo = smoothstep(HALO_COS, 1.0, cosA);
        // The halo is authored *relative to the sky it sits in*. An absolute
        // one is a floodlight at night and invisible at noon: the night sky is
        // two percent of the day sky in linear light, so a glow that reads as a
        // moon there would be nothing at all six hours later.
        col += uSunColor * halo * halo * 0.22 * (0.35 + dot(col, ${LUMA3}) * 2.0);
        float disc = smoothstep(DISC_COS - DISC_SOFT, DISC_COS + DISC_SOFT, cosA);
        col = mix(col, uSunColor * DISC_POWER, disc);

        // Aurora: vertical curtains, slowly breathing. In the realm's own green
        // and never in the accent — the accent is the player's qi, and a sky
        // wearing it makes her light ordinary.
        if (uAurora > 0.0) {
          // Curtains hang from just above the skyline into the low sky — the
          // band the player can actually see — and fade out before the zenith.
          float band = fbm(vec2(d.x * 3.4 + uTime * 0.05, d.y * 5.0 - uTime * 0.02));
          float height = smoothstep(0.01, 0.10, d.y) * smoothstep(0.62, 0.20, d.y);
          float curtain = smoothstep(0.40, 0.80, band) * height;
          float ripple = 0.65 + 0.35 * sin(d.x * 22.0 + uTime * 0.5);
          col += uAuroraColor * curtain * 0.85 * ripple * uAurora;
          col += vec3(0.30, 0.70, 0.95) * curtain * 0.35 * uAurora;
        }

        // The golden sea of clouds at Immortal Ascension.
        if (uCloudSea > 0.0) {
          // Billows below the skyline, bright rims where they catch the light,
          // so the sea reads as cloud and not as more sky.
          vec2 cp = vec2(d.x, d.z) / max(abs(d.y) + 0.06, 0.06);
          float billow = fbm(cp * 0.9 + vec2(uTime * 0.012, 0.0));
          float below = smoothstep(0.10, -0.16, d.y);
          float sea = below * smoothstep(0.30, 0.72, billow);
          float crest = below * smoothstep(0.60, 0.80, billow);
          col = mix(col, vec3(0.92, 0.72, 0.36), sea * 0.85 * uCloudSea);
          col += vec3(1.0, 0.93, 0.68) * crest * 0.40 * uCloudSea;
        }

        // Tribulation: the sky is swallowed and lit only by what is coming.
        if (uStorm > 0.0) {
          float churn = fbm(vec2(d.x * 4.0 + uTime * 0.3, d.z * 4.0 - uTime * 0.22));
          vec3 storm = mix(vec3(0.02, 0.02, 0.035), vec3(0.16, 0.15, 0.22), churn);
          col = mix(col, storm, uStorm);
        }

        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);

        // The dither that keeps this gradient from banding is not here — it is
        // the last line of makePostMaterial, and it has to be. Everything this
        // shader writes is linear light with no ceiling; the staircase appears
        // when the frame is encoded to eight bits, four passes later, and
        // "one 255th" only means one step at that point. Dithering by a flat
        // 1/255 of *linear* here would be half a step at noon and seven steps
        // of visible noise in a night sky.
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* --------------------------------------------------------------- ridges */

/** A flat silhouette layer that dissolves into the fog from its base upward. */
export function makeRidgeMaterial(env, { color = '#39424f', fade = 0.5, grain = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Flat silhouette strips: draw both faces so a winding flip cannot make a
    // whole mountain range disappear.
    side: THREE.DoubleSide,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uFade: { value: fade },
      uGrain: { value: grain },
    }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uFogColor;
      uniform float uFade, uGrain, uDesat, uTime;
      ${NOISE}
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        // uv.y is 0 at the base, 1 at the ridge line. A ridge in ink-wash is
        // dark at the crest and drowns in mist at its foot.
        //
        // It used to drown by fading its *colour* to the fog colour while
        // staying fully opaque, on the reasoning that mist is not a hole. But
        // these strips are painted over everything behind them, and their feet
        // cover the whole lower middle of the frame — so what that actually
        // produced was a flat slab of untextured grey across a third of the
        // picture, sitting on top of the cloud sea it was meant to be standing
        // in. It is the single thing that made the landscape read as dry.
        //
        // So the foot dissolves for real now, raggedly, and the cloud and mist
        // behind it are what fill the valley. There is no void to guard against
        // any more: there is weather back there.
        float wash = fbm(vWorld.xz * 0.06) * uGrain;
        float body = smoothstep(0.0, uFade, vUv.y);
        vec3 col = mix(uFogColor, uColor, clamp(body + wash * 0.35, 0.0, 1.0));
        float alpha = smoothstep(-0.30, 0.72, vUv.y + wash * 0.8);
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/* ---------------------------------------------------------------- water */

/** Sky reflected as a soft vertical smear, broken by slow ripples. */
export function makeWaterMaterial(env) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: envUniforms(env, {
      uTop: { value: new THREE.Color('#2b3440') },
      uHorizon: { value: new THREE.Color('#5b6472') },
      uTint: { value: new THREE.Color('#0f1720') },
    }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uTint;
      uniform float uTime, uDesat;
      ${NOISE}
      ${FOG}
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        // Bright toward the far bank, where it holds the skyline; darker in the
        // near water. Water in a grey valley is the second-lightest thing in the
        // picture after the cloud, so the tint is a hint, not a wash.
        float smear = smoothstep(0.0, 1.0, vUv.y);
        vec3 col = mix(uTop, uHorizon, smear);
        col = mix(col, uTint, 0.28);

        // Horizontal streaks: reflections never hold their shape on water. The
        // frequencies are pitched to the *plane*, not to world units — sampled
        // in the hundreds they alias into a uniform grey and the river reads as
        // paint.
        float ripple = fbm(vec2(vUv.x * 9.0, vUv.y * 46.0 + uTime * 0.18));
        col += vec3(0.10) * smoothstep(0.52, 0.90, ripple) * (0.4 + smear);
        float glint = smoothstep(0.80, 1.0, fbm(vec2(vUv.x * 22.0, vUv.y * 90.0 - uTime * 0.3)));
        col += uHorizon * glint * 0.45;

        col = applyFog(col, vDepth);
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        // Dissolve at every edge: a rectangle of water in a valley gives the
        // whole illusion away, and the banks are meant to be lost in mist.
        float bank = smoothstep(0.0, 0.30, vUv.x) * smoothstep(1.0, 0.70, vUv.x)
                   * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        gl_FragColor = vec4(col, 0.92 * bank);
      }
    `,
  });
}

/* ----------------------------------------------------------------- mist */

/** Vertex-displaced fog bands. Cheap, and the thing that sells the depth. */
export function makeMistMaterial(env, { color = '#8d99a8', opacity = 0.16, speed = 0.02 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
    }),
    vertexShader: /* glsl */ `
      uniform float uTime, uSpeed;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 0.08 + uTime * uSpeed * 6.0) * 1.4;
        p.z += cos(p.x * 0.05 - uTime * uSpeed * 4.0) * 1.1;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uTime, uSpeed, uDesat;
      ${NOISE}
      varying vec2 vUv;
      void main() {
        // Two octaves at different rates so the band billows and separates
        // instead of reading as one flat sheet of grey.
        float n = fbm(vec2(vUv.x * 7.0 + uTime * uSpeed, vUv.y * 3.0));
        n = smoothstep(0.30, 0.72, n) * 0.85 + n * 0.15;
        float edge = smoothstep(0.0, 0.30, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float sides = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
        float a = n * edge * sides * uOpacity;
        vec3 col = mix(uColor, vec3(dot(uColor, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

/* ------------------------------------------------------------ cloud sea */

/**
 * The sea of clouds the peaks rise out of — the single image that says "Mount
 * Hua" faster than any amount of rock, and the brightest thing in the frame.
 *
 * That last part is the whole design. An ink-wash landscape is built on 留白:
 * the unpainted paper is the cloud and the water, and it is what the ink is
 * read against. Cloud tinted toward the haze colour, as this was, is grey on
 * grey — it disappears, and with it the only thing separating one rank of peaks
 * from the next. So the body here is light, the crests are near-white, and the
 * skyline of the deck is cut by the billow field rather than by a gradient: a
 * ruled horizontal edge is what makes peaks look sawn off instead of standing
 * in cloud.
 */
export function makeCloudMaterial(env, {
  opacity = 0.85, scale = 0.06, speed = 0.01, vertical = false, height = 0.62, soft = 0.22,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color('#dde5ee') },
      uCrest: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: opacity },
      uScale: { value: scale },
      uSpeed: { value: speed },
      uVertical: { value: vertical ? 1 : 0 },
      uHeight: { value: height },
      uSoft: { value: soft },
    }),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uCrest, uLightColor;
      uniform float uOpacity, uScale, uSpeed, uTime, uDesat, uVertical, uHeight, uSoft;
      ${NOISE}
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        // A standing band samples x/y so its billows have shape; a flat deck
        // samples x/z. A vertical plane sampled in x/z would only ever be
        // streaks, because z never varies across it.
        vec2 p = (uVertical > 0.5 ? vWorld.xy : vWorld.xz) * uScale
               + vec2(uTime * uSpeed, uTime * uSpeed * 0.4);
        float billow = fbm(p);
        float detail = fbm(p * 2.9 + 11.0);
        float form = billow * 0.72 + detail * 0.28;

        float mass, crest, shade = 1.0;
        if (uVertical > 0.5) {
          // The skyline of the cloud, decided per column by the billow field:
          // below it the deck is solid, above it there is nothing. A soft
          // vertical gradient in its place is a fog bank, not a sea of cloud —
          // and it is that ragged edge, not the body, that makes the peaks read
          // as standing *in* something.
          // Capped below the plane's own top edge: where the billow field runs
          // high the mass would otherwise still be solid at vUv.y = 1 and the
          // deck would end on the rectangle it is drawn on — a hard-edged pale
          // box hanging in the frame.
          float top = min(0.94, uHeight * (0.42 + form * 1.20));
          mass = smoothstep(top, top - uSoft, vUv.y);
          // Crests catch the light just under the skyline; the base sits in its
          // own shadow, which is what gives the sea any volume at all. This
          // shades the cloud — it must not thin it, or the deck's bottom edge
          // becomes a ruled line across the frame at whatever alpha it was left
          // at, which is a worse artefact than the one it was hiding.
          crest = smoothstep(top - uSoft * 2.4, top - uSoft * 0.3, vUv.y) * mass;
          shade = 0.62 + 0.38 * smoothstep(0.0, 0.45, vUv.y);
        } else {
          mass = smoothstep(0.40, 0.70, form);
          crest = smoothstep(0.58, 0.86, billow);
        }

        // Fade at the rim so a plane edge never shows.
        float rim = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);
        rim *= uVertical > 0.5
          ? smoothstep(0.0, 0.09, vUv.y)
          : smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);

        vec3 col = mix(uColor, uCrest, crest * 0.9);

        // Structure inside the mass. The skyline alone is not enough: below it
        // the deck was a single flat fill, so a third of the frame came out as
        // one unbroken pale grey and the sea read as a wall of fog with a
        // decorative edge. A second octave breaks the body into separate
        // billows — brightness through it, and thin gaps where it parts.
        float inner = fbm(p * 2.4 + 5.0);
        col *= 0.80 + 0.36 * inner;
        mass *= 0.70 + 0.30 * smoothstep(0.24, 0.62, inner);

        // A touch of the realm's own light on the crests, so the sea belongs to
        // the sky above it instead of reading as a white cut-out.
        col *= shade * (0.88 + 0.20 * uLightColor * crest);
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, clamp(mass, 0.0, 1.0) * rim * uOpacity);
      }
    `,
  });
}

/* ------------------------------------------------------------- waterfall */

/** A thread of water falling into cloud: scrolling streaks, soft at both ends. */
export function makeFallMaterial(env, { color = '#cfe0ea', opacity = 0.42, fogCap = 0.30 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uFogCap: { value: fogCap },
    }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uTime, uDesat, uFogCap;
      ${NOISE}
      ${FOG}
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        // Streaks run down the ribbon far faster than they wander sideways.
        float streak = fbm(vec2(vUv.x * 9.0, vUv.y * 2.2 - uTime * 0.55));
        // A tighter threshold breaks the sheet into separate threads of water
        // instead of one solid bright bar.
        float body = smoothstep(0.46, 0.86, streak);
        // Narrow at the lip, spreading and dissolving into the cloud below.
        float sides = smoothstep(0.0, 0.30, vUv.x) * smoothstep(1.0, 0.70, vUv.x);
        float head = smoothstep(0.0, 0.10, 1.0 - vUv.y);
        float foot = smoothstep(0.0, 0.42, vUv.y);
        // Barely fogged: falling water is the brightest thing in a grey valley,
        // and at this distance full aerial perspective erased it completely.
        vec3 col = applyFogCapped(uColor, vDepth, uFogCap);
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, body * sides * head * foot * uOpacity);
      }
    `,
  });
}

/* ----------------------------------------------------------------- glow */

/** Additive fresnel shell — auras, halos, the qi column, artifact light. */
export function makeGlowMaterial(env, {
  color = '#35c98e', power = 2.2, strength = 0.9,
  // A fresnel shell is right for an aura and wrong for a light source: it is
  // brightest at the silhouette and empty in the middle, so lanterns and coals
  // came out as rings. `core` fills the centre back in.
  core = 0,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uStrength: { value: strength },
      uPulse: { value: 0 },
      uCore: { value: core },
    }),
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        ${INSTANCE_VERT}
        vUv = uv;
        vec4 world = modelMatrix * localPos;
        vNormalW = normalize(mat3(modelMatrix) * localNormal);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower, uStrength, uPulse, uTime, uDesat, uCore;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
        float f = pow(1.0 - facing, uPower);
        // Mix the rim term toward a solid disc as uCore rises.
        f = mix(f, max(f, pow(facing, 0.6)), uCore);
        float pulse = 1.0 + uPulse * sin(uTime * 3.0) * 0.35;
        vec3 col = uColor * f * uStrength * pulse;
        col = mix(col, vec3(dot(col, ${LUMA3})), uDesat * 0.7);
        gl_FragColor = vec4(col, clamp(f * uStrength * pulse, 0.0, 1.0));
      }
    `,
  });
}

/* ------------------------------------------------------------ particles */

/** Point swarm: qi motes, sparks, falling leaves, spirit motes. */
export function makeParticleMaterial(env, { color = '#35c98e', size = 7, additive = true } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uFade: { value: 1 },
      uPixelRatio: { value: 1 },
    }),
    vertexShader: /* glsl */ `
      uniform float uSize, uPixelRatio;
      attribute float aScale;
      attribute float aSeed;
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vAlpha = clamp(1.0 - (-mv.z) / 260.0, 0.0, 1.0);
        // Sized against a ~14-unit reference distance, so motes stay motes
        // instead of becoming screen-filling blobs when the camera comes in.
        gl_PointSize = uSize * aScale * uPixelRatio * (14.0 / max(-mv.z, 2.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade, uDesat;
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        // A mote of qi is a spark, not a smudge. A single smoothstep across the
        // whole sprite is a gaussian blob, and a few hundred additive gaussians
        // are indistinguishable from dirt on the lens — the picture behind them
        // stops being legible and the whole frame reads as soft focus. A tight
        // core with a much fainter halo keeps the light and drops the haze.
        float core = smoothstep(0.42, 0.24, d);
        float halo = smoothstep(0.5, 0.0, d);
        float a = (core + halo * halo * 0.30) * uFade * vAlpha;
        vec3 col = mix(uColor, vec3(dot(uColor, ${LUMA3})), uDesat);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
  });
}

/* ------------------------------------------------------------- rune ring */

/**
 * The tribulation timing widget. A dashed rune band, a golden window arc whose
 * *angular width is literally the success chance*, and a marker sweeping it at
 * constant speed — so a tap at an arbitrary moment lands inside exactly that
 * often. The maths and the picture are the same object.
 */
export function makeRuneRingMaterial(env) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: envUniforms(env, {
      uWindow: { value: 0.5 },   // window width, in turns
      uMarker: { value: 0.0 },   // marker position, in turns
      uActive: { value: 0.0 },
      uColor: { value: new THREE.Color('#e8b34b') },
      uIdle: { value: new THREE.Color('#35c98e') },
      uFlash: { value: 0.0 },
    }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWindow, uMarker, uActive, uTime, uFlash;
      uniform vec3 uColor, uIdle;
      varying vec2 vUv;
      void main() {
        float t = vUv.x;                       // 0..1 around the ring
        float band = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);

        // dashed rune ticks
        float ticks = step(0.55, fract(t * 48.0));
        vec3 col = uIdle * (0.25 + 0.35 * ticks);
        float a = band * (0.30 + 0.25 * ticks);

        if (uActive > 0.0) {
          // the golden window, centred on 0.5 turns
          float d = abs(fract(t - 0.5 + 0.5) - 0.5);
          float inWin = step(d, uWindow * 0.5);
          col = mix(col, uColor, inWin * 0.95);
          a = mix(a, band * 0.85, inWin);

          // the sweeping marker
          float md = abs(fract(t - uMarker + 0.5) - 0.5);
          float mark = smoothstep(0.012, 0.0, md);
          col += vec3(1.0, 0.98, 0.92) * mark * 2.2;
          a = max(a, mark * band);
        }
        col += uColor * uFlash;
        a = max(a, uFlash * band);
        gl_FragColor = vec4(col, a * uActive * 0.85 + a * (1.0 - uActive) * 0.4);
      }
    `,
  });
}

/* --------------------------------------------------------------- post FX */

/**
 * A colour that is already a pixel.
 *
 * Every other hex in this renderer describes light and is converted into the
 * linear working space on the way in. The two the post pass mixes in after the
 * curve describe the finished frame instead, so they take no conversion at
 * all — `NoColorSpace` is how you say that to three.
 */
export function displayColor(hex) {
  return new THREE.Color().setStyle(hex, THREE.NoColorSpace);
}

/**
 * The last pass in the composer: tone map, then grade.
 *
 * ---------------------------------------------------------------------------
 * Where the pipeline turns from light into pixels
 *
 * Everything upstream of here — the scene, and the bloom taken off it — is
 * linear light with no ceiling: a lit summit and a spark of qi are allowed to
 * be four and forty, because that is what makes a bloom threshold at 0.85 mean
 * anything. Nothing has been clamped, and nothing may be, until this pass.
 *
 * So this is where exposure is applied, where ACES rolls the top end off into
 * white instead of clipping it flat, and where the result is encoded to sRGB
 * for the glass. `renderer.toneMapping` is set to ACESFilmic to say so out
 * loud, but it drives no built-in material here — every material in this file
 * writes gl_FragColor by hand — so the curve is written out below and the
 * exposure is read off `renderer.toneMappingExposure` each frame, which keeps
 * one dial for the time-of-day grade to turn.
 *
 * After that: paper, the tribulation darken, the vignette, the rebirth
 * dissolve, the flash, and the QA grayscale. All of those are display-referred
 * and all of them belong after the curve.
 * ---------------------------------------------------------------------------
 */
export function makePostMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      /** Kept in step with renderer.toneMappingExposure by the view. */
      uExposure: { value: 1 },
      // Paper, not film: 2% is the ceiling the stage-1 post stack allows, and
      // it was 5.5% when the frame had no tone curve to carry the texture.
      uGrain: { value: 0.02 },
      uVignette: { value: 0.35 },
      // ACES has its own shoulder and toe now, so the hand S-curve that used to
      // do all of that work is down to a light touch on the midtones.
      uContrast: { value: 0.10 },
      uDissolve: { value: 0 },
      uDarken: { value: 0 },
      uFlash: { value: 0 },
      // Display-referred, both of them: they are mixed in *after* the tone
      // curve and the sRGB encode, so they are already the pixels they want to
      // be. Everything else in the renderer is a colour management conversion
      // away from linear light; these two must not be, or the rebirth ink and
      // the tribulation flash come out at 40% of what they were painted.
      uFlashColor: { value: displayColor('#ffffff') },
      uInk: { value: displayColor('#0b0e12') },
      // Debug only, and off in every shipped frame: see setGrayscale().
      uGrayscale: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform vec3 uInk, uFlashColor;
      uniform float uTime, uGrain, uVignette, uDissolve, uFlash, uDarken, uContrast, uGrayscale;
      uniform float uExposure;
      ${NOISE}
      ${ACES}
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        vec2 px = vUv * uResolution;

        // Scene-referred light in, display-referred colour out. Everything
        // below this line is working on pixels, not on photons.
        col = linearToSRGB(acesFilmic(col * uExposure));

        // The ink curve. A landscape built on a small number of well-separated
        // values needs those values to stay separated all the way to the glass;
        // without this the whole frame settles into one mid-grey band and reads
        // as soft focus rather than as atmosphere. An S-curve about 0.5 opens
        // the gap between the peaks and the cloud they stand in without
        // touching either end.
        col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);

        // Paper: the tooth, and only the tooth. Static, not noise that crawls —
        // crawling grain reads as video, not paper. Kept faint: laid on heavily
        // it is a veil over the whole picture, and a veil is indistinguishable
        // from being out of focus.
        //
        // The two *fibre* octaves that used to sit here are gone. They were two
        // anisotropic fbms — one stretched along x, one along y — which is a
        // woven texture, and a woven texture over a flat sky is a sheet of
        // fabric hanging behind the mountains. It cost nothing to see on the
        // rock, where there is form to hide it, and it was the most obvious
        // thing in the frame everywhere the picture was smooth. The sky owns its
        // own smoothness now (a dither, in makeSkyMaterial), and nothing is laid
        // over it.
        float tooth = hash21(floor(px * 1.6));
        col *= 1.0 - uGrain * (1.0 - tooth);
        col += uGrain * 0.05 * tooth;

        // The heavens taking the light out of the world. Applied before the
        // flash so a successful strike still blows the frame white.
        col *= 1.0 - uDarken;

        // Vignette — the wash pools at the edges of the paper. Gentle, and
        // starting well outside the frame: the old one began falling off at a
        // third of the way out from centre, which put a quarter of every
        // composition into shadow it was never lit for.
        float v = distance(vUv, vec2(0.5));
        col *= mix(1.0, smoothstep(1.05, 0.44, v), uVignette);

        // Rebirth: the world runs to ink from the outside in. The edge term is 1
        // at the centre and 0 in the corners, so the wipe closes inward, with a
        // little noise on the front so it reads as ink and not as an iris.
        if (uDissolve > 0.0) {
          float n = fbm(vUv * 4.0 + uTime * 0.05) * 0.28;
          float edge = 1.0 - clamp(v / 0.72, 0.0, 1.0);
          float t = smoothstep(edge - 0.20, edge + 0.08, uDissolve * (1.0 + n));
          col = mix(col, uInk, clamp(t, 0.0, 1.0));
        }

        col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));

        // QA: the frame as pure value, nothing else. Dead last, after grain,
        // vignette and flash, because the question it answers is "does the
        // finished picture read", and the answer has to include everything the
        // player will actually be looking at. Rec. 601 weights, shared with
        // luminance() in palette.js so the eye and the test suite measure the
        // same thing.
        if (uGrayscale > 0.0) {
          float luma = dot(col, vec3(${LUMA[0]}, ${LUMA[1]}, ${LUMA[2]}));
          col = mix(col, vec3(luma), clamp(uGrayscale, 0.0, 1.0));
        }

        // Dither, per pixel, dead last — after the grayscale, because this is
        // about the eight bits the frame is about to be written into and
        // nothing else.
        //
        // The sky is a gradient of perhaps sixty levels spread over eight
        // hundred pixels of phone screen. Quantised straight it comes out as a
        // staircase of flat bands ten pixels deep, and it gets *worse* the
        // better the sky gets, because a smoother ramp means wider bands. A
        // night sky was holding one level for forty rows at a time.
        //
        // Half a step of white noise breaks the step boundary into a dither
        // pattern the eye integrates back to the value that was asked for. It
        // belongs here and only here: this is the one line in the renderer
        // where the picture stops being light and becomes a number between 0
        // and 255, so this is the one place where 1/255 is a step.
        col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
