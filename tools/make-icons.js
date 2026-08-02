#!/usr/bin/env node
// Generates the PWA icons. No image libraries, no checked-in binaries that
// nobody can regenerate — just a tiny PNG encoder over zlib, which ships with
// Node. Run `npm run icons` after changing the mark.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of size w*h*4 -> PNG buffer. */
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- mark */

const INK = [0x0b, 0x0e, 0x12];
const JADE = [0x35, 0xc9, 0x8e];
const GOLD = [0xe8, 0xb3, 0x4b];
const MIST = [0x2b, 0x34, 0x40];
const FAR = [0x1a, 0x20, 0x29];

const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/**
 * The mark: three ink ridges under a gold moon, with a jade wash at the base.
 * `inset` leaves the safe area a maskable icon needs.
 */
function drawIcon(size, inset = 0) {
  const px = Buffer.alloc(size * size * 4);
  const s = size;
  const pad = s * inset;
  const inner = s - pad * 2;

  const put = (x, y, rgb, a = 255) => {
    const i = (y * s + x) * 4;
    const src = [rgb[0], rgb[1], rgb[2]];
    if (a >= 255) {
      px[i] = src[0]; px[i + 1] = src[1]; px[i + 2] = src[2]; px[i + 3] = 255;
    } else {
      const t = a / 255;
      px[i] = Math.round(px[i] * (1 - t) + src[0] * t);
      px[i + 1] = Math.round(px[i + 1] * (1 - t) + src[1] * t);
      px[i + 2] = Math.round(px[i + 2] * (1 - t) + src[2] * t);
      px[i + 3] = 255;
    }
  };

  // Sky: a vertical wash from ink to a paler mist at the horizon.
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const inBox = x >= pad && x < s - pad && y >= pad && y < s - pad;
      if (!inBox) { put(x, y, INK); continue; }
      const t = (y - pad) / inner;
      put(x, y, lerp(INK, MIST, Math.pow(t, 1.4) * 0.85));
    }
  }

  // The moon.
  const mx = pad + inner * 0.68;
  const my = pad + inner * 0.30;
  const mr = inner * 0.115;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d < mr) put(x, y, GOLD);
      else if (d < mr * 2.6) put(x, y, GOLD, Math.round(70 * (1 - (d - mr) / (mr * 1.6))));
    }
  }

  // Three ridges, painted far to near so the nearest silhouette wins. A
  // triangle wave gives creased peaks; a sine gives hills, which is wrong.
  const tri = (u) => 1 - 2 * Math.abs(((u % 1) + 1) % 1 - 0.5);
  const ridges = [
    { base: 0.60, amp: 0.20, freq: 1.7, phase: 0.35, color: lerp(MIST, INK, 0.30) },
    { base: 0.72, amp: 0.24, freq: 1.1, phase: 2.10, color: lerp(MIST, INK, 0.66) },
    { base: 0.85, amp: 0.26, freq: 0.7, phase: 4.05, color: lerp(FAR, INK, 0.45) },
  ];
  for (const r of ridges) {
    for (let x = Math.round(pad); x < s - pad; x++) {
      const u = (x - pad) / inner;
      const crest = tri(u * r.freq + r.phase) * 0.78 + tri(u * r.freq * 3.1 + r.phase * 1.7) * 0.22;
      const ridgeY = pad + inner * (r.base - crest * r.amp);
      for (let y = Math.round(ridgeY); y < s - pad; y++) put(x, y, r.color);
    }
  }

  // A jade wash where the qi pools at the foot of the mountain.
  for (let y = Math.round(pad + inner * 0.80); y < s - pad; y++) {
    const t = (y - (pad + inner * 0.80)) / (inner * 0.20);
    for (let x = Math.round(pad); x < s - pad; x++) {
      put(x, y, JADE, Math.round(52 * t));
    }
  }

  return encodePNG(s, s, px);
}

/* -------------------------------------------------------------- write */

mkdirSync(resolve(ROOT, 'icons'), { recursive: true });
writeFileSync(resolve(ROOT, 'icons/icon-192.png'), drawIcon(192));
writeFileSync(resolve(ROOT, 'icons/icon-512.png'), drawIcon(512));
writeFileSync(resolve(ROOT, 'icons/icon-maskable-512.png'), drawIcon(512, 0.11));

writeFileSync(resolve(ROOT, 'icons/icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b0e12"/><stop offset="1" stop-color="#2b3440"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="12" fill="url(#sky)"/>
  <circle cx="44" cy="19" r="7" fill="#e8b34b"/>
  <path d="M0 56 L12 40 L20 48 L30 33 L42 50 L52 42 L64 56 Z" fill="#1a2029"/>
  <path d="M0 64 L14 46 L26 58 L38 42 L52 58 L64 48 L64 64 Z" fill="#12161d"/>
  <rect y="52" width="64" height="12" fill="#35c98e" opacity="0.16"/>
</svg>
`);

console.log('icons written to icons/');
