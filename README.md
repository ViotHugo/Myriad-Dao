# Myriad Dao: Ascension

An idle cultivation game rendered as a Song-dynasty ink-wash mountain you can
breathe inside. You sit very still on a peak at dusk; centuries pass in the sky,
your sect grows in the valley below, and every number in the game is something
you can see out there.

Vanilla ES modules and one vendored copy of Three.js. No build step, no
framework, no downloaded art. **~1035 KB total**, and installable as a PWA.

```bash
npm run serve     # http://localhost:8123
npm test          # 311 checks
npm run balance   # assert the A18 pacing table
npm run sheet     # 4 cameras × 4 skies -> screenshots/contact-sheet.png
```

## What's in it

Eight realms × four stages, gated by a hard qi bottleneck at 1.6× the next
breakthrough — so progress always terminates in a decision. Ten capped
technique manuals, the twelve classical meridians, expeditions, alchemy, a
spirit-stone pavilion, a forge with five artifact rarities, a named sect that
survives your death, a shared deterministic ladder of 100 rivals, 35 Dao
Records, and reincarnation.

Two timing minigames — the Heavenly Tribulation and the best-of-three duel —
where **the width of the window on screen literally is the probability**, and
the marker sweeps at constant speed so a tap lands inside exactly that often.

Behind it all, the ten thousand peaks: three ranks of instanced karst spires
rising out of a luminous sea of cloud, each pillar carved to its own silhouette
in the vertex shader and crowned with pines that tell you how big it is. A plum
tree buds and blooms and sheds with the stage you are on, cranes gather as your
name spreads, a skein of birds crosses the range, and a waterfall widens with
your sect's mine. The landscape is a readout — how many peaks stand clear of the
cloud is your realm, and you can read it without looking at a single number.

The whole picture is built on one relationship: cloud is the brightest thing in
the frame, the peaks are ink and always darker than the sky behind them, and the
ranks step from near-black to pale as they recede. That ladder is asserted in
the test suite for all eight skies, because when it inverts nothing throws — the
range is simply drawn in colours that make it indistinguishable from the air.

Everything is synthesised or generated: the mountains from seeded ridged noise,
the guqin from oscillators through a feedback-delay "valley echo", the icons
from a 60-line PNG encoder over `zlib`.

## The camera is locked

A framing is not a preference — it is the coordinate system every other art
decision is made in. Move the camera after the scene is built and every call
that was made was made against a crop that no longer exists. So it is frozen, in
one file, and asserted: a 45° lens on a portrait frame, the horizon at 45% of
frame height, the cultivator's feet at 61% and her whole body 13.5% of the frame
tall, with the top 12% and bottom 30% reserved for UI. `view3d/camera-config.js`
holds all of it and `tests/run.js` fails if any of it drifts.

And because "does this look better" is not a gate, the instruments came before
the art. On localhost or with `?debug`: `G` renders the frame as pure luminance
— an ink-wash landscape is a value ladder, and colour is very good at hiding one
that has collapsed — plus wireframe, safe-zone overlay with live composition
guides, a scrubber that walks the eight skies continuously, and four fixed
cameras. `npm run sheet` shoots all four against four skies into one sixteen-cell
contact sheet, deterministically, from a headless browser with no dependencies.

## Layout

```
js/data.js               every tuned number
js/engine.js             pure state + rules — no DOM, no WebGL, no Math.random
js/ui.js                 DOM/CSS HUD
js/audio.js              synthesised WebAudio
js/view3d/               Three.js: shaders, world, scenery, avatar, sect, effects
js/view3d/camera-config.js   the locked camera — one object, no scattered literals
js/view3d/debug.js       the QA harness. Dev-only, dynamically imported, never shipped
tools/contact-sheet.js   drives a headless browser to shoot the 16-frame sheet
tools/balance-sim.js     plays the engine headlessly, checks pacing
tools/make-icons.js      regenerates the PWA icons
tests/run.js             311 checks
docs/DESIGN.md           art direction, performance budget, quality tiers, balance
```

The engine runs in Node with no renderer present. If `npm run balance` stops
working, the engine has picked up a dependency it should not have.

## Docs

[`docs/DESIGN.md`](docs/DESIGN.md) covers the ink-wash rendering approach, the
draw-call and download budgets, the three quality tiers, save migration, how the
visuals are checked, and the two places where the v0.4 feature inventory
disagrees with itself (and what this build does about each).

## Deploying

Static files — push to `main` and the included GitHub Actions workflow publishes
to Pages. Nothing to compile.

## Licence

MIT. Three.js is vendored under `vendor/` with its own licence.
