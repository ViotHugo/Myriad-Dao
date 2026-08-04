// Is this a dev build?
//
// Its own module, and a very small one, because two things need the answer at
// two different times. `main.js` needs it *before* the renderer makes its WebGL
// context — reading the canvas back for a contact sheet requires
// `preserveDrawingBuffer`, and that is a construction-time decision. The debug
// harness needs it too, but the whole point of the harness is that it is
// imported dynamically and a shipped build never fetches it.
//
// Written twice in two files, the two copies drift, and the day they disagree
// is the day the capture tool starts returning blank frames in one build and
// not another. So: one predicate, statically importable, ten lines.

/** Dev builds are localhost, or anything with `?debug` in the query string. */
export function debugEnabled(loc = typeof location !== 'undefined' ? location : null) {
  if (!loc) return false;
  if (/[?&]debug\b/.test(loc.search || '')) return true;
  return ['localhost', '127.0.0.1', '[::1]', '::1', ''].includes(loc.hostname);
}
