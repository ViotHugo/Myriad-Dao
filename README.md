# Myriad Dao: Ascension

An idle cultivation game rendered as a Song-dynasty ink-wash mountain you can
breathe inside. You sit very still on a peak at dusk; centuries pass in the sky,
your sect grows in the valley below, and every number in the game is something
you can see out there.

Vanilla ES modules and one vendored copy of Three.js. No build step, no
framework, no downloaded art. **~1035 KB total**, and installable as a PWA.

```bash
npm run serve     # http://localhost:8123
npm test          # 256 engine checks
npm run balance   # assert the A18 pacing table
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
rising out of standing cloud, a plum tree that buds and blooms and sheds with
the stage you are on, cranes that gather as your name spreads, and a waterfall
that widens with your sect's mine. The landscape is a readout — how many peaks
stand clear of the cloud is your realm, and you can read it without looking at a
single number.

Everything is synthesised or generated: the mountains from seeded ridged noise,
the guqin from oscillators through a feedback-delay "valley echo", the icons
from a 60-line PNG encoder over `zlib`.

## Layout

```
js/data.js            every tuned number
js/engine.js          pure state + rules — no DOM, no WebGL, no Math.random
js/ui.js              DOM/CSS HUD
js/audio.js           synthesised WebAudio
js/view3d/            Three.js: shaders, world, scenery, avatar, sect, effects, camera
tools/balance-sim.js  plays the engine headlessly, checks pacing
tools/make-icons.js   regenerates the PWA icons
tests/run.js          256 checks
docs/DESIGN.md        art direction, performance budget, quality tiers, balance
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
