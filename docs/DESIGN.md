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
3. **Paper, once, over the whole frame.** A fine tooth, plus a vignette. The
   grain is *static* — grain that crawls per frame reads as video noise, not as
   paper. It used to carry two long fibre octaves as well, one stretched each
   way, and two anisotropic octaves crossed is a weave: over a flat sky that is
   a sheet of fabric hanging behind the mountains. Stage 2 deleted them.
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

### Linear light, ACES, and one place where it becomes pixels

`THREE.ColorManagement.enabled = true`, `outputColorSpace = SRGBColorSpace`,
`toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.0`.

The shading is still entirely authored — hand-written toon ramps, no PBR, no
physical light units — but it is authored in *linear light*. Every palette hex
is converted from sRGB into the linear working space on the way in; the scene is
lit, fogged and bloomed there; and the **last pass of the composer** applies
exposure, the ACES curve and the sRGB encode, once.

Colour management used to be off, on the reasoning that a custom `ShaderMaterial`
gets no automatic linear→sRGB conversion on the way out, so the world would
render at roughly 40% of the brightness it was painted at. That was true and is
now handled — and it had to be, because **a tone curve applied to values that
are already gamma-encoded has no shoulder left to roll off.** ACES exists to take
a value of three and land it near white instead of clipping it to a flat plate;
inside 0..1 there is nothing for it to do. Half of "the picture looks flat" was
exactly that.

The two colours the post pass mixes in *after* the encode — the rebirth ink and
the tribulation flash — are display-referred and take no conversion at all.
`displayColor()` in `shaders.js` is how that is said out loud.

`renderer.toneMappingExposure` is the single exposure dial. The post pass reads
it every frame rather than holding its own copy, so time-of-day grading has one
number to turn.

### The light rig: three lights, and no ambient

`js/view3d/lighting.js`. One `DirectionalLight` for the sun (the only caster),
one `HemisphereLight` at 0.35 for the sky bounce, one low `DirectionalLight`
behind and above the cultivator for her rim. There is no `AmbientLight`, and the
suite fails if one appears.

**Ambient light is the one light that cannot describe form.** It lifts the shadow
side by exactly what it lifts the lit side, so the difference between them — the
only thing carrying the shape — becomes a fraction of the total. The hemisphere
replaces it at the same cost and varies with the normal, so a face turned up to
the sky and a face turned down to the valley differ before the sun has spoken.

The rig is the single source of truth for both consumers: it positions the real
`THREE.Light`s that render the shadow map, *and* writes the same direction,
colour and intensity into the shared `env` uniforms the ink shaders read.

The sun's shadow camera is fitted to the **foreground island only** — 30 world
units at 1024, about 3 cm per texel on the shelf. The range is four hundred units
deep; a map stretched over it has no texels left for the thing the shadow is
actually for, which is the figure on her platform. The peaks are not shadowed and
are not meant to be. The ink materials receive through three's own `shadowmap`
chunks, so `shadowMap.type`, `bias`, `normalBias`, `radius` and `intensity` on
the light are all live rather than decorative.

She casts and does not receive: at 60 texels tall she can lay a clean shadow on
the shelf but cannot resolve her own folds, and asking gives a figure crawling
with acne.

### Two things that were flattening every frame

Both were in the shading model, and neither was visible as a bug.

**The key had nowhere to fall to.** `dot(n, L) * 0.5 + 0.5` is a full
half-lambert wrap, which hands a surface pointing *directly away from the sun*
half of the key. With the ambient term on top, the difference between the lit
face of a rock and its shadowed face was a few percent of the total, and no
shadow map or rim light can rescue a picture from that — the shading has no range
left to spend. The wrap is a quarter now: still soft, because an ink-wash shadow
side is not a hard terminator, but with a real zero at the bottom.

**The rim was a wash, not an edge.** A fresnel term is only an edge on something
with a silhouette. On a shelf twenty-five units across, seen from eight degrees
above it, `1 - dot(n, v)` is 0.87 over the whole surface — so at the exponent it
was running at, two thirds of the light on the entire foreground was a
view-dependent term that no sun and no shadow could touch. It is a fourth power
now, gated on the key (an edge light is what you see where the key is not), and
the ground's own rim coefficient is down to a trace. That coefficient also drove
the palette's **accent** colour across the largest background surface in the
frame, which the art rules forbid outright.

### Where the sun stands

It used to be a free number, because all it decided was which flank of a ridge
took the warm ramp. It decides where every shadow falls now.

**Bearing belongs to the realm; elevation belongs to the day.** How high the
light stands is a property of the hour and nothing else, so it lives in
`time-of-day.js` — 6° at dawn, 55° at noon, 4° at sunset, 40° for the moon.
Which compass point it comes from is a composition decision made against the
locked camera, so it stays in `palette.js`, per realm, where the suite can hold
it to its floor.

Five of the eight realms had the sun within fifteen degrees of the camera's own
bearing. A key behind the viewer's head is the flattest light there is: nothing
the camera sees is turned away from it, and every shadow falls behind the thing
that cast it. `sunOffsetDeg()` in `framing.js` measures the angle between the
two bearings and the suite holds every realm to a 60° floor, so it cannot come
back. Six key from the left, so the shadow runs into the open right of the
frame; the moon realm keys from behind at 156°.

Stage 1 also held elevation to a 20°–50° band. Stage 2's table deliberately
breaks the bottom of it: a 4° sunset and a 6° dawn are *raking* light with very
long shadows, which is the opposite of the fault that band was written against
— a sun near the zenith, which has no direction to read. The floor moved to the
day, where it now says "above the horizon and out of the zenith", 3°–60°.

One consequence worth writing down: because every sun stands at least 60° off
the lens, the disc itself is never in a shipped frame. What the composition gets
is its light, not its face. Swing the camera round to it — the QA scrubber can —
and it is there, low over the range at dawn and sunset, with a halo wide enough
to carry into frame if a later stage ever brings a bearing round.

### The post stack

`js/view3d/post.js` — `EffectComposer` over `RenderPass` → `UnrealBloomPass`
(threshold 0.85, strength 0.4, radius 0.6, half resolution by construction) →
`ShaderPass` carrying the game's own grade material. No DOF and no SSAO: both
cost more than everything above put together.

`post` is no longer a quality tier flag. The last pass is what tone maps and
encodes the frame, so a tier without it would be putting raw linear light on an
sRGB screen. **Bloom** is the tier setting; the grade runs everywhere, and so
does the grayscale QA toggle that lives inside it.

The addons are vendored verbatim under `vendor/three-addons/`, pinned to the same
`three` revision as the core.

### The day, and the realm standing in it

Two axes, and each has exactly one owner. That split is stage 2's whole
contribution and it replaced eight hand-authored skies.

**`js/view3d/time-of-day.js` owns the hour.** Four authored states — dawn, day,
sunset, night — and every value between them is a continuous lerp:

| | Zenith | Horizon | Sun/Moon | Sun elev | Fog density | Exposure | Accent |
|---|---|---|---|---|---|---|---|
| Dawn | `#2b3a52` | `#8fa3b8` | `#e8d5c0` | 6° | 0.018 | 0.90 | `#9fe3d0` |
| Day | `#4a7ba8` | `#cfe0ea` | `#fff6e6` | 55° | 0.010 | 1.10 | `#8fe0c8` |
| Sunset | `#6b3f52` | `#f0a860` | `#ff9a4d` | 4° | 0.016 | 1.00 | `#ffd98a` |
| Night | `#0d1626` | `#2a3752` | `#cfe0ff` | 40° | 0.020 | 0.75 | `#7fd4ff` |

Night additionally brings the star field up to 1, the bloom to 0.55 — at an
exposure of 0.75 the handful of bright things left in the frame are most of what
the eye has to read — and shifts the cultivator's rim light blue, because the
only thing standing behind her is the sky. Those are three more lerped fields,
not three switches: **nothing in this renderer hard-swaps on a time of day.** A
threshold is exactly the pop the transition exists to prevent, and it is also
how a value that is only right at the four keys gets shipped unnoticed.

The dial is a **circle**: night runs back into dawn, `t` and `t + 1` are the
same sky, and a realm change eases along it the short way round. Eased as a
plain number, ascension's daybreak returning to first light would run the whole
day backwards in three seconds.

**`js/view3d/palette.js` owns the ink.** A realm is now a position on the day
(`tod`), the near-black its range is carved from (`ink`), the compass bearing
its sun keys from, five ridge tones, cloud and crest, water tint, bounce
colours, robe, trim, aura, blossom, bark and crane. It carries **no sky, no fog
and no light colour** — the suite fails if one grows back, because two owners of
the air is the fault this stage exists to remove.

The eight realms walk one full day in order, from the grey first light of Body
Tempering to the golden daybreak of Immortal Ascension. Everything gold in that
last frame is the realm's own ink and cloud; the sky it stands in is dawn.

**Why the sky could not stay per realm.** Fog has to be the colour of the sky at
the horizon — not close to it, the *same value* — or every distant surface is a
slightly wrong rectangle pasted onto the skyline. Eight authored skies plus a
time-of-day model is two answers to "what colour is the air", and the day they
disagree nothing throws. There is one air now: `scene.fog` is a real
`THREE.FogExp2` built from `tod.horizon` and `tod.fogDensity`, and the ink
shaders read `uFogColor` and `uFogDensity` back off that same object rather than
keeping a second copy. `uFogHigh` — the air up where the summits are — is the
day's zenith, which is what you are actually looking through up there.

**The lerp list has to be complete.** `index.js` holds a `live` palette of
THREE.Colors that the scene modules are handed each frame, and for a while it
carried five fields while `scenery.js` read ten. The missing ones did not error
and did not fall back to the realm's palette — they fell back to whatever hex
the *material was constructed with*, so `cloud`, `cloudCrest`, `crane`,
`blossom` and `bark` were authored per realm, wired nowhere, and the sea of
cloud stayed the same slate grey through all eight skies. A palette entry that
nothing reads is indistinguishable from a palette entry that is wrong.

### The sky sphere

A `ShaderMaterial` on a `BackSide` sphere, and deliberately almost nothing on
it: three stops (zenith → horizon → below-horizon, the third derived from the
first two so nothing invents its own), a sun or moon disc via
`smoothstep(dot(viewDir, sunDir))` with a wide soft halo, stars, and the two
realm set-dressings. The bright stop belongs **at** the horizon (`d.y ≈ 0`), not
at the nadir — a dawn glows along the skyline and darkens toward the zenith —
and the band is pitched at what the locked camera sees, which is about 20° above
horizontal, with an exponent packing more of the change into the low sky.

Three things came off it, and each was invisible as a bug:

- **The fabric.** The post pass laid two anisotropic fbm octaves over the frame
  — one stretched along x, one along y, which is a weave. Over rock, where there
  is form to hide it, it cost nothing; over a flat sky it is a sheet of cloth
  hanging behind the mountains. The isotropic paper tooth stays.
- **The seam.** The gradient used to be read off `normalize(position)`, which on
  a 32-segment sphere interpolates a chord where it wants an arc and steps the
  gradient once per segment: a faint vertical line every 11° across the one
  surface in the frame with nothing else on it. The ray is per-fragment from the
  camera now, and the sphere is built at 64×32.
- **The moon.** It hung at a hardcoded direction, lit for one hour of one realm
  — precisely the thing this stage exists to stop. The moon is the night's sun:
  same three lines, drawn where the key light stands.

**The dither belongs at the encode, not in the sky.** The staircase everybody
sees in a shallow gradient appears when the frame is quantised to eight bits,
which happens in the last line of the post pass — so that is where
`+ (hash(gl_FragCoord.xy) - 0.5) / 255.0` goes, after the tone curve, the grain,
the vignette and the QA grayscale. Written into the sky shader instead it would
be a flat 1/255 of *linear light*: half a step at noon and seven steps of
visible noise in a night sky. Measured on the contact sheet, a night sky was
holding one level for up to forty rows before this and holds it for three after.

### Aerial perspective, as three material tiers

Near, mid and far, and no custom shader: three colours and a haze cap each.
A picture with no texture and no atmosphere model has exactly one cue for depth,
which is what distance does to a colour. Two things happen to a mountain twenty
kilometres away — it gets **lighter**, because there is a column of lit air in
front of it, and it gets **less saturated**, because that air is grey and it is
most of what you are looking at. Doing only the first gives a range of pale
versions of the same hue, which reads as closer mountains painted badly.

So the tiers are *derived*, by `aerialTiers(ink, air)`, rather than authored:
mix the realm's ink toward the day's horizon colour by 10 / 26 / 44 %, then
desaturate by 12 / 26 / 40 % on top. Desaturation is toward each colour's own
luminance, so it cannot move a tier up or down the value ladder — only the
deliberate mix toward the air does that, which is what makes the ladder a
property of the arithmetic instead of eight ramps that were each only ever
checked against one sky.

The mix is scaled by how much light is in the air. Haze is *lit* air, and at
night there is none: mix the same 44% toward a night horizon and the furthest
rank lands within a dozen levels of the sky behind it — the same smear the ramp
exists to prevent, arrived at from the other direction. A far range under a
night sky stays black and reads as a silhouette.

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

### The landscape: fourteen peaks and the ground they stand on

The horizon is the game's other protagonist. It is built in `view3d/scenery.js`
from three ranks of instanced granite peaks, standing cloud, a plum tree, cranes,
and a waterfall — the stock imagery of the genre, assembled from noise and
primitives at a cost of about a dozen draw calls.

> **The range was rebuilt in stage 4.** Everything from "**The spires**" to
> "**A host peak**" below describes the *previous* range: ninety-six instances of
> one fluted column, reshaped per instance in the vertex shader. It is kept
> because the two traps recorded in it are real and general — a normal pushed
> through a 1:20 instance matrix, and a pine sized as a multiple of the rock it
> stands on — but the range it describes is gone. What replaced it, and why, is
> [Stage 4](#stage-4--granite) at the end of this section.

### The value ladder

Everything below rests on one relationship, and it is the thing the first
version of this landscape got backwards. An ink-wash picture is not a colour
scheme, it is three clearly separated values:

| rung | what | rule |
| --- | --- | --- |
| **cloud** | the brightest thing in the frame | near white; in *shan shui* the unpainted paper **is** the cloud, and everything else is read against it |
| **sky** | the middle | a gradient from a luminous skyline to a dark zenith |
| **peaks** | ink | always darker than the sky behind them, stepping near-black to pale as they recede |
| **ground** | the darkest thing out there after the island | the near shore is the closest land in the frame, so it takes the *nearest* rung of the ridge ramp. A rung lighter and it came out brighter than the range behind it, which is depth running backwards |
| **the near band** | darker than all of them | the foreground island, the plum, the framing branch: the realm's ink taken most of the way to black. It is the end of the ladder that is nailed down, and the other three are read against it. Added in [Stage 5](#stage-5--the-foreground), where it was found to be *lighter* than the midground |

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

**The spires** *(superseded by stage 4; kept for the two traps in it)*. A karst
pillar is a near-vertical fluted wall that only pinches in near its summit. Tapering smoothly from the base — the obvious thing — gives
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
horizon is pale, not absent. Each rank carries a `fogCap` (0.22 / 0.42 / 0.60,
near to far) that limits how much of the air colour it can take, so the far rank
stays a few percent darker than the air it stands in. That residual contrast is
the entire depth cue in a picture with no texture and no atmosphere model. Since
stage 4 the cap rides an *instanced attribute* rather than a material, which is
what lets one material serve all three ranks.

The cap matters just as much at close range and for the opposite reason. The
midground pines and rock spurs sit seventy units out, where the uncapped
exponential already takes 40% of a bright air colour — enough to lift near-black
rock to a mid grey. The *nearest* thing in the midground came out paler than
ranges twenty times further away, and the depth order of the whole picture read
backwards. They are capped too.

**The feet dissolved in the shader** *(and no longer do)*. Each rank faded its
lowest fifth into the air colour, so a pillar emerged from the cloud instead of
being sliced off by whatever plane happened to be there. Stage 4's peaks are
opaque lit geometry and a fade like that is a lie the depth buffer does not tell,
so the same job is done by putting the ground in front of every base — see
[Stage 4](#stage-4--granite).

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

### Stage 3 — the sea of cloud in the valley

The standing decks above put cloud around the *feet of the ranks*. Everything
below the skyline — the whole strip between the meditation shelf and the first
range — was air, and it read as a dark hole under a bright picture. That strip
is now four horizontal, independently scrolling cloud layers: `cloud-plan.js`
(pure: the tile and the seat) and `cloud-sea.js` (the Three.js half).

**A horizontal surface at this camera is foreshortened five to one, and that
decides the whole design.** The horizon is at v = 0.45 and the UI owns the
bottom 30%, so the sea is seen between zero and about eleven degrees of
depression. Three consequences, each of which killed an attempt at this stage
before it was measured:

- **Round billows cannot survive it.** At 100 units a 50-unit puff is wider than
  the frame and 1.5% of its height. What survives is a *ribbon* — long across
  the sightline, short along it — so the alpha map is sampled anisotropically,
  a 55–90 unit period across the view against 22–36 along it. The sea is banks
  rather than billows, which is what 横云 is in every painting of this subject.
- **The scroll has to run across the sightline too.** Written the obvious way
  the drift is spent on the axis the perspective compresses, and the sea reads
  as a still. The layers are rotated a quarter turn off the camera's bearing so
  that the brief's `offset.x` is the axis a cloud visibly moves along.
- **Relief is the one cue the grazing angle does not compress.** 2.6 units of
  swell is 3.4% of frame height at the sea's own depth, against the 1% a whole
  ribbon of alpha gets, so the surface is displaced by a periodic noise field
  and shaded by its own height. It is what makes one layer *cross* another
  rather than lie beside it.

**Where the stack sits is solved from the frame, not authored.** `SEAT` names
where the lowest layer's surface should break (v = 0.585, at 64 units) and what
one rung of the stack is worth in frame height (2.6%); the four world heights
fall out of that, and retuning the camera moves the sea with it. The layers land
at y = −8.5 … −2.4 against an eye at y = 2.03.

**Two faults here are invisible in code and total on screen**, and both are now
asserted:

- **The painter's stack runs furthest-first.** These planes write no depth.
  Ordered nearest-first — which is how the list reads — the palest, highest,
  furthest layer composites last and paints over the three in front of it, and
  four layers collapse into one flat sheet in the top layer's colour.
- **Stacked alphas converge on their mean.** At half coverage a layer, four
  layers come out at 0.77 *everywhere* with the tile's structure cancelled
  statistically — an even pale plate produced by the very thing that was
  supposed to give it depth. At 0.36 the gaps stay open and the dark valley
  behind them is what the cloud is read against.

The tile is 256², generated from a seed in about 70 ms at boot and shared by
every layer and every scene rebuild. It is **seamless by construction** — every
octave wraps its own lattice, the worley cells wrap with it, and the domain warp
is periodic too — because it is repeated across a 400-unit plane, where a
discontinuity is a ruled grid over the entire sea. `tests/run.js` asserts the
periodicity directly, f(u + 1, v) = f(u, v), rather than trusting a dump of it.

Worley is the *erosion*, not the body: inverted worley as the mass is a bubble
raft and the eye finds the cell lattice in about a second, warped or not. The
body is five octaves of value noise; worley lifts the threshold along its own
boundaries so the mass tears where a billow ends.

**What the numbers say.** Hiding the sea and reshooting isolates it exactly. In
the band it occupies (v 0.50–0.5625) row-mean luminance goes 52 → 121 at dawn,
80 → 146 by day, 62 → 130 at sunset, 24 → 91 at night, and the horizontal
structure in that band — its row standard deviation — goes 21 → 60, 31 → 62,
22 → 62, 14 → 61. Every other band of the frame is unchanged to the level:
nothing is veiled, no summit is touched. Whole-frame local contrast (mean
|Laplacian|) is up 16% at all four times of day.

**Where the brief's own numbers went.** Stage 3 was specified as four planes at
y = 2.0, 2.6, 3.2, 3.8. The eye stands at y = 2.0251, so those are one plane
25 mm below it and three above — and a plane above the eye is seen from below
and converges on the horizon from the *top* of the frame, which is an overcast
lid drawn over every summit with the brightest rung of the value ladder laid
over the darkest. The 0.6 spacing goes the same way: one rung is 0.8% of frame
height at the middle of this sea, four pixels on a phone, so four layers 0.6
apart are one sheet drawn four times. Both facts are asserted against the real
projection maths in `tests/run.js`, so the reason the numbers moved is checked
rather than remembered. Everything else the brief specifies is exactly as
written: four layers, a 400 × 400 plane each, `MeshBasicMaterial` with a tiling
noise `alphaMap` under 512², `transparent`, `depthWrite: false`, `DoubleSide`,
an independent scroll per layer with a drift and a heading of its own, a tint
toward the sun on the sun-facing side, and the whole thing drawn after the
opaque world.

Two flags on that material are load-bearing and silent if wrong. `toneMapped:
false`, because the composer applies the ACES curve at the end and a stock
material would apply it again in its own fragment shader. `fog: false`, because
exp² fog is total by 400 units and would take the far half of the sea to exactly
the sky colour; the haze is applied per vertex instead, capped at 0.30, from the
same `env.uFogColor` and `env.uFogDensity` every other material reads. One air,
still.

### Stage 4 — granite

The range above worked as arithmetic and failed as a picture. Ninety-six
instances of one profile, however cleverly the shader varied it, came back as
**fifteen identical melted candles**: a smooth taper with a smooth wobble,
repeated, so the eye found the repeat in about a second and stopped reading the
frame as landscape at all. Adding instances made it worse; the count was never
the problem.

**Fewer and bigger.** Fourteen peaks over six meshes, three ranks — three hero,
five supporting, six distant. Each mesh is carved once, properly, and each peak
is large enough in frame to be worth looking at. Six draw calls against the old
three, and the two extra buy every silhouette in the picture.

**A peak is a cylinder reshaped, then broken.** `view3d/peaks.js`, four steps:

- **the blank** — `CylinderGeometry(radiusTop, radiusBottom, height, 7–9, 12–16)`.
  Seven sides means the cross-section is *already* a polygon, so spinning an
  instance changes its outline; a smooth lathe has the same outline from every
  angle and a random heading buys nothing. `radiusTop` is never zero: between
  0.15 and 0.6 of the bottom. A cylinder closed to a point is a cone, and a cone
  is the one shape the eye names instantly.
- **the mass** — broad height zones turn the linear blank into talus, a
  projecting shoulder, a pinched neck and an upper crag. A seeded three-lobed
  term breaks the circular plan and a small curved drift takes successive rings
  off-axis. The profile is normalised to the blank's old maximum radius: this
  redistributes volume rather than making every peak fatter, so the frame-space
  placement table keeps its authored sky gaps and the hero silhouettes remain
  countable. Cap centres receive the same drift as their rims; otherwise a
  summit centre can fall outside its triangle fan and invert the cap.
- **the ridges** — every vertex is pushed along its own radius by ridged simplex
  noise, `1 - |noise(p · freq)|`, two octaves, sampled fast around the column and
  slow up it. The absolute value folds the field at every zero crossing, so the
  smooth places become *creases*: vertical fracture running the height of the
  wall, which is what granite does and what the eye reads a mountain's surface
  off at any distance. Simplex rather than value noise because value noise folds
  along its own axes, which puts four ribs at the compass points on every rock.
- **the shelves** — two to four rings snapped inward, at rows chosen from the
  seed. Under flat shading the triangle bands either side of a snapped ring turn
  nearly horizontal and take a completely different amount of sun from the wall
  above and below, so a ledge reads as a line of light across the rock.

Then the tops, which is what six meshes are *for*: a flat plateau with a small
pavilion built into the same buffer, a notched saddle, a leaning spire (the lean
is in the mesh, so a spin changes which way it leans), a through-arch, and two
crowns. Negative space and a horizon line read at distances where no amount of
surface detail survives.

**Welded by construction.** A cylinder shares its rim vertices with its caps and
repeats the seam column at the wrap. Every displacement here is a pure function
of the vertex's *position*, so the duplicates get the same answer and the mesh
never splits; anything that reached for a vertex index would tear it open along
the seam and at both caps. The on-axis cap centres follow the profile's lateral
drift even though radial shaping does not apply to them. And a radius may never
reach the axis — through zero
the two triangles sharing the vertex fold through each other and the face renders
with its winding, and its lighting, inverted: a bright shard in the middle of a
dark rock.

**One material, three ranks.** A stock `MeshStandardMaterial`, flat shaded,
roughness 0.9, metalness 0, opaque — the first stock lit material in the
renderer, and it earns it: there are hundreds of genuinely different facets per
rock now, and that is a surface that wants lighting rather than painting. Three
things are patched into it in `makeGraniteMaterial`:

| | why |
|---|---|
| capped air, per instance | the rank's `fogCap` rides an instanced attribute, so one material serves all three ranks — same rock, three amounts of air. Three materials would mean grouping instances by rank *and* by mesh: eighteen draw calls for fourteen rocks |
| a hot edge on the sun's side | the gate is near-silhouette on the camera side with a hot rim on the sun side. At a grazing sun, Lambert gives the first and not the second, because the lit facets are exactly the ones pointing away from the eye |
| a gain of π | `BRDF_Lambert` divides by π and every colour in this renderer was authored against shading that does not. Without it the range renders three times darker than the palette says it is |

`toneMapped: false` and `fog: false` for the same reasons the cloud sea sets
them. Nothing out there wears the accent: the old rock shader added a trace of
`uRimColor`, which is the player's own qi, and a background element carrying it
makes her light ordinary.

**The ground, and the seam it covers.** The valley floor was a flat
`PlaneGeometry(320, 130, 1, 1)`. Flat was not the fault on its own — the fault is
what a flat horizontal surface does at this camera. The eye is at most 11° above
it, so its far half is compressed into a couple of percent of frame height and
*every* gradient on it collapses into one ruled line. That line was the
razor-straight ground/sky seam, and it could not be softened, because it was the
projection flattening the softness and not the shader failing to supply it.

Measured: the cloud sea's own near fade ran 88 → 118 units, which lands between
v 0.516 and 0.500 — nineteen pixels on a phone. A seam detector (fraction of
columns that step at the same row) put it at **0.82**, and stretching every fade
in `cloud-plan.js` over sixty to a hundred and thirty units did not move it,
because at a grazing angle radial distance barely maps to frame height at all.
The sea cannot end in the air without drawing a line. It has to end *behind
something*.

So `terrain-plan.js` is a long section with a **far shore** in it: a subdivided
plane displaced by low-frequency fractal noise — plain, not ridged; land does not
fracture, and a valley floor built of creases reads as crumpled paper — whose
crest at z = −110 stands at +4 with six or seven units of relief on it. That puts
it nearer than 198 units and higher than the sea's topmost layer, so the land
breaks the surface of the sea while still inside it, and the boundary between
cloud and land is the *terrain's* silhouette. Across the frame that silhouette
runs v 0.403 … 0.441, against the sea's edge at 0.472. In the horizon band the
seam detector reads **0.28**, and what it is finding now is the ridgeline itself.

Two consequences worth recording:

- **A river is what this valley cannot have.** The section climbs the whole way
  from the eye to the shore — that is what makes the shore a shore — so a channel
  cut along it has its downhill bank *below* the water, and a flat sheet with a
  bank missing runs out of its own bed and draws a straight edge across the
  valley. The fix for the seam, reintroducing the seam. It is a tarn now, in a
  closed hollow, and the suite walks the rim rather than trusting the section.
- **Every foot sits below the crest.** A peak's base is a cap facing straight
  down: no sun, the ground half of the hemisphere, and a hard horizontal edge.
  Above the crest that is a shard hanging under a mountain — the same artefact
  the old shader hid by dissolving the lowest fifth of each pillar into the air.
  Dissolving an *opaque* surface is a lie the depth buffer does not tell, so the
  fix is geometric: the ground is in front of every base in the range.

**And the floating white polygon.** Not z-fighting, and no depth offset could
have touched it: the mist bands were 2.2 frames wide and wrapped at ±90 world
units, so at 56 units across they walked their own faded corner through the
picture. The limit is derived from the band now — half its width, less the 14%
each side that the shader fades, less the frame it has to keep covered — and they
turn at it rather than wrapping, because a wrap teleports the fbm with the mesh.

The one genuine pair of near-coplanar surfaces left is the tarn and its own bed,
and that takes the small negative `polygonOffset` the brief asks for.

### Stage 5 — the foreground

Everything above is midground and distance. This stage is the band the player is
actually sitting in, and it had three separate faults that all pulled the same
way: the foreground was **lighter than the range behind it**, the two largest
objects in the frame were **regular polygons**, and the tree in it was a
**leafless European deciduous tree** standing in a Chinese mountain range.

**The near band is the bottom of the value ladder, and it was the top of it.**
The platform was painted with the realm's `ground`, a mid tone authored for the
far shore. Measured on the grayscale sheet it came back at **82** against a
midground of 67: the nearest rock in the picture, taking almost no air, lighter
than ranges a hundred units behind it. `foregroundInk()` in `palette.js` is the
fourth rung — the realm's own ink taken 56% toward black — and it is a rung the
other three are *read against*. A value ladder is a relative structure, and a
relative structure with nothing nailed down can float up together, which is
exactly what "the picture looks washed out" means when nothing in particular is
wrong.

Two things fought that, and neither was in the palette:

- **The rim term is additive; the albedo is not.** `rim` on the shelf had
  already come down 0.25 → 0.08 in stage 1, and 0.08 reads as a trace right up
  until the surface under it goes near-black. `pow(1 - dot(n, v), 4)` runs at
  0.55 across a top seen from eight degrees above, so almost all the light on
  the platform was a view-dependent wash no sun and no shadow could touch. It is
  0.02 now, and the same fault took the framing branch — a limb close to the
  lens is *mostly* near-grazing surface, so at `rim: 0.30` the near-black device
  in the corner rendered as a pale grey pipe at luminance 90.
- **Flat shading, or the relief does nothing.** The platform's top is nine large
  triangles between the outline points, each tipped a different way. Smoothed,
  they average into one even grey.

Grayscale, after: foreground band **34 / 38 / 40 / 9** at dawn, day, sunset and
night, against a midground of 63 / 100 / 76 / 30 and peaks at 76 / 133 / 97 / 24.
(It measured 24 / 30 / 28 / 7 before the seat was fixed below — dropping the
island half a unit puts more of its *lit top face* in frame and less of its black
underside, which is a truer picture and a slightly paler number.)

**Where `ExtrudeGeometry` actually puts its bevel.** `slabGeometry` asked for
`depth: 3.5, bevelThickness: 0.30` and this file's own comment claimed the bevel
was "cut inside it". It is not: three adds it **outside `depth`, at both ends**,
so the solid comes back 4.1 deep spanning z = −0.30 … 3.80, and after the rotate
that lays it down its top face sits at y = **+0.30** rather than on the origin.
Nothing throws and nothing looks broken — the island simply floats a third of a
unit above where every other module believes it is.

What it cost, and none of it was visible as a bug:

- The composition contract puts the cultivator's feet at exactly y = 0 and the
  avatar's own lowest vertex is its y = 0. The meditation stone's top face was at
  +0.42 (its own bevel on top of a `position.y` of 0.32), so her lower quarter
  was inside the rock and she measured **10.2% of frame height against a contract
  that says 13.5%** — the one number in the contract the suite could not check,
  because it checks the *arithmetic* of the framing and not what the rock does.
- The censer was seated on bare `topRelief()`, which is a lift and not a height,
  so the bottom half of a 0.62-tall burner was underground.
- The plum's seat was a hand-tuned −0.05, chosen by eye against the wrong
  surface, so its whole root flare was buried.
- The steps were absolute world heights tuned the same way. Measured properly,
  **four of the six were below their own surface** — a flight of steps buried in
  the rock it is cut into. Re-tuning by eye had pushed them lower still, because
  what was actually visible was the two treads poking through a rim that was
  covering the other four.

Four different answers to "what am I standing on", three of them underground, and
every one individually plausible. There is one now: `surfaceAt(x, z)` in
`platform-plan.js`, and `SEAT` is the height it has to stay under where she sits.
The stone's top face *is* the seat, so the platform hangs `STONE_PROUD` below it
— and that is not free, because every unit the stone stands proud is a unit the
whole island drops: the strip of rock visible between the rim and her feet is
3.6% of the frame with the platform at zero, 2.6% at −0.16, and closed entirely
by −0.60. It is 0.16.

The steps are authored as `proud` — height above the rock directly under them —
rather than as world heights, which is the only shape of that number that cannot
drift when the relief is retuned. What that gives up is a monotone descent in
world y: the rim relief swings ±0.42 under the path, so the flight climbs over
the shoulder at 260° before dropping away to the right and out of frame, which is
what a path over a shoulder does.

`tests/run.js` drives the bevel fact against the **real vendored three**, because
it is a fact about the library rather than about this file, and the day it
changes the compensating translate is wrong.

**The platform is a drawing, not a primitive.** `platform-plan.js` holds eleven
points — angles that do not divide the circle, radii that never repeat, and a
third column that turned out to matter more than either.

- **Radial irregularity is not enough at this camera.** The eye is 2.03 units
  above a slab twenty-one across, so the rim is seen nearly edge-on: swinging a
  radius by four world units, a third of the whole platform, moves that piece of
  the silhouette by 1.4% of frame height. Half a unit of *height* at the same
  place moves it by 2.5%. So each point carries a `lift`, faded to zero over the
  middle where the composition contract puts the cultivator's feet at exactly
  y = 0, and the visible edge now wanders 4.8% of frame height instead of 1.4%.
- **The points are deliberately not evenly spread.** Only the arc from about
  190° to 290° is ever on screen. Eleven points spread evenly put two of them in
  there with a straight line between — a lively plan that renders as a smooth
  curve. Six of the eleven live in the visible arc.
- **`symmetryScore()` is the gate as a number.** The outline is resampled as
  radius-against-angle and compared with itself under every rotation and every
  reflection; the score is the closest any of them comes to matching. A regular
  n-gon scores 0, an ellipse scores 0, the platform scores 0.057. The one subtle
  part is that rotations under fifteen degrees are excluded: the profile is
  piecewise linear over spans of twenty degrees, so a one-sample lag matches
  almost anything and the naive minimum over all lags is always ~0.
- **The chipping has to be a pure function of position.** `ExtrudeGeometry` is
  not indexed, so a vertex on a shared edge is stored two or three times. Jitter
  drawn from a counter gives the copies different answers and the cap tears open
  into confetti. Same rule the peaks are carved under.

**Nothing below the rim and beyond it can be seen.** This is measured, and it
threw out the first two designs for the steps. The eye is two units above a rim
at y = 0, so the platform's own mass occludes every point past its edge that
lies under it — a flight descending off the back is *completely invisible*,
however carefully it is placed. And a flight laid across the top is nearly as
bad: the visible top spans v 0.55 … 0.60, five percent of the frame, with
everything past radius four crammed into the top two percent of that. Six treads
out there came to about twelve pixels in total, dark rock on dark rock.

What reads at this camera is a break in a **silhouette**. The steps sit just
inside the rim, standing half a unit proud, so each tread notches the platform's
own skyline and is seen against the cloud sea rather than against the rock. They
sink as they go right until the last is level with the rim and half off the edge
of the picture. Their bases are flared: a prism with vertical sides is a crate,
and six crates along a skyline read as cargo.

**The plum.** The old tree was a recursive branch function — grow, throw two or
three children at a randomised angle, recurse five deep. That is a perfectly
good *deciduous* tree, and that was the fault: a self-similar fan of thinning
twigs is an oak in February, and no amount of pink at the ends fixes a
silhouette already saying something else. Worse, the progression's blossom floor
was 0.06, which put nine flowers on a thirty-seven-segment tree — so what
shipped in every opening screenshot was a bare one. A progression cue may run
from a little to a lot; it may not run from wrong subject to right subject. The
floor is 0.34.

梅 is a chain of decisions rather than a recursion, and `plum-plan.js` is the
drawing: five trunk lengths with a 40°–55° turn at every joint (under fifteen
and the chain reads as one bent pole, and the segment boundaries become a
subdivision artefact instead of the point of the shape), four mains, two or
three subs each, and nothing below that. Radii fall by a third per joint, so the
ends read as twigs. Four fat root stubs splay out of the foot — that is the crag
mesh the old tree needed under it, deleted.

The tree also *moved*. It stood on its own ledge at z = −16, sixteen units back
and below the rim, which meant the platform occluded its entire trunk and the
player saw a scribble of twigs floating over the drop. It stands on the
platform's back-left shoulder now, roots on rock.

Blossom is a lit `MeshStandardMaterial` at roughness 0.7 with a small emissive
term, not the fresnel shell it used to be. A glow material is brightest at the
silhouette and empty in the middle, so a disc facing anywhere near the camera
renders as a **ring** — two hundred and sixty tiny rings is not blossom, it is
noise. The emissive term has one job: push the brightest clusters over the
composer's 0.85 bloom threshold so they flare against near-black wood. Flowers
run `#f5d0dc` to near-white per instance, because a single pink at this size
averages out to one flat tint.

**The framing branch is the largest single thing this stage does for depth**,
and the reason is worth stating plainly: the frame gets an object it can see is
in front of everything, at a depth the eye can name, and every other plane is
then read against it. A range with nothing between it and the viewer has no
scale but its own.

It is authored as **frame-space waypoints**, like the ridges and the ranks, and
the `z` on each one runs *positive*. That is the whole trick and it took four
rounds to find: written in world coordinates it was retuned repeatedly and still
covered nine percent of the frame, because a limb hanging two and a half units
at a depth of six moves eight percent down the picture and no amount of length
changes that. The eye stands at z = 12.2, so a root at z = +4.2 is eight units
from the lens where a world unit is a *ninth* of the frame's height against a
twentieth out at the tree. The branch is not big, it is close — which is also
the only way it can do its job. It covers 18.9% of the frame, enters at u = 1.42
and v = −0.22 so its root is off the corner, and reaches down to v = 0.41, just
above the horizon.

Two shape faults on the way there, both visible only on the contact sheet:

- **A chain of untapered cylinders is scaffolding.** Every joint is a flat disc
  the same diameter as the last and the ends are cut square. The mesh is a
  tapered cylinder now — one draw call either way.
- **Droppers that hang straight down are a gantry.** Three near-parallel
  vertical bars of even width, and the shape of a gantry does not care how
  carefully its members are tapered. Every segment moves 0.07–0.09 across the
  frame as well as down it with the sign alternating, so each limb zigzags at
  about forty-five degrees, and four thin twigs go back the other way. Fine wood
  going the wrong way is the thing no piece of machinery has.

The tree and the branch are **one instanced mesh** — both skeletons are baked
into world space and concatenated — and their blossom is one more. Which is also
why neither sways: a group rotation would swing the wood and not the flowers,
since the flowers have to live in a single world-space mesh shared with the
branch. It was 0.012 radians, 0.4% of the frame. The foreground's motion is the
petals and the thread of smoke; the wood is old and does not move.

**The censer** is the one object in the picture somebody carried up the
mountain. Everything else is geology or weather, and the cultivator alone does
not settle it — she could be passing through. Three legs, a swelling body, a
flat rim and two upright ears is what says 鼎 rather than "pot" at forty pixels.
Its smoke is a strip, not a particle stream: motes read as sparks, and incense
in still air is a *continuous* thread that only breaks up near the top. The sway
is in the vertex shader, scaled by `uv.y²` so the base stays pinned — smoke that
wags at the bottom is a flag — and the alpha scrolls upward through the noise
field, which is the whole animation.

**The conifers were firs.** Five stacked `ConeGeometry` skirts is a Christmas
card, and these two trees are the only man-height objects in the midground,
which makes them the scale cue for the entire landform: the eye sizes the
mountain behind whatever it decides they are. 松 is a bare leaning stem carrying
three or four **horizontal plates** with sky between them, and the sky between
them is most of the shape. `trees.js`, one instanced draw for the stand instead
of two.

Draw calls went 87 → 88 for four new objects, because the platform is welded to
its skirt and the treads to the censer: two meshes sharing a material are still
two draw calls.

### Stage 6 — the garment

Everything through stage 5 is landscape. This is the figure standing in it, and
until this stage she was **one `LatheGeometry` from hem to collar with two tori
round it** — a cone, which is one of the handful of shapes the eye names
instantly and then stops looking at. Nothing about it read as cloth, as a robe,
or as a person facing any particular way.

The plan is `figure-plan.js` and the builders are `garment.js`, split for the
same reason every other `*-plan` module is: the arithmetic is pure and
Three-free, so the whole of it — pleat spacing in CSS pixels, cuff margins
against the body's own outline, sash-tail clearance, the asymmetry score — runs
in `tests/run.js` without a renderer.

**The seat was measured, and then the island moved under it.** When this stage
was written the rock did not top out where it claimed to: `slabGeometry` builds
an `ExtrudeGeometry` with `bevelEnabled`, three adds the bevel *outside* the
extrusion, and the meditation stone's top face came back at **+0.42** against a
composition contract that puts her feet at y = 0. The bottom quarter of her was
inside the rock and she read 10.2% of frame height against a contract that says
13.5%. Lowering the island moves the platform rim, the treads that notch the
skyline and every composition number stage 5 was gated on, so stage 6 did the
only other thing available and composed the garment against the surface she
*actually sat on*: the hem landed on the stone at y ≈ 0.455 and pooled over it,
and no authored feature — trim band, cuff, sash tail — was placed below it where
the rock would eat it.

Stage 5 has since lowered the island, and the garment came up with it, which is
what asserting against `FIGURE.seat` rather than against 0.455 bought. `SEAT` is
now `platform-plan.js`'s own export rather than a number typed twice, so the two
files cannot disagree again. Only the skirt changed: the anchors from the waist
up were authored against the contract's y and the contract did not move, while
the hem dropped 0.455 → 0.035. Two things hang off that and both had to follow
it down — the body profile gained four rings below the old hem so it keeps
flaring over the 42 cm the rock used to eat instead of stopping dead in a
cylinder, and the sash tails were re-dropped to the *new* mid-skirt, which is
(hem + waist) / 2 and moved 21 cm with it. She reads the contract's 13.5% now.

**裳 — the pleated lower robe.** Twelve pleats, `2 × count` segments alternating
strictly ridge, valley, ridge, so every facet of the lathe is a plane between
one of each and the toon ramp steps at the fold. The count is bounded from both
ends by the camera and not by taste: the hem is 1.10 units across, a world unit
is 70.6 CSS px at the hero framing, and twelve puts ridge-to-ridge at ~18 px
across the face of the skirt where twenty would put it at 8 and turn fluting
into noise. The suite measures the on-screen spacing rather than the count,
because the count was only ever a proxy for it.

Two things the pleats are *not*: level at the bottom, or free of repetition. The
hem wanders ±0.062 on three waves whose periods do not divide the segment count
or each other — a level hem is the bottom of a lampshade, and a wobble that
comes back into phase with the pleats is one the eye folds back into the
fluting. The pleats themselves *do* repeat, deliberately, which is the exact
opposite of the rule the platform outline lives under: cloth folded by a person
repeats, and that is what makes it read as folded rather than as eroded. Both
are asserted, in the same section, because the distinction is the point.

**交领右衽 — the crossed collar. This is the element that decides what the shape
is.** A cone with a light V on its front is a robe; the same cone without it is
a bell, a chess piece or a lampshade, and at a poly budget where the face is two
marks it is the *only* thing carrying the read. Three bands: the wearer's left
panel laps over the right (右衽, closing to her right), and the inner robe shows
above both in a paler tone. The layering is radial standoff and nothing else —
left 0.026 over right 0.017 over the inner 0.010 — so the crossing renders in
the right order from every camera without a `renderOrder` or a `polygonOffset`
anywhere.

Its width is a frame number in disguise. 0.092 world units is 5.5 CSS px on a
414-px-wide phone at the hero framing and 15 px at the QA close camera; below
about five, a light band on dark cloth stops being a shape and becomes an edge
artefact. The suite measures it at three cameras. The panels are also *wrapped*
onto `bodyRadius` rather than positioned, so retuning the profile cannot leave
the collar floating in front of the chest.

The trim also had to be lifted 18% toward white, and the inner robe 50%. That is
not a re-authoring of eight palettes, it is a contrast decision that belongs to
the figure: `robe` and `trim` sit at luminance 98 and 133 at realm 0, a step of
1.36×, and a five-pixel band at 1.36× against the cloth behind it is a smudge.

**广袖 — sleeves, and the arms that were not there.** The old arms were capsules
at x = ±0.29 with a radius of 0.10, inside a robe whose radius at the same
height was 0.46: not hidden by sleeves, *inside the body*. The figure had no
arms in any frame ever shipped. The sleeves are built as a stack of **horizontal
rings**, which is the one non-obvious decision in the file — cloth hangs under
gravity whatever the arm inside it is doing, and a tube swept along a slanted
axis has a slanted mouth, which put the far lip of the cuff thirteen centimetres
inside the rock. Each cuff falls ~0.19 below its hand and both of them break the
body's own outline from all four QA cameras, which the suite checks by
projecting the cuff and the body's silhouette radius into frame space at every
preset.

**腰带 — the sash.** The two bands stayed; a belt with no ends is a hoop, so it
gained a knot at the front-left and two tails of different lengths and widths
falling to mid-skirt. The tails hang *against* the flare of the skirt rather
than out in the air, because the skirt widens faster than a ribbon falls — a
tail keeping 8 cm of daylight all the way down would have to fly outward at
forty degrees, which reads as a streamer in a wind that is not blowing. They
stand off 0.052 at every sample, the tip kicks out another 0.036, and they are
their own mesh because they are the one part of the garment with a free end and
therefore the part stage 8 has to move.

**The pose.** Three degrees of shoulder drop, a head that does not follow the
shoulders, hands resting one in front of the other, the knot off to one side,
one sleeve draped forward over the lap and the other fallen to the side.
`asymmetryScore()` reflects every part through x = 0 and matches it to the
nearest part of the original set; a mirror-perfect figure scores 0 and reads as
manufactured, which is the same signal a regular polygon sends. This one scores
0.08. `shoulderDropDeg()` is *measured* off the arms and held to what `POSE`
declares, so the pose cannot be documented as three degrees and modelled as
none.

**The QA profile camera could not see its subject.** Standing rock 4 came out of
its seeded stream at a world bearing of −40.3°, five units out and a unit and a
half tall, and the profile preset looks in along −41.8° — so the one instrument
whose whole job is judging her silhouette from the side had 85% of that
silhouette behind a rock, in every contact sheet since stage 4.
`clearOfCameras()` in `framing.js` pushes a bearing out of a 16° wedge in front
of any camera the build is judged on and leaves it alone otherwise, so exactly
one rock moved and the other four are where stage 5 left them. It is not only a
QA fix: the player can nudge the game camera, and a rock a degree and a half off
her sightline is a rock that swings across her the moment they do.

Draw calls: the figure went from 15 primitives to 10 meshes. Ten parts on four
materials would be ten calls; the robe, the trim, the inner collar and the tails
are welded with the same `mergeGeometries` the platform uses, so the whole
garment is four.

### Stage 7 — the head, the materials, and the sword

Stage 6 gave her a body. This is the rest of her, and the one prop in the frame
that says what kind of story she is in.

**The head.** The topknot was already there; what it lacked was a reason to be a
knot rather than a ball. A 冠 band round its base is one ring in the trim tone
and it is the line that says the hair was *dressed*. Four loose locks — two at
the temples, two at the nape, all different lengths — cost sixty triangles and
break the outline in four places, which is where the eye looks to decide whether
something is alive. And the skull is tapered below the equator rather than
scaled: `bevelJaw()` narrows and lifts the lower sections so the profile goes
from circle to soft wedge, because a *scale* narrows the crown as well and she
comes out egg-shaped.

**The hairpin is the piece that reads.** Pale jade against black hair is a value
step of about five to one, which at this size beats every other detail on the
head put together. It is also the only surface on her with a specular lobe worth
the name and a small emissive lift, so it is the one thing that crosses the
composer's 0.85 bloom threshold and sparkles — visibly so at night, where the
exposure is 0.75 and the bloom is turned up to 0.55.

**The face is two marks, and that is a decision rather than a budget.** Her head
is about twenty-five pixels tall in the shipped frame. A modelled face at
twenty-five pixels is not a face; it is four dark smudges the eye keeps trying
to resolve and cannot, which is exactly the uncanny read. Journey and Sky carry
entire casts on a shape, a silhouette and two marks where the eyes go, and what
the player supplies is always calmer than anything that could be modelled here.
The two marks are different sizes at different heights, like everything else on
this figure.

**Roughness is now spent rather than stored.** The stage's material table hands
out a roughness per part — robe 0.85, sash and trim 0.40, hair 0.60, skin 0.90,
hairpin 0.25 — and a number written down and never read is worse than no number,
so the ink material grew a Blinn lobe to spend it on. `specularFrom()` maps
roughness to a strength and an exponent through `(1 − r)³`, which is steep on
purpose: at 0.85 and above the contribution is under 0.3% and the robe, the skin
and every surface in the landscape shade exactly as they did before the term
existed. Only the three glossy things in the frame pick up a highlight at all.

**The accent audit, and what it turned up.** The rule is that the accent — the
player's own qi — belongs to the sash trim, the hairpin, the qi effects and the
particles, and to nothing else. Two things were quietly breaking it:

- **Every ink surface in the world wore a trace of her aura along its outline.**
  The half-strength ink edge in `makeInkMaterial` was `uRimColor × fresnel`, and
  `uRimColor` is the realm's aura. Unconditional, so the pines, the plum trunk,
  the cranes, the bamboo and every roof in the sect carried it. It is opt-in
  now: a surface takes `airAt(worldY)` — the sky's own colour at that height,
  which is what an edge lit by the sky behind it actually is — unless it is one
  of the four things that owns her colour. Measured on the contact sheet, the
  landscape moved by at most 2.8 of 255 in luminance and the value ladder did
  not change order; it is a colour change, not a value change.
- **The sect's lanterns were painted with the day's accent**, which made a
  valley of teal lanterns at noon and blue ones at night, three hundred units
  away, in the colour that is supposed to be hers alone. A lantern is fire, in
  every realm and at every hour, and it is `#ffb469` now.

Verified the way the stage says to verify it: tint the accent magenta and shoot
the sheet. Magenta appears on the qi motes, the garment's trim and the hairpin.
Nothing in the range, the sky, the cloud, the terrain, the plum, the pines or
the foreground rock takes a pixel of it.

**The jian.** The highest-signal object available for this setting, and it does
a second job the character cannot do for herself: she is a seated triangle,
wider than she is tall, and the sword is a hard vertical eighty pixels long
standing right beside her. A composition of one mound gets an axis.

Planted, not laid across her lap — her lap is under two wide sleeves and a sash
by the time stage 6 is done, and a sword laid in it would be four visible pixels
of guard. Everything about the placement is measured: it lands at u 0.58–0.60
with her own outline reaching 0.553, so the two shapes never merge; its head
sits at v 0.50, under the horizon at 0.45 and under her crown at 0.475, so it
reads against the bright cloud without competing with her; and its tip is at
y 0.30, twelve centimetres inside a stone whose top face is at 0.42, so it is
*in* the rock rather than standing on it.

The grip is six rings alternating proud and slack. At six CSS pixels across, a
smooth cylinder and a wrapped one are the same picture — a ribbed one catches
the key light six times and reads as bound cord. It is the pleat trick, one
scale down.

The tassel is the one thing in the frame with no reason to be still, which is
why it is there: stage 8 gets free motion at the far end of a rigid object, and
motion at the end of something rigid reads as air moving rather than as an
animation playing. It hangs clear of the scabbard by more than its own radius at
every strand, which the suite checks — a free end inside the object it hangs
from is not free.

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
| Status bar ends | 0.12 |
| Karst summits | 0.126 – 0.20 |
| Cloud band tops | 0.21 / 0.25 / 0.30 |
| Karst feet | 0.215 – 0.42 |
| Ridge crests (five layers) | 0.33 – 0.44 |
| **Horizon of the ground plane** | **0.45** |
| The cultivator's head | 0.475 |
| **The cultivator's feet** | **0.61** |
| UI begins | 0.70 |
| Valley mist | 0.38 – 0.76 |

The horizon is the hinge. A summit below it is a hill; above it, the same
silhouette is a mountain against sky. The first version of the range put its
summits almost entirely below the horizon, and no amount of recolouring made it
read as anything but low hills.

> **These placements predate the camera lock.** The horizon used to sit at
> v = 0.198 — a camera tilted 13° down from a high shelf — and everything in the
> table above the horizon row was authored under it. Stage 0 froze the framing at
> a near-level 45° lens with the horizon at 0.45, and the frame-space placements
> followed the camera automatically because that is what frame-space placement is
> for. What did *not* follow is the intent: crests authored as valley walls
> *below* a high horizon now read as distant ranges *above* a low one. Re-seating
> them is a later stage's job, and it is a job to be done against this camera,
> not against the one they were drawn for.

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
| How many peaks stand out of the cloud | realm (9 of 14 → all 14) |
| How far the cloud sea has sunk | realm |
| Plum in bud / full bloom / shedding | stage within the realm — never *bare*; see [Stage 5](#stage-5--the-foreground) |
| Petal fall rate | stage — heaviest at Peak, when a breakthrough is due |
| Cranes on the thermals | jianghu renown |
| Bamboo by the shelf | sect herb garden level |
| Spirit motes over the valley | meridians opened (night realms only) |
| The waterfall, and how wide it runs | sect mine level |

### Camera

**Everything is in `view3d/camera-config.js`, and nothing is anywhere else.**
That is a rule, not a description: the lens, the near and far planes, the
reference aspect, the safe zones, the composition contract, every named framing
and the four QA presets are one exported object, and the test suite greps
`view3d/index.js` to prove the `PerspectiveCamera` constructor takes its
arguments from it. A framing is not a preference — it is the coordinate system
every other art decision is made in, so it gets one home and one owner.

The contract, and the reason for each line:

| | | why |
|---|---|---|
| fov | **45** | portrait, 414×896 reference |
| horizon | **v = 0.45** | above centre. A centred horizon splits the frame in two and neither half wins |
| character anchor | **v = 0.61**, u = 0.44 | lower third, off the vertical centre line |
| character height | **13.5%** of frame | small. The landscape is the subject; she is what gives it scale |
| status bar | top **12%** | reserved |
| UI | bottom **30%** | reserved |

The hero framing is *solved* from that table rather than eyeballed. Pitch comes
from the horizon target — the rig's position formula carries a `+0.06·dist`
vertical bias, so the pitch that lands the horizon at 0.45 is slightly negative,
not zero. Distance comes from the figure's height on screen. Target comes from
where her feet have to land, and sits at her depth so the player's nudge arc
orbits the figure. Change one and all four have to be re-derived together;
`tests/run.js` fails if they drift.

The horizon here is the true horizon — the vanishing line of the ground plane,
which is a property of the lens and the tilt and nothing else. That matters
because it makes the contract portable: `horizonV()` takes no aspect argument,
so "45% down the frame" means the same thing on a phone and on a tablet. The
vertical half of the contract is aspect-independent throughout, which is why it
can be stated as a number at all.

The player may still nudge inside a limited arc (±0.62 rad yaw, clamped pitch,
0.62–1.45× zoom), and the game still moves the camera between named framings
(`world`, `close`, `sect`, `trib`, `forge`, `duel`, `rebirth`) with the rig
easing between them. Every framing writes its fov as `FOV ± n` so there is one
lens to retune.

Two more things worth knowing:

- **A tap always cultivates.** Double-tap-to-reframe rides on top and only fires
  when there is a nudged camera to undo. An earlier build let double-tap
  detection swallow every second tap — fatal in a game whose core loop is
  tapping.
- **The Sect framing accounts for the sheet.** The panel covers the lower ~52%
  of the screen on that tab, so the sect framing aims well below the valley to
  lift it into the strip the player can still see, and approaches from the side
  so the foreground cliff does not occlude it. "The camera moves to the sect"
  has to actually be true.

### The debug harness

Dev-only, `js/view3d/debug.js`, imported dynamically from `main.js` and only
when the page is on localhost or carries `?debug` — a shipped build never
fetches the file, and the service worker shell deliberately does not list it.
The renderer exposes the switches (`view.qa.*`) because the renderer is the only
thing that knows what a tier change or a scene rebuild has to do to them; the
panel only throws them.

| key | |
|---|---|
| `G` | grayscale — the finished frame as pure value |
| `W` | wireframe |
| `S` | safe-zone overlay, plus live horizon / anchor / figure guides |
| `T` | the day, 0→1 across dawn, day, sunset, night and round again (`←`/`→` to step) |
| `C` | cycle the four fixed cameras: hero, wide, close, profile |
| `P` | shoot a contact sheet |
| `` ` `` | hide the panel |

The panel reads out FPS, draw calls and triangles, the hour the frame is being
painted at with its exposure and fog density, and — the part that matters — the
live composition measured against the contract, turning red the moment the
horizon, the anchor or the figure's height leaves tolerance.

**Grayscale is the primary instrument.** An ink-wash landscape is a value ladder
before it is anything else, and colour is very good at hiding a ladder that has
collapsed: two things that are obviously different in colour can be the same
grey, and a range that is the same grey as the sky behind it has stopped being a
range. The pass runs dead last in the post shader, after grain, vignette and
flash, because the question it answers is "does the finished picture read". It
uses `LUMA` from `palette.js` — the same weights `luminance()` uses, which is
the same ruler the value-ladder assertions in the test suite measure with. Two
rulers would be worse than none. On the `low` tier, which ships with no post
pass at all, turning grayscale on forces the render target into existence rather
than silently doing nothing.

### The contact sheet

Four cameras × four times of day = sixteen frames in one image. The columns are
the four authored states, with the realm's own ink held still underneath them,
so a row answers the only question stage 2 cares about: does this hold up under
all four lighting conditions, or does it only work at dusk? `npm run sheet` starts
the static server, drives a headless Chromium at it over the DevTools protocol
with no dependencies beyond Node's own `WebSocket`, and writes
`screenshots/contact-sheet.png`; `npm run sheet:gray` shoots the value-ladder
version. `--guides` burns the safe zones into every cell, `--cells` writes the
sixteen frames out individually.

Captures are deterministic on purpose. The presets carry `drift: 0` so the
camera's idle breathing is switched off, `setPose` rewinds the drift phase,
frames render at `dt = 0` so nothing animates between them, and the frame-time
watchdog is muted so sixteen renders in one tick cannot demote the quality tier
on the strength of a screenshot. Two runs of the same build produce the same
picture, which is the whole point: a difference between two sheets is a
difference between two builds.

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
| Draw calls | < 90 | **88** at medium tier, of which **7** are all of stage 4's rock (six instanced peak meshes and one ground) and **4** are stage 5's foreground: island, dressing, wood, blossom |
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
| Peaks (of 14) | 10 | 14 | 14 |
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
npm test             # 492 engine and renderer checks
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
looking. `npm run sheet` and `npm run sheet:gray` shoot the sixteen-frame contact
sheet; the method behind it is worth writing down:

**The harness must never look at a stale build.** The service worker is
cache-first over the whole shell, so on a machine that has played once it serves
yesterday's modules to today's page — and the contact sheet is then a picture of
a build that no longer exists. That is worse than having no instrument at all,
because it agrees with you: two rounds of stage-1 tuning were judged against
frames rendered by the pre-stage code before anyone noticed the sheets were 97%
identical to the baseline. A dev build now unregisters any worker it finds and
drops its caches.

**Value separation is a number, not a feeling.** Two contact sheets, decoded,
compared: mean luminance says whether the exposure moved, standard deviation says
how much range the picture is using, and mean |Laplacian| says how much local
form there is. Stage 1 moved the grayscale sheet from sd 48.3 to 61.0 (+26%) at
the same mean, with local contrast up 17% *despite* the paper grain being cut
from 5.5% to 2%. "It looks better" is not a gate; that is.

**A/B the light itself.** Toggling `sun.castShadow` and differencing the two
frames isolates exactly what the shadow contributes, in pixels and in levels. It
is how the contact shadow was found to be rendering correctly while landing
directly behind the figure in five of the eight skies — a composition fault that
no amount of staring at the shadow code would have turned up.

The rest of the method:

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

Closed since: **the foreground island sat 0.36 too high and the figure was
inside it**, because `ExtrudeGeometry` adds its bevel outside `depth`. Stage 5
seated the island on `surfaceAt()` and the garment followed it down — see the
stage 5 and stage 6 sections above. Nothing on the island is authored above the
seat any more and the suite holds it there.
