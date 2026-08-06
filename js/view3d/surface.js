// How rough a surface is, as the two numbers a specular lobe actually needs.
//
// ---------------------------------------------------------------------------
// Why this is its own file and not four lines inside shaders.js
//
// Because the test suite has to be able to read it, and the test suite may not
// import `shaders.js` — that module imports Three, and **nothing the suite
// loads is allowed to**. CI installs no dependencies at all (see
// `.github/workflows`: "No dependencies to install — the engine and its tools
// are plain ESM"), so a single `import * as THREE` anywhere in the suite's
// import closure does not fail a check, it fails to *start*, and the whole
// engine test run goes with it.
//
// So the arithmetic lives here, pure and Three-free, alongside `palette.js`,
// `framing.js` and the `*-plan` modules, and both the renderer and the suite
// read the same function.
//
// ---------------------------------------------------------------------------
// What it does
//
// Stage 7 hands out a roughness per part — robe 0.85, sash and trim 0.40, hair
// 0.60, skin 0.90, hairpin 0.25 — and a number written down and never read is
// worse than no number at all, so the ink material grew a lobe to spend it on.
//
// It is Blinn, not GGX: this is a toon renderer with a four-step ramp, and the
// whole job of the term is to put one hot point on the jade pin and a soft
// sheen along the hair so the rim light has something to catch.
//
// The mapping is deliberately steep. `(1 - r)³` means everything at 0.85 and
// above contributes essentially nothing — the robe, the skin and every surface
// in the landscape shade exactly as they did before this existed, and only the
// three glossy things in the frame pick up a highlight at all.

export function specularFrom(roughness) {
  const r = Math.max(0, Math.min(1, roughness));
  return {
    gloss: (1 - r) ** 3 * 0.85,
    shine: 8 + (1 - r) ** 1.5 * 88,
  };
}
