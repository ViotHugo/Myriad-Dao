# Myriad Dao: Ascension — design doc

An idle cultivation game that looks like a Song-dynasty ink-wash landscape you
can breathe inside. Centuries pass in the sky, your sect grows in the valley
below, and your power is legible at a glance.

This document covers the 3D art direction, the performance budget, the quality
tiers, and — importantly — the two places where the v0.4 feature inventory
disagrees with itself, and what this build does about it.

---

## 1. Architecture

The strict separation from v0.4 is preserved. The dependency arrows only ever
point one way:

```
        data.js  ──►  engine.js  ──►  viewModel()
        (tables)      (pure rules)         │
                          ▲                ├──►  ui.js       (DOM/CSS HUD)
                          │                └──►  view3d/     (Three.js world)
              actions ────┘                          │
                                                  audio.js   (WebAudio)

        tools/balance-sim.js ──►  engine.js      (headless, Node)
        tests/run.js         ──►  engine.js      (headless, Node)
```

| Layer | File(s) | Rule |
|---|---|---|
| **data** | `js/data.js` | Every tuned number. No logic. |
| **engine** | `js/engine.js` | Pure state + rules. No DOM, no WebGL, no audio, no timers, no `Math.random`. Runs in Node. |
| **view3d** | `js/view3d/*` | Reads a view model, draws. Owns no rule. `framing.js` and `progress.js` are pure and Three-free, so the test suite can check composition and progression headlessly. |
| **ui** | `js/ui.js` | DOM HUD. Calls engine actions, never mutates state. |
| **audio** | `js/audio.js` | Synthesis only. |

`createGame({ random, state })` takes its randomness by injection, so
`tools/balance-sim.js` and `tests/run.js` drive an identical, reproducible game
with no renderer present. **If either stops running, the engine has picked up a
dependency it should not have.**

The engine exposes exactly one read surface — `viewModel()` — which returns a
copy. A test asserts that mutating the view model cannot corrupt state.

### Where the minigames live

The tribulation and the duel are *animations*, so they live in `view3d`. The
engine still owns every consequence:

- `beginBreakthrough()` returns `{ chance, speed }` and stores a `pendingTrib`
  that survives reload.
- The view runs the ring and reports whether the tap landed inside the window.
- `resolveTribulation(success)` applies the outcome.
- The headless sim skips the animation and rolls `random() < chance` instead.

**The window's angular width *is* the success chance, and the marker sweeps at
constant angular speed.** Uniform speed means uniform distribution over the
ring, so a tap at an arbitrary moment lands inside exactly `chance` of the time.
The picture and the probability are the same object — no fudge factor anywhere.
(The v0.4 spec describes a spark oscillating across a bar; a sinusoidal
oscillation would spend more time near the edges and quietly make a centred
window *harder* than its nominal width. Constant angular motion is the version
that keeps the stated promise.)

---

## 2. Art direction

### Ink-wash in 3D

Five ridge layers march away from the meditation shelf, each flatter, paler and
lower-contrast than the last. That stack is the entire sense of depth in the
composition, and it is generated at boot from seeded ridged-fractal noise — no
heightmaps, no models.

Four things make it read as ink rather than as low-poly terrain:

1. **A ridge is a dark crest that dissolves into whatever weather is behind
   it.** This one took two attempts to get right, and the first attempt is
   instructive. Fading the foot of a strip to *transparent* left a black void
   where the valley should be, because at the time there was nothing behind it —
   so the fix was to fade the colour to fog while keeping the strip opaque. That
   worked, and then the cloud sea was built behind it, and the same opaque foot
   became the single worst thing in the picture: five strips whose feet cover
   the whole lower middle of the frame, painting flat untextured grey over the
   sea of cloud. It is what made the landscape read as *dry*.

   The foot dissolves for real now. What made it safe is not a shader change but
   the fact that there is weather back there to reveal. The dissolve is keyed to
   each column's own crest, too: `uv.y` runs 1 at the skyline and 0 one fade-band
   below it. Measured from the bottom of the strip — which is dragged far below
   the frame so it never ends in mid-air — every pixel the player can actually
   see sits at `uv.y > 0.85`, and a dissolve written against that coordinate
   does precisely nothing.
2. **The layers are a painter's stack.** They write no depth, so `renderOrder`
   runs furthest-first. Getting this backwards makes a distant range paint over
   the ridge in front of it.
3. **Paper, once, over the whole frame.** Long fibres one way, a fine tooth the
   other, plus a vignette. The grain is *static* — grain that crawls per frame
   reads as video noise, not as paper.
4. **There is something in the middle distance.** The authored camera is yawed,
   so the band of frame between the shelf and the first range looks out at
   roughly world x −26, z −40. That was empty sky in every realm — the eye went
   straight from the figure to the skyline with nothing to cross. A stand of
   pines and a shoulder of rock now sit out there in near-flat dark ink, with
   the mist bands wrapping their bases.

### Light sources need a filled core

`makeGlowMaterial` is a fresnel shell: brightest at the silhouette, empty in the
middle. That is right for an aura and wrong for anything that *is* a light. Worse,
a flat ring viewed face-on has `dot(normal, view) ≈ 1` everywhere, so its fresnel
term is zero across the whole ring and it renders **completely invisible**.

That silently cost the game its lanterns, its forge coals, the tribulation
shockwave, the artifact reveal ring — and the duel's closing timing ring, which
is the entire interactive content of a duel. The material now takes a `core`
parameter that mixes the rim term toward a solid disc; anything read as a light
or a widget sets it.

### Colour management is deliberately off

`THREE.ColorManagement.enabled = false`, and `outputColorSpace` is
`LinearSRGBColorSpace`.

This renderer is entirely authored: hand-written toon ramps, no PBR, no physical
light units. With colour management on, Three converts every palette hex into
linear working space, but a custom `ShaderMaterial` gets no automatic
linear→sRGB conversion on the way out — so the world renders at roughly 40% of
the brightness it was painted at. Turning it off means the hexes in
`palette.js` are exactly the pixels on screen, which is what you want when the
palette *is* the art direction.

### The eight skies as a lighting script

`js/view3d/palette.js` holds one entry per realm: sky top/mid/horizon, the two
air colours and their density, light direction and colour, ambient, ground, five
ridge tones, a three-step `peaks` ink ramp, a `sun` colour and power for the
ridge light, cloud and crest, water, aura, robe, trim, and flags for stars /
moon / aurora / cloud-sea. A realm change lerps every one of those over ~3
seconds. Nothing hard-cuts.

The bright stop belongs **at** the horizon (`d.y ≈ 0`), not at the nadir — a
dawn glows along the skyline and darkens toward the zenith.

**The lerp list has to be complete.** `index.js` holds a `live` palette of
THREE.Colors that the scene modules are handed each frame, and for a while it
carried five fields while `scenery.js` read ten. The missing ones did not error
and did not fall back to the realm's palette — they fell back to whatever hex
the *material was constructed with*, so `cloud`, `cloudCrest`, `crane`,
`blossom` and `bark` were authored per realm, wired nowhere, and the sea of
cloud stayed the same slate grey through all eight skies. A palette entry that
nothing reads is indistinguishable from a palette entry that is wrong.

### What each system looks like

| System | Treatment |
|---|---|
| Cultivation tap | The whole canvas is the button. A ripple, a mote burst, a DOM `+N` billboarded off the qi column. |
| Qi bottleneck | Qi is a swirling column of motes around the meditator. Density tracks progress; at the cap it saturates and turns gold. The bar is rendered as weather. |
| Realms | Full environment change over ~3s: sky, fog, light rig, water, particle character. |
| Tribulation | Sky blackens, the whole frame is drained via a post `uDarken`, clouds spiral, bolts strike. The timing window is a large **camera-facing** rune ring around the player. |
| Meridians | Twelve glowing nodes along the body plus a filament that lights as they open. |
| Techniques | Motifs: drifting leaves (Thousand Leaves), a flowing current (Flowing River), a slow shell shimmer (Turtle Breath). |
| Sect | The valley actually builds: hut → hall → gate + pagoda → walled complex → floating peak. Disciples are instanced bodies walking circuits. |
| Expeditions | A party leaves by the gate, walks out of the valley, and returns along the same line when the timer completes. |
| Alchemy | Furnace plume; active buffs tint the aura. |
| Forge | Brazier, sparks, and a reveal where the piece rises and unfolds in its own light. Immortal gets a shockwave ring and an arpeggio. Bound gear renders on the avatar. |
| Duels | A second framing: two robed figures with drawn blades on a stone pillar above mist, a lit rim around the platform. The strike window is a jade target ring with a white ring closing on it; a landed strike sparks where the blades meet and rocks both figures. |
| Age & death | Hair and beard move through four brackets of `age / lifespan`, so a 500-year-old Nascent Soul is still in his prime. Withered desaturates the world. Forced rebirth lifts the nascent soul out and away. |
| Reincarnation | The frame runs to ink from the outside in, then reforms at dawn. |

### The landscape: ten thousand peaks

The horizon is the game's other protagonist. It is built in `view3d/scenery.js`
from three ranks of instanced karst spires, standing cloud, a plum tree, cranes,
and a waterfall — the stock imagery of the genre, assembled from noise and
primitives at a cost of about a dozen draw calls.

### The value ladder

Everything below rests on one relationship, and it is the thing the first
version of this landscape got backwards. An ink-wash picture is not a colour
scheme, it is three clearly separated values:

| rung | what | rule |
| --- | --- | --- |
| **cloud** | the brightest thing in the frame | near white; in *shan shui* the unpainted paper **is** the cloud, and everything else is read against it |
| **sky** | the middle | a gradient from a luminous skyline to a dark zenith |
| **peaks** | ink | always darker than the sky behind them, stepping near-black to pale as they recede |

The spires used to be tinted with the **ridge** ramp. Those colours are authored
for valley walls seen against mist and deliberately run pale at the far end;
borrowed for a skyline they put the furthest rank *lighter* than the air behind
it, and dropped all three ranks inside the sky's own value range. Nothing threw.
The range was drawn exactly where it was meant to be, in colours that made it
indistinguishable from the air — a smear where a mountain range should be, and
no amount of adding peaks or moving them would have helped.

`palette.js` now carries a separate `peaks` ramp chosen against `sky`, and
`tests/run.js` asserts the ladder for all eight realms: peaks darker than the
skyline by a margin, ranks monotonic near-to-far, cloud brighter than the palest
rank by 60 levels — and, because "bright" is relative, cloud no more than 3.2×
its own skyline, or the starry realms read as snowdrifts at noon. The invariant
the art depends on is checked, not trusted.

Two smaller things in the same family:

- **Air is two colours.** Hazing every distant surface toward one grey makes a
  summit high in the frame and a foot down in the valley converge on the same
  value, which is what flattens a landscape into a decal. `airAt(worldY)` mixes
  between a bright skyline air and a colder high air, and everything hazes
  toward that.
- **The sky's stops are packed against the horizon.** The authored camera looks
  out and slightly *down* from a high shelf: the top of the frame is about eight
  degrees above horizontal, so `d.y` never exceeds 0.14. Spread over the 0..0.8 a
  sky dome usually wants, the entire visible band came out as one pale grey a
  few levels wide and `sky.top` was never reached in play. The same three stops,
  compressed, give a hundred levels of gradient inside the frame the game is
  actually composed for. (The star fade had the same bug and rendered about a
  tenth of a star.)

**The spires.** A karst pillar is a near-vertical fluted wall that only pinches
in near its summit. Tapering smoothly from the base — the obvious thing — gives
a cone, and a field of cones reads as a row of cypress trees.

But shaping the *geometry* only moves the problem: an `InstancedMesh` draws one
mesh, so ninety-six instances of a carefully shaped pillar are ninety-six copies
of the same pillar, and a repeated silhouette reads as a picket fence however
cleverly it is scattered. Spinning each instance to a random heading does not
help — a near-circular column has the same outline from every angle.

So the mesh is a plain fluted column, each instance carries a seed, and the
*vertex shader* carves the silhouette: taper from needle to blunt-topped tower,
a waist above the foot, a shoulder for a lesser second summit, an overhanging
belly on a few, and a lean off plumb. One draw call, and no two rocks alike.

One trap worth recording. A pillar's instance matrix scales it about 1:20, and a
normal pushed through that matrix comes out with its vertical component
multiplied by twenty — normals want the inverse transpose. Every summit ended up
facing straight at the sun and the whole range bleached white. The shader now
converts the profile's slope into the instance's real proportions and applies
only its rotation.

**Pines on the summits.** A karst pillar with nothing on it is an abstract shape
that could be three metres tall. Put a tree on its shoulder and it is instantly
three hundred. They are sized as a *fraction* of the pillar's width; scaled as a
multiple of it, as they were first written, they come out taller than the peaks
they stand on and destroy the very cue they exist to give. Because the shader
leans each pillar off plumb, the placement replays the same shear on the CPU —
same seed, same arithmetic — or the trees stand beside the rock instead of on it.

**A host peak.** A range with no hierarchy is a texture: the eye finds nothing to
land on. Chinese landscape names the dominant mass 主山, the host, and everything
else is its guest — so one pillar of the near rank is forced tall, forced
forward, and placed on a third rather than in the middle.

They are scattered in **clusters**, not uniformly. Karst erodes in massifs: one
dominant pillar with a crowd of lesser ones at its feet, then a gap. Prominence
is drawn from a hard-skewed distribution (`rand()^1.8`) so each cluster gets a
few tall pillars and many short ones, with the first of every cluster forced
tall so no cluster comes out uniformly stunted. Uniform scattering produced
evenly spaced needles of even height — a picket fence, not a range.

**Aerial perspective is capped, not absolute.** Exponential-squared fog is total
by about 400 units, which is right for haze and wrong for mountains: an ink-wash
horizon is pale, not absent. Each rank passes a `fogCap` (0.22 / 0.42 / 0.60,
near to far) that limits how much of the air colour it can take, so the far rank
stays a few percent darker than the air it stands in. That residual contrast is
the entire depth cue in a picture with no texture and no atmosphere model.

The cap matters just as much at close range and for the opposite reason. The
midground pines and rock spurs sit seventy units out, where the uncapped
exponential already takes 40% of a bright air colour — enough to lift near-black
rock to a mid grey. The *nearest* thing in the midground came out paler than
ranges twenty times further away, and the depth order of the whole picture read
backwards. They are capped too.

**The feet dissolve in the shader.** Each rank fades its lowest fifth into the
air colour, so a pillar emerges from the cloud instead of being sliced off by
whatever plane happens to be there. This is what removes the hard horizontal cut
across the range, and it does it without depending on a cloud deck landing in
exactly the right place.

**Cloud is a standing band, not a floor, and it is the light.** A horizontal
deck under a camera pitched 0.17 rad is seen almost edge-on, and however shallow
it is made, its far edge converges on the horizon — precisely where the summits
are — and veils the whole range. Camera-facing planes occupy exactly the slice
of frame they are given.

Three things make a band of them read as a sea rather than as fog:

- **It is bright.** The body was previously tinted 18% toward the haze colour,
  which is grey on grey: the cloud disappeared, and with it the only thing
  separating one rank of peaks from the next.
- **Its skyline is cut by the billow field**, not by a gradient. A soft vertical
  fade is a fog bank; a ragged edge is what makes peaks look like they stand
  *in* something. The cut is capped just below the plane's own top edge, or
  where the field runs high the mass is still solid at the rectangle's border
  and the deck ends on a hard-edged pale box hanging in the frame.
- **The body has structure.** The skyline alone is not enough — below it the
  deck was a single flat fill, so a third of the frame came out as one unbroken
  pale grey. A second octave breaks it into separate billows, with brightness
  through the mass and thin gaps where it parts.

**Life, because a landscape without it reads as abandoned rather than as still.**
A skein of fourteen small birds crosses the range on a precomputed line — one
draw call, and the eye finds a moving speck before it finds anything else. The
cranes are the ceremony; the skein is the ordinary traffic of a valley that
somebody lives in.

### Composing in frame space

The camera is authored and fixed, so the frame — not the world — is the thing
being composed. `view3d/framing.js` inverts the projection: name a depth and a
point in the picture, get back the world position that lands there. Both the
scenery and the ridge layers in `world.js` are specified that way.

This is not a convenience. The world framing looks down a diagonal, so the
visible slice of world x at z = -140 is `[-147, -65]` — nowhere near centred on
zero. An earlier build placed the range at "x = -34, spread 210" and threw more
than half of every rank off the right edge of the screen, which is invisible as
a bug: nothing throws, the range just looks thin and clumped to the left.

The module is free of Three.js, so the same arithmetic runs in the test suite;
`placeAtDepth` and `frameOf` are checked to invert each other exactly, and the
composition's contract (summits clear the HUD, feet stay above the valley) is
asserted rather than eyeballed.

The numbers that matter, all as fractions of frame height:

| | v |
|---|---|
| HUD top bar ends | 0.12 |
| Karst summits | 0.126 – 0.20 |
| **Horizon of the ground plane** | **0.198** |
| Cloud band tops | 0.21 / 0.25 / 0.30 |
| Karst feet | 0.215 – 0.42 |
| Ridge crests (five layers) | 0.33 – 0.44 |
| Valley mist | 0.38 – 0.76 |

The horizon is the hinge. A summit below v = 0.198 is a hill; above it, the same
silhouette is a mountain against sky. The first version of the range put its
summits at 0.17–0.38 — almost entirely below the horizon — and no amount of
recolouring made it read as anything but low hills.

The ridges moved to accommodate it. They used to crest above the top of the
frame and, being opaque strips, buried everything behind them; the range was
being drawn correctly and painted over. They are now valley walls beneath the
skyline, which is also the truer reading of the scene — the cultivator is on a
high shelf looking out and *down*.

Both stacks interleave by render order. The ridges write no depth, so they are a
painter's stack at -6/-9/-12/-15/-18, gapped deliberately; each spire rank and
cloud band slots into the gap matching its depth, so a range can stand behind
one ridge line and in front of the next. Ridge order is keyed to the layer
index, not its slot, so dropping a middle layer at low quality cannot renumber
the stack the scenery interleaves itself into.

### The landscape as a readout

The view out of the window answers "how am I doing?" before any number does.
`view3d/progress.js` is a pure function from the view model to the scene's
dials, so it is testable without a browser:

| Cue | Driven by |
|---|---|
| How many peaks stand out of the cloud | realm (30% → 100%) |
| How far the cloud sea has sunk | realm |
| Plum in bud / full bloom / shedding | stage within the realm |
| Petal fall rate | stage — heaviest at Peak, when a breakthrough is due |
| Cranes on the thermals | jianghu renown |
| Bamboo by the shelf | sect herb garden level |
| Spirit motes over the valley | meridians opened (night realms only) |
| The waterfall, and how wide it runs | sect mine level |

### Camera

The composition is authored — there is no free-fly. Named framings
(`world`, `close`, `sect`, `trib`, `forge`, `duel`, `rebirth`) each carry a
target, distance, yaw, pitch, fov and drift weight, and the rig eases between
them. The player may nudge inside a limited arc (±0.62 rad yaw, clamped pitch,
0.62–1.45× zoom).

Two things worth knowing:

- **A tap always cultivates.** Double-tap-to-reframe rides on top and only fires
  when there is a nudged camera to undo. An earlier build let double-tap
  detection swallow every second tap — fatal in a game whose core loop is
  tapping.
- **The Sect framing accounts for the sheet.** The panel covers the lower ~52%
  of the screen on that tab, so the sect framing aims well below the valley to
  lift it into the strip the player can still see, and approaches from the side
  so the foreground cliff does not occlude it. "The camera moves to the sect"
  has to actually be true.

### Cinematic mode

A set piece owns the screen. `setCinematic(true)` hides the sheet and the
cultivate pad and stops the tab bar inviting a tap; the tribulation, the duel,
the forge reveal and the wheel all use it.

This is not cosmetic. Before it existed the forge reveal played *behind its own
modal scrim* — a 78%-opaque blurred backdrop over the artifact it was revealing —
and the duel arena played behind the still-open Journey sheet. The two moments
the game most wants you to look at were the two you could not see. The reveal
card is now a bottom sheet with no backdrop, so the piece rises in clear space
above it.

---

## 3. Performance budget

This is a phone game that will sit open for hours.

| Budget | Target | Measured (this build) |
|---|---|---|
| Draw calls | < 80 | **57** worst case (Immortal Ascension, Grand Sect, high tier) |
| Total download | < 8 MB | **~1035 KB**, of which Three.js is 677 KB |
| Downloaded art assets | prefer zero | **zero** — all geometry and shading is procedural |
| Frame rate | 60 fps mid-range Android, 30 fps floor | quality tiers + watchdog (below) |
| Boot | < 2 s | single module graph, no fetches beyond the shell |

Everything in the world is generated at boot: ridges from seeded noise,
buildings from primitives, the cultivator from a lathe and some capsules,
disciples from one lathe profile in an `InstancedMesh`.

### Not drawing

- **Tab hidden → no rendering at all.** The simulation keeps running on
  wall-clock time.
- **No input for 120 s → 15 fps.** Any pointer, key or wheel event restores
  full rate immediately. An unattended meditation scene must not cost battery.
- The simulation is driven by `Date.now()` deltas, never by frame count, so a
  throttled tab still ages you correctly. Gaps over five minutes are handled as
  closed-door cultivation instead of catch-up ticks.

### Quality tiers

Auto-detected from `deviceMemory`, `hardwareConcurrency`, `devicePixelRatio` and
pointer coarseness; overridable in Settings. Tier changes are **live**: anything
baked into geometry (ridge layers, mist bands, mote and spark counts, instanced
disciple capacity, water) is rebuilt by disposing the four scene groups and
regenerating them, which costs a few milliseconds because it is all procedural.
A change requested during a set piece is deferred until the animation finishes,
so a tier switch can never tear down a tribulation mid-strike.

| | Low | Medium | High |
|---|---|---|---|
| Pixel ratio cap | 1.25 | 1.5 | 2 |
| Render scale | ×0.85 | ×1 | ×1 |
| Post pass | off | on | on |
| Target MSAA | — | 4× | 4× |
| Ridge layers | 3 | 5 | 5 |
| Mist bands | 2 | 4 | 6 |
| Qi motes | 60 | 150 | 320 |
| Karst spires | 26 | 58 | 96 |
| Instanced disciples | 8 | 16 | 24 |
| Water | off | on | on |

**Two things here decide whether the picture is sharp, and both used to be
wrong.** They are the whole reason the last build looked soft, and neither is
visible from reading the tier table alone.

`renderScale` multiplies the backing store, so anything under 1 is the browser
upscaling a smaller image — real, unrecoverable blur, not a subtle quality
setting. `low` sat at 0.75, which on a phone reporting a pixel ratio of 3 is a
frame drawn at a quarter of the linear resolution of the screen it is stretched
across. And `low` was easy to fall into: `detectTier` chose it for
`hardwareConcurrency <= 4`, but Safari does not implement `deviceMemory` at all,
several browsers clamp `hardwareConcurrency` for fingerprinting reasons, and
four reported cores is an ordinary laptop. Those players were handed a soft
picture with no way to know why. Low now renders at or above native, and is
reserved for devices that genuinely cannot hold a frame.

`antialias` is a flag on the **canvas' default framebuffer**. Both tiers that
set it also enable the post pass, which renders into a `WebGLRenderTarget`
instead — so the flag applied to a buffer that was never drawn to, and the frame
the player actually saw had no antialiasing whatsoever, however loudly the tier
asked for it. `msaa` multisamples the render target the scene really goes into.
`tests/run.js` now asserts both invariants: no tier renders below native, and
every tier with a post pass declares a sample count.

A watchdog samples frame times and moves the tier to fit the device: **down** on
a single bad window, **up** only after three consecutive comfortable ones. Once
it has dropped it gets exactly one attempt to climb back — a transient stall (a
shader compile, a backgrounded tab, a thermal blip) should not sentence a device
to the upscaled tier for the rest of the session, but a device that genuinely
cannot hold the frame has to settle rather than oscillate.

The post stack is deliberately one pass: paper grain, vignette, storm darkening,
ink dissolve, flash. No bloom. Glow is done with additive fresnel shells and
point sprites, which are cheap and controllable.

---

## 4. Balance

`js/data.js` carries every number from the v0.4 inventory verbatim. Values the
inventory *did not* fix — technique base costs, facility costs, and growth rates
within the stated 1.9–2.6 band — were tuned against the simulator to land the
A18 pacing table.

```
npm run sim          # idle pacing
npm run sim:active   # sustained tapping
npm run balance      # assert the A18 table, exit 1 on drift
npm test             # 223 engine checks
```

`--check` runs both modes across several seeds and fails if any milestone leaves
its guard band. Measured medians against A18:

| Milestone | idle | A18 | active | A18 |
|---|---|---|---|---|
| First minor breakthrough | 50s | ~1 min | 25s | ~40 s |
| → Qi Condensation | 29m | ~31 min | 23m | ~17 min |
| → Foundation | 1h 29m | ~1.8 h | 53m | ~37 min |
| → Core Formation | 2h 07m | ~2.7 h | 1h 02m | ~46 min |
| First reincarnation | 3h 02m | ~3.5 h | 1h 09m | ~55 min |
| Immortal Ascension (4 lives) | 7h 57m | ~11.5 h | 3h 04m | ~3.5 h |

### Where the spec disagrees with itself

Two findings from the simulator. Neither changes a published number; both are
recorded here so the next person does not re-derive them.

**1. A1's "sustained tapping ≈ 3–4× idle" and A18's ACTIVE column cannot both
hold at macro tapping speed.** A1 also mandates a floor of 1 qi per tap, and A3
gives the two tap manuals a combined ×12.9 at cap. At 8 taps/second that is
~30× idle, not 3–4×, and the whole ACTIVE column collapses to about an hour.
The reading that reproduces A18 is **one deliberate tap per second, sustained** —
which is also what a person actually does with a phone in one hand. That is the
simulator's default (`--tps 1`); pass `--tps 8` to see the macro case.

**2. The idle endgame runs ~30% faster than A18's 11.5 h, and this is
structural.** Once every qi technique is at its mastery cap, the only term still
growing is Dao Insight — and both its formula (`(realm−3)×6 + ⌊(lifetime
qi/1e9)^0.32⌋`) and the realm cost gaps (×1333, ×2000) are fixed by the spec.
Insight outruns the cost curve: by the fourth life the final major breakthrough
takes about ten minutes of a multi-hour life. No free parameter competes with it
— technique costs stop binding once the caps are reached, by definition. Life 2
does land inside A18's stated 2.3–3.5 h per-life band; lives 3 and 4 are shorter.
Closing the rest of the gap would mean editing a published number, so it was
left alone and flagged instead.

### Death is a slow-burn mechanic, by design

At 1 year per 30 real minutes (A8), a continuous session never reaches even the
100-year Body Tempering span — the simulator ends its runs aged 17. Withering is
reachable through **offline accrual**: 8 h away is 16 years, so a player who
lets a save sit in a low realm for about a week comes back to a withered body.
That is coherent — it punishes stagnation across days, not within a session —
and it is implemented exactly as specified.

---

## 5. Saves

- Key: `myriad-dao-save`, current version `5`.
- `migrate()` deep-merges any older save over the current defaults, so new
  fields appear with sane values and unknown fields are dropped.
- v0.4 shapes are mapped explicitly: `dao → insight`, `spiritStones → stones`,
  `beastCores → cores`, `achievements → records`, flat `rank/wins → jianghu.*`,
  and a boolean-array `meridians` collapses to a count.
- Migration also repairs poisoned saves: realm and stage clamp to range,
  negative qi becomes 0, qi clamps to the bottleneck, technique levels clamp to
  their caps, `bestRealm` is never behind `realm`, a corrupt disciple roster
  becomes an empty one, and rubbish input returns a fresh cultivator.
- Base64 export/import round-trips through `TextEncoder`/`Buffer`, so non-ASCII
  names survive.
- If `localStorage` is unavailable (private mode), the game falls back to an
  in-memory store and plays normally rather than failing to boot.

---

## 6. Accessibility & comfort

- `prefers-reduced-motion` is honoured at boot and re-exposed as a setting: it
  damps camera drift to 15%, slows the breath, and CSS animations collapse.
- All interactive targets are ≥ 44 px.
- No gesture is required beyond a single tap. Orbit, pinch and double-tap are
  all optional.
- Text is DOM, not in-world — better rendering, real contrast, and it costs no
  draw calls.
- Sound, music and haptics are independent toggles. Haptics still fire with
  sound off.
- Audio boots on the first user gesture and fails silently if the browser
  refuses an `AudioContext`.

---

## 7. How the visuals are checked

Rendering bugs do not show up in unit tests — every one of the faults above
passed a fully green suite while being plainly wrong on screen. They are found by
looking. `tools/` has no screenshot harness (it would need a browser in CI), but
the working method is worth writing down:

1. Drive the real build in headless Chromium at a phone viewport.
2. Capture every realm, every sect tier, each set piece, and the withered state.
3. Tile them into one montage and look at them side by side — a realm that has
   gone flat, or a set piece rendering behind its own UI, is obvious in a grid
   and invisible one screenshot at a time.
4. When something looks wrong, **project the geometry to screen coordinates and
   read the numbers** rather than guessing. Every placement bug in this build
   was solved that way: the ridges that were back-face culled, the sect hidden
   behind the foreground cliff, the pine at x=−7.4 that projected to screen
   x=−482, the moon sitting just above the top of frame, the flock of cranes
   wheeling at u = 1.4 — just off the right edge, forever.
5. **Bisect by hiding layers.** When the range came out as pale ghosts, four
   candidates could each have explained it. Toggling mist, cloud, water and
   ridges off one at a time and tiling the five results made it immediate: the
   ridges were opaque and painting over everything behind them.
6. **Measure, do not squint.** A hard horizontal seam looked obvious at 3×
   nearest-neighbour zoom; sampling row luminance put the largest step at 5/255,
   and hiding the "culprit" layers made edges *harsher*. There was no seam. The
   converse also holds — the numbers found the off-screen cranes that no amount
   of looking at the screen ever would, because they were not on it.
7. **Probe pixels before theorising about shaders.** The rebuilt karst range
   looked bleached white, and there was a plausible story about the sun term
   being too strong. Reading the actual framebuffer at four points on the rock
   returned RGB (57, 64, 75) — the peaks were correct, and it was the *sky*
   behind them that had gone too dark. Two rounds of tuning had been aimed at
   entirely the wrong object.
8. **Row-mean luminance is the fastest read on a flat picture.** Twelve
   horizontal bands, printed as numbers, say in one line what a screenshot says
   only after study: `[87, 106, 105, 123, 130, 92, 69, 59, 71, 55, 44, 36]` is a
   landscape with a bright cloud band and a dark valley. `[114, 117, 114, 121,
   133, 94, ...]` — the same scene before this pass — is a picture with no
   structure above the midline at all, and that single row of numbers is the
   whole "it feels flat" complaint stated precisely.

**What none of this catches.** Every fault in this pass was a *composition* or
*value* fault, and the suite was green through all of them. What the suite can
hold is the arithmetic underneath: `framing.js` inverts its own projection,
`progress.js` maps state to scenery monotonically, the palette obeys the value
ladder, and no quality tier renders below the resolution of the screen. Those
are the invariants where being wrong is silent — nothing throws, the picture
just quietly stops working — so they are the ones worth spending assertions on.

## 8. Known gaps

- The rebirth sequence is an ink wipe and a camera move; the nascent soul
  lifting out of the body is a single glowing sphere on a spline, not authored
  animation.
- Expedition parties walk a straight line out of the gate and back rather than
  following the terrain.
- The `close` framing used by the Arts tab is a tighter version of the world
  shot; it does not yet show the meridian constellation as its own composition.
