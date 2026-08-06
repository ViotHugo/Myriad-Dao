// How far along the landscape should look, given the player's state.
//
// Pure: no Three.js, no scene graph, no DOM. It lives apart from scenery.js so
// tests/run.js can reason about the mapping in Node without a renderer — the
// same rule the engine follows.

export function sceneryProgress(vm, tier) {
  const realmT = vm.realm / 7;
  const garden = vm.sect.founded ? vm.sect.facilities.garden : 0;
  const mine = vm.sect.founded ? vm.sect.facilities.mine : 0;
  return {
    // Ten thousand peaks: a range at Body Tempering, the whole world of them by
    // Immortal Ascension. The floor used to be 0.30, which at the opening realm
    // left about seven pillars scattered over three ranks — read as a few rocks,
    // not as a range, and the landscape has to be worth sitting in from the
    // first minute. The climb is what carries the progression; the floor only
    // has to clear "this is a mountain range".
    peakFraction: 0.52 + realmT * 0.48,
    // The sea of cloud sinks as you climb: early it is above you and hides the
    // range, by the last realms you look down on all of it.
    cloudDrop: realmT * 15,
    // The plum keeps time with the stage — in bud at Early, opening at Mid,
    // full in Late, shedding at Peak, when the qi is about to break anyway.
    //
    // The floor is 0.34, not 0.06. At 0.06 the opening realm showed nine
    // flowers on a thirty-seven-segment tree, which is not "a plum in bud" —
    // it is a **bare deciduous tree**, the exact silhouette stage 5 exists to
    // get out of this landscape, shipped in every first screenshot of the game.
    // A progression cue may run from a little to a lot; it may not run from
    // "wrong subject" to "right subject".
    blossom: [0.34, 0.60, 1.0, 0.76][vm.stage] ?? 0.6,
    petalRate: [0.05, 0.22, 0.45, 1.0][vm.stage] ?? 0.3,
    // The jianghu notices you: cranes gather as renown climbs.
    cranes: Math.min(tier.cranes, Math.round((vm.jianghu.renown / 99) * tier.cranes) + (vm.realm >= 2 ? 1 : 0)),
    // The sect's herb garden spills out of the valley and up the slope.
    bamboo: Math.min(tier.bamboo, garden * 3),
    // Spirit motes over the valley, one opened channel at a time.
    fireflies: vm.realm >= 3 ? Math.round((vm.meridians / 12) * tier.fireflies) : 0,
    // The fall only runs once the sect is drawing on the mountain.
    waterfall: vm.realm >= 2 || mine > 0,
    waterfallWidth: 0.7 + Math.min(1, mine / 6) * 0.9,
  };
}
