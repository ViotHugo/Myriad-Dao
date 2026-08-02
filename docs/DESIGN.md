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
| **view3d** | `js/view3d/*` | Reads a view model, draws. Owns no rule. |
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

1. **A ridge dissolves upward into its own colour and downward into fog.** In
   ink-wash, the foot of a mountain drowns in *opaque* mist, it is not a hole.
   An earlier build faded the base to transparent and the midground became a
   black void; the `fade` uniform now controls how far up the strip the ridge's
   own ink takes over, and everything below it is solid fog colour.
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

`js/view3d/palette.js` holds one entry per realm: sky top/mid/horizon, fog
colour and density, light direction and colour, ambient, ground, five ridge
tones, water, aura, robe, trim, and flags for stars / moon / aurora / cloud-sea.
A realm change lerps every one of those over ~3 seconds. Nothing hard-cuts.

The bright stop belongs **at** the horizon (`d.y ≈ 0`), not at the nadir — a
dawn glows along the skyline and darkens toward the zenith.

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
| Draw calls | < 80 | **29–40** (boot → Spirit Severing with a Grand Sect) |
| Total download | < 8 MB | **~978 KB**, of which Three.js is 677 KB |
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
| Pixel ratio cap | 1 (×0.75 scale) | 1.5 | 2 |
| Post pass | off | on | on |
| Antialias | off | off | on |
| Ridge layers | 3 | 5 | 5 |
| Mist bands | 2 | 4 | 6 |
| Qi motes | 60 | 150 | 320 |
| Instanced disciples | 8 | 16 | 24 |
| Water | off | on | on |

A watchdog samples frame times and moves the tier to fit the device: **down** on
a single bad window, **up** only after three consecutive comfortable ones and at
most twice. Once it has been forced down it stops trying to climb, so a device
sitting on the boundary settles instead of flapping.

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
passed 231 green checks while being plainly wrong on screen. They are found by
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
   x=−482, the moon sitting just above the top of frame.

## 8. Known gaps

- The rebirth sequence is an ink wipe and a camera move; the nascent soul
  lifting out of the body is a single glowing sphere on a spline, not authored
  animation.
- Expedition parties walk a straight line out of the gate and back rather than
  following the terrain.
- The `close` framing used by the Arts tab is a tighter version of the world
  shot; it does not yet show the meridian constellation as its own composition.
