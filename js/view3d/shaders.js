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
// Air is not one colour. Mixing every distant surface toward a single grey is
// what flattens a landscape into a decal: a summit high in the frame and a foot
// down in the valley converge on the same value, and the range stops sitting
// *in* anything. Real air is bright and warm along the skyline and colder
// overhead, so `airAt` returns the colour of the air at a given world height and
// everything hazes toward that instead.
//
// `cap` is the most haze a surface is allowed to take. Exponential-squared fog
// is total by about 400 units, which is right for mist and wrong for a range of
// mountains: an ink-wash horizon is pale, not absent. Capping a distant rank
// leaves it a few percent darker than the air it stands in, which is the whole
// of how depth reads in a painting with no texture and no atmosphere model.
export const FOG = /* glsl */ `
  uniform vec3 uFogColor;   // air along the skyline — the bright end
  uniform vec3 uFogHigh;    // air up where the summits are
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

/** One bundle, shared by reference. Mutate `.value` and the world re-lights. */
export function createEnv() {
  return {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
    uLightColor: { value: new THREE.Color('#fff2dc') },
    uAmbient: { value: new THREE.Color('#2a3340') },
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
    uAmbient: env.uAmbient,
    uFogColor: env.uFogColor,
    uFogHigh: env.uFogHigh,
    uFogDensity: env.uFogDensity,
    uRimColor: env.uRimColor,
    uDesat: env.uDesat,
    uBands: env.uBands,
  }, extra);
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
    uniforms: envUniforms(env, {
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
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uLightDir, uLightColor, uAmbient, uRimColor;
      uniform float uRim, uEmissive, uOpacity, uBands, uBandsOverride, uDesat, uFogCap;
      ${FOG}
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec3 vLocal;
      varying float vWorldY;
      void main() {
        vec3 n = normalize(vNormalW);
        float ndl = dot(n, normalize(uLightDir)) * 0.5 + 0.5;
        float bands = uBandsOverride > 0.0 ? uBandsOverride : uBands;
        float ramp = floor(ndl * bands) / bands;
        ramp = mix(ramp, ndl, 0.25); // keep a little softness in the step

        vec3 col = uColor * (uAmbient + uLightColor * ramp);
        float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.0);
        col += uRimColor * rim * uRim;
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
      uniform vec3 uColor, uSunColor, uLightDir, uLightColor, uAmbient, uRimColor;
      uniform float uRim, uSun, uFogCap, uStrata, uFoot, uDesat, uBands;
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
        float ndl = dot(n, normalize(uLightDir)) * 0.5 + 0.5;
        float ramp = mix(floor(ndl * 3.0) / 3.0, ndl, 0.35);

        // Rock is dark. It reads as rock because of what happens at its edges
        // and its bedding, not because the body is modelled.
        vec3 col = uColor * (uAmbient + uLightColor * ramp * 0.85);

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

/** A vertical three-stop gradient with optional stars, moon, aurora, clouds. */
export function makeSkyMaterial(env) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: envUniforms(env, {
      uTop: { value: new THREE.Color('#12161d') },
      uMid: { value: new THREE.Color('#2b3440') },
      uHorizon: { value: new THREE.Color('#5b6472') },
      uStars: { value: 0 },
      uAurora: { value: 0 },
      uMoon: { value: 0 },
      uCloudSea: { value: 0 },
      uAccent: { value: new THREE.Color('#35c98e') },
      uStorm: { value: 0 },
    }),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uAccent, uFogColor;
      uniform float uStars, uAurora, uMoon, uCloudSea, uTime, uStorm, uDesat;
      ${NOISE}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // The bright stop belongs AT the horizon (d.y ~ 0), not at the nadir:
        // a dawn glows along the skyline and darkens toward the zenith.
        //
        // The stops are packed hard against the skyline because of what the
        // authored camera actually sees. It looks out and slightly *down* from
        // a high shelf, so the top of the frame is only about eight degrees
        // above horizontal — d.y never exceeds 0.14. Spread over the 0..0.8
        // that a sky dome usually wants, the entire visible band came out as a
        // single pale grey a few levels wide, the palette's top stop was never
        // reached in play, and the picture lost its darkest field. Compressed to
        // here, the same three stops give a hundred levels of gradient inside
        // the frame the game is composed for.
        vec3 col;
        if (d.y >= 0.0) {
          col = mix(uHorizon, uMid, smoothstep(-0.010, 0.175, d.y));
          col = mix(col, uTop, smoothstep(0.100, 0.420, d.y));
        } else {
          // Below the skyline the dome is not sky, it is the far air of the
          // valley seen through everything else. Keeping it in the haze colour
          // gives the cloud and the ranges something bright to stand in.
          col = mix(uHorizon, uFogColor, smoothstep(0.0, -0.10, d.y));
        }
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

        // Stars: a sparse hash field that twinkles, fading out near the horizon.
        // The fade is over the same compressed band — pitched at the old 0.05
        // to 0.5 it left the starry realms with about a tenth of a star.
        if (uStars > 0.0) {
          vec2 sp = d.xz / max(abs(d.y) + 0.25, 0.05) * 6.0;
          float s = hash21(floor(sp * 40.0));
          float star = smoothstep(0.9965, 1.0, s);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 90.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.004, 0.075, d.y);
        }

        // The great moon of Spirit Severing.
        if (uMoon > 0.0) {
          // Low enough to sit inside the authored frame, and small enough to
          // read as a moon rather than a blown-out lamp.
          // Low enough to rise from behind the far ranges, and with a halo
          // tight enough to read as a moon instead of an overexposed lamp.
          vec3 md = normalize(vec3(-0.52, 0.062, -0.86));
          float dd = distance(d, md);
          float disc = smoothstep(0.048, 0.036, dd);
          float rim  = smoothstep(0.060, 0.046, dd) - disc;
          float halo = smoothstep(0.185, 0.0, dd);
          col += vec3(0.52, 0.58, 0.70) * halo * halo * 0.20 * uMoon;
          col = mix(col, vec3(0.80, 0.80, 0.74), disc * 0.85 * uMoon);
          col += vec3(0.26, 0.29, 0.34) * rim * uMoon;
        }

        // Aurora: vertical curtains of accent light, slowly breathing.
        if (uAurora > 0.0) {
          // Curtains hang from just above the skyline into the low sky — the
          // band the player can actually see — and fade out before the zenith.
          float band = fbm(vec2(d.x * 3.4 + uTime * 0.05, d.y * 5.0 - uTime * 0.02));
          float height = smoothstep(0.01, 0.10, d.y) * smoothstep(0.62, 0.20, d.y);
          float curtain = smoothstep(0.40, 0.80, band) * height;
          float ripple = 0.65 + 0.35 * sin(d.x * 22.0 + uTime * 0.5);
          col += uAccent * curtain * 0.85 * ripple * uAurora;
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
 * The whole frame, once: paper fibre, vignette, ink dissolve for rebirth, and
 * a global grade. One pass — anything more is a frame-rate tax on a phone.
 */
export function makePostMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uGrain: { value: 0.055 },
      uVignette: { value: 0.42 },
      uContrast: { value: 0.30 },
      uDissolve: { value: 0 },
      uDarken: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color('#ffffff') },
      uInk: { value: new THREE.Color('#0b0e12') },
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
      ${NOISE}
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        vec2 px = vUv * uResolution;

        // The ink curve. A landscape built on a small number of well-separated
        // values needs those values to stay separated all the way to the glass;
        // without this the whole frame settles into one mid-grey band and reads
        // as soft focus rather than as atmosphere. An S-curve about 0.5 opens
        // the gap between the peaks and the cloud they stand in without
        // touching either end.
        col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);

        // Paper: long fibres one way, a fine tooth the other. Static, not noise
        // that crawls — crawling grain reads as video, not paper. Kept faint:
        // laid on heavily it is a veil over the whole picture, and a veil is
        // indistinguishable from being out of focus.
        float fibre = fbm(vec2(px.x * 0.016, px.y * 0.42)) * 0.6
                    + fbm(vec2(px.x * 0.38, px.y * 0.018)) * 0.4;
        float tooth = hash21(floor(px * 1.6));
        col *= 1.0 - uGrain * (0.55 * (1.0 - fibre) + 0.45 * (1.0 - tooth));
        col += uGrain * 0.05 * fibre;

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

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
