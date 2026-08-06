# Myriad Dao: Ascension

An idle cultivation game rendered as a Song-dynasty ink-wash mountain you can
breathe inside. You sit very still on a peak at dusk; centuries pass in the sky,
your sect grows in the valley below, and every number in the game is something
you can see out there.

Vanilla ES modules and one vendored copy of Three.js. No build step, no
framework, no downloaded art. **~1035 KB total**, and installable as a PWA.

```bash
npm run serve     # http://localhost:8123
npm test          # 534 checks
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

Behind it all, the range: fourteen granite peaks in three ranks, rising out of a
luminous sea of cloud. Each one is a cylinder that has been broken — displaced
by ridged simplex noise into vertical fracture, with two to four horizontal
shelves snapped through it — and there are six of them, carved once and
instanced, so no two peaks in the frame share a silhouette. One is a flat
plateau with a pavilion on it, one a notched saddle, one a leaning spire, one a
through-arch you can see the sky through. A plum tree buds and blooms and sheds
with the stage you are on, cranes gather as your name spreads, a skein of birds
crosses the range, and a waterfall widens with your sect's mine. The landscape is
a readout — how many peaks stand clear of the cloud is your realm, and you can
read it without looking at a single number.

In front of all of it, a near-black band you read everything else against: an
irregular slab of rock hand-drawn from eleven points, worn steps going down over
its shoulder and out of the picture, a small incense burner with a thread of
smoke, an old plum leaning out over the drop — and a second plum branch entering
the top-right corner, close to the lens and mostly out of frame, which is the
oldest trick in Chinese landscape painting and does more for the depth of a
picture than anything else you can put in it.

Sitting on it, the cultivator — who was a cone until stage 6, because one lathe
from hem to collar with two rings round it is a cone whatever you call it. She
wears a twelve-pleat lower robe with a wandering hem, a **crossed collar closing
to the right**, left panel over right in a paler silk — three quads, and the
single element that makes a shape read as a Chinese robe rather than a bell —
wide sleeves whose cuffs hang below her hands and break her outline from every
camera, and a sash with a knot and two tails. She is deliberately not
symmetrical: one shoulder three degrees lower, the head tilted the other way,
one sleeve draped forward and one fallen to her side. All of it is arithmetic in
`figure-plan.js`, so the test suite can measure the collar in CSS pixels on a
414×896 phone rather than take anyone's word for it.

Her face is two dark marks and nothing else — at twenty-five pixels of head, a
modelled face is four smudges the eye keeps trying to resolve, which is the
whole of the uncanny read. What carries the head instead is a jade hairpin
through the topknot, the one surface on her glossy enough to catch the bloom,
and four loose locks breaking the sphere. Beside her a **jian** is planted in
the stone: lacquered scabbard, wrapped grip, and a red tassel off the pommel
that is the only thing in the picture with no reason to be still. And the accent
colour is hers alone now — her sash trim, her hairpin, her qi, her motes. It
used to sit on the outline of every pine, plum and roof in the valley; tint it
magenta and shoot the sheet, and the landscape does not take a pixel of it.

The ground under them is real now too: a subdivided plane displaced by
low-frequency noise, whose far shore rises to a crest that stands in the sea of
cloud. That is not decoration. A horizontal plane at this camera is foreshortened
five to one, so *where the sea stops* was a ruled horizontal line across the
picture that no amount of softening the fade could remove — the softness was
being flattened by the projection. The sea has to end behind something, and now
it ends behind a ridgeline.

Below the skyline the valley is a sea of cloud in its own right: four horizontal
layers at four heights, each scrolling on its own heading, each rolling on its
own swell. They are banks rather than billows on purpose — a horizontal surface
seen from a level camera is foreshortened five to one, and a round puff drawn on
it comes back as a smear — so the alpha map is stretched along the sightline and
the layers cross each other as they drift. It is the difference between peaks
standing in fog and peaks standing in weather.

The whole picture is built on one relationship: cloud is the brightest thing in
the frame, the peaks are ink and always darker than the sky behind them, and the
ranks step from near-black to pale as they recede. That ladder is asserted in
the test suite for all eight realms at every hour of the day, because when it
inverts nothing throws — the range is simply drawn in colours that make it
indistinguishable from the air.

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
guides, a scrubber that walks the whole day continuously — dawn, day, sunset,
night — and four fixed cameras. `npm run sheet` shoots all four cameras against
all four times of day into one sixteen-cell contact sheet, deterministically,
from a headless browser with no dependencies.

## Layout

```
js/data.js               every tuned number
js/engine.js             pure state + rules — no DOM, no WebGL, no Math.random
js/ui.js                 DOM/CSS HUD
js/audio.js              synthesised WebAudio
js/view3d/               Three.js: shaders, world, scenery, avatar, sect, effects
js/view3d/camera-config.js   the locked camera — one object, no scattered literals
js/view3d/time-of-day.js dawn, day, sunset, night — the sky, the air and the light
js/view3d/cloud-plan.js  the sea of cloud as arithmetic: its tile, and where it sits
js/view3d/peak-plan.js   the range as arithmetic: six meshes, and where fourteen stand
js/view3d/figure-plan.js the cultivator's garment as arithmetic: pleats, collar,
                         sleeves, sash, and the asymmetry that makes her a person
js/view3d/garment.js     cloth as geometry — one quad-grid primitive, four ways
js/view3d/surface.js     roughness → specular lobe, Three-free so the suite can read it
js/view3d/terrain-plan.js the ground as arithmetic: the long section and its far shore
js/view3d/noise.js       seeded 3D simplex, and the ridged fractal granite is carved from
js/view3d/debug.js       the QA harness. Dev-only, dynamically imported, never shipped
tools/contact-sheet.js   drives a headless browser to shoot the 16-frame sheet
tools/balance-sim.js     plays the engine headlessly, checks pacing
tools/make-icons.js      regenerates the PWA icons
tests/run.js             534 checks
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
