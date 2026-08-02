// Pure formatting helpers. No DOM, no engine imports — safe in Node and browser.

// 'Qi' is deliberately absent as a unit suffix: it collides with the game's own
// currency. Quintillion reads as 'Qn' instead.
const UNITS = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qn', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QnDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

/** Compact number: 1234 -> "1.23K", 5e15 -> "5.00Qa". */
export function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
  let tier = Math.floor(Math.log10(n) / 3);
  if (tier >= UNITS.length) return n.toExponential(2);
  let scaled = n / Math.pow(1000, tier);
  // Guard float drift pushing 999.999 -> "1000.00K".
  if (scaled >= 1000) { scaled /= 1000; tier += 1; }
  if (tier >= UNITS.length) return n.toExponential(2);
  const digits = scaled >= 100 ? 1 : 2;
  return scaled.toFixed(digits) + UNITS[tier];
}

/** Duration in seconds -> "3h 04m" / "12m 30s" / "45s". */
export function fmtTime(sec) {
  if (!isFinite(sec)) return '∞';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Years as an age readout: whole years below 1000, compact above. */
export function fmtYears(y) {
  if (!isFinite(y)) return '∞';
  if (y < 10000) return Math.floor(y).toLocaleString('en-US');
  return fmt(y);
}

export function fmtPct(x, digits = 0) {
  return (x * 100).toFixed(digits) + '%';
}

/** Multiplier readout: 1.0 -> "x1", 2.35 -> "x2.35". */
export function fmtMult(x) {
  if (x >= 1000) return '×' + fmt(x);
  if (x % 1 === 0) return '×' + x;
  return '×' + x.toFixed(2);
}
