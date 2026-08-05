// Seeded 3D simplex noise, and the ridged fractal the granite is carved with.
//
// ---------------------------------------------------------------------------
// Why simplex, and why ridged
//
// The value noise in shaders.js is fine for mist and paper: it is smooth, cheap,
// and its job is to be a wash. Rock is the opposite problem. A mountain is not a
// smooth field with bumps on it — it is a set of *creases*, and the eye reads a
// silhouette almost entirely off where those creases run. Displacing a column by
// ordinary fractal noise gives a melted candle, which is exactly what the first
// range was: a smooth taper with a smooth wobble, repeated.
//
// `1 - |noise|` is the whole fix, and it is one line. Absolute value folds the
// field at every zero crossing, so where the noise passed smoothly through zero
// there is now a sharp ridge; subtracting from one turns those folds into the
// *high* ground. Two octaves is enough — the first sets where the ribs run, the
// second breaks them so they do not read as fluting on a column. A third octave
// only adds noise at a frequency the flat-shaded facets cannot resolve anyway.
//
// Simplex rather than value noise because the folds have to be isotropic. Value
// noise is built on a square lattice and its gradient is largest along the axes,
// so `1 - |value|` creases along x and z and the ribs come out in a grid — which
// on a near-cylindrical peak means four ribs, at the compass points, on every
// rock in the range. Simplex is built on a simplex lattice with no such axis
// preference, and the ribs run where the seed puts them.
//
// Pure: no Three.js, no DOM. `tests/run.js` imports this file and holds the
// field to its own contract — deterministic from a seed, in range, and actually
// creased rather than merely bumpy.
// ---------------------------------------------------------------------------

import { mulberry32 } from '../rng.js';

/** The twelve mid-edge gradients of a cube. Standard simplex table. */
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F3 = 1 / 3;
const G3 = 1 / 6;

/**
 * A 3D simplex noise field, seeded. Returns a function of (x, y, z) in about
 * [-1, 1], continuous everywhere and with no lattice direction of its own.
 *
 * The permutation table is shuffled with the same mulberry32 the rest of the
 * game uses, so a seed reproduces a mountain exactly — across machines, across
 * sessions, and in Node with no renderer present.
 */
export function makeNoise3(seed = 1) {
  const rand = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  return function noise3(xin, yin, zin) {
    // Skew into the simplex lattice and find the cell.
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    // Which of the six tetrahedra of the cell we are in, as two corner offsets.
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
    }
    return 32 * n;
  };
}

/**
 * Ridged fractal noise: `1 - |noise(p * freq)|`, summed over octaves.
 *
 * Returns 0..1, and it is *not* a bell curve — the distribution piles up near 1
 * along the folds and falls away between them, which is the point. Two octaves
 * is the default because that is what the peaks are carved with; the second is
 * offset in the lattice as well as scaled, or both octaves fold in the same
 * places and the crease only gets deeper instead of getting broken.
 */
export function ridged3(noise, x, y, z, { freq = 1, octaves = 2, lacunarity = 2.13, gain = 0.55 } = {}) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let f = freq;
  let ox = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (1 - Math.abs(noise(x * f + ox, y * f + ox * 0.7, z * f - ox * 1.3)));
    norm += amp;
    f *= lacunarity;
    amp *= gain;
    ox += 17.31;
  }
  return sum / norm;
}

/**
 * Ordinary fractal noise, 0..1. The terrain's own field: land is not made of
 * creases the way a peak is, and a ridged valley floor reads as crumpled paper.
 */
export function fbm3(noise, x, y, z, { freq = 1, octaves = 3, lacunarity = 2.07, gain = 0.5 } = {}) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let f = freq;
  let ox = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f + ox, y * f, z * f - ox);
    norm += amp;
    f *= lacunarity;
    amp *= gain;
    ox += 31.7;
  }
  return (sum / norm) * 0.5 + 0.5;
}
