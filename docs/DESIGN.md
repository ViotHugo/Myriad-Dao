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
| How many peaks stand out of the cloud | realm (30% → 100%) |
| How far the cloud sea has sunk | realm |
| Plum in bud / full bloom / shedding | stage within the realm |
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
npm test             # 331 engine and renderer checks
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
