// Ink-wash shading kit.
//
// Everything here is authored GLSL — no stock PBR, no textures, no downloads.
// A shared `env` uniform bundle is passed by reference into every material, so
// one realm transition re-lights the whole world at once.

import * as THREE from 'three';

/* ------------------------------------------------------------ GLSL chunks */

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

// Distance fog, applied by hand so it matches the sky gradient exactly.
export const FOG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 color, float depth) {
    float f = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    return mix(color, uFogColor, clamp(f, 0.0, 1.0));
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
  transparent = false, opacity = 1,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: envUniforms(env, {
      uColor: { value: new THREE.Color(color) },
      uRim: { value: rim },
      uEmissive: { value: emissive },
      uOpacity: { value: opacity },
      uBandsOverride: { value: bands === null ? -1 : bands },
    }),
    transparent,
    flatShading: flat,
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec3 vLocal;
      void main() {
        ${INSTANCE_VERT}
        vLocal = localPos.xyz;
        vec4 world = modelMatrix * localPos;
        vNormalW = normalize(mat3(modelMatrix) * localNormal);
        vViewDir = normalize(cameraPosition - world.xyz);
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uLightDir, uLightColor, uAmbient, uRimColor;
      uniform float uRim, uEmissive, uOpacity, uBands, uBandsOverride, uDesat;
      ${FOG}
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec3 vLocal;
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

        col = applyFog(col, vDepth);
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat);
        gl_FragColor = vec4(col, uOpacity);
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
      uniform vec3 uTop, uMid, uHorizon, uAccent;
      uniform float uStars, uAurora, uMoon, uCloudSea, uTime, uStorm, uDesat;
      ${NOISE}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // The bright stop belongs AT the horizon (d.y ~ 0), not at the nadir:
        // a dawn glows along the skyline and darkens toward the zenith.
        vec3 col;
        if (d.y >= 0.0) {
          col = mix(uHorizon, uMid, smoothstep(0.0, 0.30, d.y));
          col = mix(col, uTop, smoothstep(0.22, 0.80, d.y));
        } else {
          col = mix(uHorizon, uMid, smoothstep(0.0, -0.45, d.y));
        }
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

        // Stars: a sparse hash field that twinkles, fading out near the horizon.
        if (uStars > 0.0) {
          vec2 sp = d.xz / max(abs(d.y) + 0.25, 0.05) * 6.0;
          float s = hash21(floor(sp * 40.0));
          float star = smoothstep(0.9965, 1.0, s);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 90.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.05, 0.5, d.y);
        }

        // The great moon of Spirit Severing.
        if (uMoon > 0.0) {
          vec3 md = normalize(vec3(-0.45, 0.42, -0.78));
          float dd = distance(d, md);
          float disc = smoothstep(0.16, 0.135, dd);
          float halo = smoothstep(0.55, 0.0, dd) * 0.25;
          col = mix(col, vec3(0.96, 0.94, 0.86), disc * uMoon);
          col += vec3(0.7, 0.75, 0.8) * halo * uMoon;
        }

        // Aurora: vertical curtains of accent light, slowly breathing.
        if (uAurora > 0.0) {
          float band = fbm(vec2(d.x * 3.0 + uTime * 0.05, d.y * 2.0 - uTime * 0.02));
          float curtain = smoothstep(0.45, 0.85, band) * smoothstep(-0.05, 0.55, d.y);
          col += uAccent * curtain * 0.55 * uAurora;
          col += vec3(0.35, 0.75, 0.95) * curtain * 0.2 * uAurora;
        }

        // The golden sea of clouds at Immortal Ascension.
        if (uCloudSea > 0.0) {
          float band = fbm(vec2(d.x * 2.2 + uTime * 0.015, d.z * 2.2)) ;
          float sea = smoothstep(0.35, 0.0, abs(d.y - 0.02)) * band;
          col = mix(col, vec3(1.0, 0.82, 0.45), sea * 0.75 * uCloudSea);
        }

        // Tribulation: the sky is swallowed and lit only by what is coming.
        if (uStorm > 0.0) {
          float churn = fbm(vec2(d.x * 4.0 + uTime * 0.3, d.z * 4.0 - uTime * 0.22));
          vec3 storm = mix(vec3(0.02, 0.02, 0.035), vec3(0.16, 0.15, 0.22), churn);
          col = mix(col, storm, uStorm);
        }

        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat);
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
        // uv.y is 0 at the base, 1 at the ridge line.
        // A ridge in ink-wash is dark at the crest and drowns in bright mist at
        // its foot — the mist is opaque, not a hole. Fading the base to
        // transparent instead leaves a black void where the valley should be.
        float body = smoothstep(0.0, uFade, vUv.y);
        float wash = fbm(vWorld.xz * 0.06) * uGrain;
        vec3 col = mix(uFogColor, uColor, clamp(body + wash * 0.35, 0.0, 1.0));
        // Only the last sliver at the very bottom softens, so the strip never
        // ends on a hard horizontal cut.
        float alpha = smoothstep(0.0, 0.05, vUv.y);
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat);
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
        float smear = smoothstep(0.0, 1.0, vUv.y);
        vec3 col = mix(uHorizon, uTop, smear);
        col = mix(col, uTint, 0.45);

        // Horizontal streaks: reflections never hold their shape on water.
        float ripple = fbm(vec2(vWorld.x * 0.25, vWorld.z * 1.6 + uTime * 0.25));
        col += vec3(0.12) * smoothstep(0.55, 0.9, ripple) * (1.0 - smear);
        float glint = smoothstep(0.86, 1.0, fbm(vec2(vWorld.x * 0.7, vWorld.z * 3.0 - uTime * 0.4)));
        col += vec3(0.35, 0.42, 0.45) * glint * 0.35;

        col = applyFog(col, vDepth);
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat);
        gl_FragColor = vec4(col, 0.92);
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
        float n = fbm(vec2(vUv.x * 4.0 + uTime * uSpeed, vUv.y * 2.5));
        float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        float sides = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = n * edge * sides * uOpacity;
        vec3 col = mix(uColor, vec3(dot(uColor, vec3(0.299, 0.587, 0.114))), uDesat);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

/* ----------------------------------------------------------------- glow */

/** Additive fresnel shell — auras, halos, the qi column, artifact light. */
export function makeGlowMaterial(env, { color = '#35c98e', power = 2.2, strength = 0.9 } = {}) {
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
      uniform float uPower, uStrength, uPulse, uTime, uDesat;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), uPower);
        float pulse = 1.0 + uPulse * sin(uTime * 3.0) * 0.35;
        vec3 col = uColor * f * uStrength * pulse;
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat * 0.7);
        gl_FragColor = vec4(col, f * uStrength * pulse);
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
        float a = smoothstep(0.5, 0.0, d) * uFade * vAlpha;
        vec3 col = mix(uColor, vec3(dot(uColor, vec3(0.299, 0.587, 0.114))), uDesat);
        gl_FragColor = vec4(col, a);
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
      uGrain: { value: 0.10 },
      uVignette: { value: 0.9 },
      uDissolve: { value: 0 },
      uDarken: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color('#ffffff') },
      uInk: { value: new THREE.Color('#0b0e12') },
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
      uniform float uTime, uGrain, uVignette, uDissolve, uFlash, uDarken;
      ${NOISE}
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        vec2 px = vUv * uResolution;

        // Paper: long fibres one way, a fine tooth the other. Static, not noise
        // that crawls — crawling grain reads as video, not paper.
        float fibre = fbm(vec2(px.x * 0.010, px.y * 0.22)) * 0.6
                    + fbm(vec2(px.x * 0.20, px.y * 0.011)) * 0.4;
        float tooth = hash21(floor(px * 0.75));
        col *= 1.0 - uGrain * (0.55 * (1.0 - fibre) + 0.45 * (1.0 - tooth));
        col += uGrain * 0.05 * fibre;

        // The heavens taking the light out of the world. Applied before the
        // flash so a successful strike still blows the frame white.
        col *= 1.0 - uDarken;

        // Vignette — the wash always pools at the edges of the paper.
        float v = distance(vUv, vec2(0.5));
        col *= mix(1.0, smoothstep(0.92, 0.30, v), uVignette);

        // Rebirth: the world runs to ink from the outside in.
        if (uDissolve > 0.0) {
          float edge = fbm(vUv * 5.0 + uTime * 0.1) * 0.35 + v * 1.1;
          col = mix(col, uInk, clamp(smoothstep(uDissolve - 0.25, uDissolve + 0.05, 1.0 - edge + uDissolve), 0.0, 1.0) * step(0.001, uDissolve));
          col = mix(col, uInk, smoothstep(0.75, 1.0, uDissolve));
        }

        col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
