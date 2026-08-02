#!/usr/bin/env node
// Myriad Dao — headless balance simulator.
//
// Plays the engine with no DOM, no WebGL and no renderer, using a policy that
// approximates a competent player, and reports when each A18 milestone lands.
//
//   node tools/balance-sim.js                 # idle pacing
//   node tools/balance-sim.js --active        # sustained tapping
//   node tools/balance-sim.js --check         # assert the A18 table, exit 1 on drift
//   node tools/balance-sim.js --seeds 8       # average across seeds
//
// The engine is imported unchanged. If this stops running, the engine has
// picked up a dependency it should not have.

import {
  createGame, breakthroughCost, qiPerSecond, techCost, techLevel, meridianCost,
  shopCost, facilityCost, recruitCost, forgeCost, duelWindow, playerMight,
  duelTarget, sectCapacity, pillCost, data as D,
} from '../js/engine.js';
import { mulberry32 } from '../js/rng.js';
import { fmt, fmtTime } from '../js/format.js';

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, dflt) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};

const ACTIVE = has('--active');
const CHECK = has('--check');
const VERBOSE = has('--verbose');
const SEEDS = val('--seeds', CHECK ? 5 : 1);
const MAX_HOURS = val('--hours', 24);
// One deliberate tap per second, sustained. This is the cadence that reproduces
// A18's ACTIVE column; see docs/DESIGN.md "Where the spec disagrees with itself"
// for why a macro-speed 8Hz reading of A1 does not.
const TAPS_PER_SEC = val('--tps', 1);

/* ------------------------------------------------------------- the policy */

// Marginal qi/s gain per unit cost. Higher is a better buy.
function techValue(s, t) {
  const lvl = techLevel(s, t.id);
  if (lvl >= t.cap || s.realm < t.realm) return null;
  const ratio = (1 + t.per * (lvl + 1)) / (1 + t.per * lvl);
  const cost = techCost(s, t.id);
  return { id: t.id, kind: 'tech', cost, value: (ratio - 1) / cost };
}

function bestQiPurchase(game, { active }) {
  const s = game.state;
  const options = [];
  for (const t of D.TECHNIQUES) {
    if (t.type === 'tap' && !active) continue;
    if (t.type === 'break') {
      // Clarity buys breakthrough odds, not qi/s. Take it whenever it is cheap
      // relative to the current frontier — a failed tribulation costs more.
      const lvl = techLevel(s, t.id);
      if (lvl < t.cap && s.realm >= t.realm) {
        const cost = techCost(s, t.id);
        if (cost <= s.qi * 0.35) options.push({ id: t.id, kind: 'tech', cost, value: Infinity });
      }
      continue;
    }
    if (t.type === 'offline') {
      // Worth nothing to a continuously-running sim, but a real idler buys it,
      // and the qi it costs is qi not spent on breaking through. Model that.
      const lvl = techLevel(s, t.id);
      if (lvl < t.cap && s.realm >= t.realm) {
        const cost = techCost(s, t.id);
        if (cost <= s.qi * 0.15) options.push({ id: t.id, kind: 'tech', cost, value: Infinity });
      }
      continue;
    }
    const v = techValue(s, t);
    if (v) options.push(v);
  }
  if (s.meridians < D.MERIDIAN_COUNT) {
    const cost = meridianCost(s);
    options.push({ id: 'meridian', kind: 'meridian', cost, value: (D.MERIDIAN_BONUS - 1) / cost });
  }
  const affordable = options.filter((o) => o.cost <= s.qi);
  if (!affordable.length) return null;
  affordable.sort((a, b) => b.value - a.value);
  return affordable[0];
}

function spendQi(game, active) {
  const s = game.state;
  // Breakthrough always wins: the bottleneck is the point of the game.
  for (let guard = 0; guard < 40; guard++) {
    if (s.qi >= breakthroughCost(s) && s.deviationCd <= 0 && !s.pendingTrib) return;
    const buy = bestQiPurchase(game, { active });
    if (!buy) return;
    const r = buy.kind === 'meridian' ? game.openMeridian() : game.buyTechnique(buy.id);
    if (!r.ok) return;
  }
}

function spendStones(game, rand) {
  const s = game.state;
  for (let guard = 0; guard < 60; guard++) {
    let acted = false;

    // Spirit Gathering Arrays are the strongest flat qi/s per stone early.
    const arrayCost = shopCost(s, 'array');
    if (s.stones >= arrayCost) { game.buyShop('array'); acted = true; continue; }

    if (s.sect.founded) {
      // Scripture Pavilion is qi/s; the rest compounds the sect's own income.
      const order = ['pavilion', 'mine', 'garden', 'training', 'hall', 'forge'];
      for (const id of order) {
        const c = facilityCost(s, id);
        if (s.stones >= c * 2) { game.upgradeFacility(id); acted = true; break; }
      }
      if (acted) continue;
      if (s.sect.disciples.length < sectCapacity(s) && s.stones >= recruitCost(s) * 2) {
        game.recruitDisciple(); acted = true; continue;
      }
    } else if (s.realm >= D.SECT_REALM && s.stones >= D.SECT_FOUND_COST) {
      game.foundSect('Cloudreach Sect'); acted = true; continue;
    }

    // Keep the forge fed — the ring compounds every other income stream.
    const fc = forgeCost(s);
    if (s.realm >= D.FORGE_REALM && s.cores >= fc.cores && s.stones >= fc.stones * 3 && !s.pendingForge) {
      const slot = pickForgeSlot(s);
      const r = game.beginForge(slot);
      if (r.ok) {
        const cur = s.artifacts[slot];
        game.resolveForge(!cur || r.artifact.power > cur.power);
        acted = true;
        continue;
      }
    }

    // One talisman in the pocket before a major breakthrough.
    if (s.talismans < 1 && s.stage === 3 && s.stones >= shopCost(s, 'talisman') * 4) {
      game.buyShop('talisman'); acted = true; continue;
    }
    if (!acted) return;
  }
}

function pickForgeSlot(s) {
  // Ring first (it multiplies all loot), then robe (qi/s), then sword.
  const order = ['ring', 'robe', 'sword'];
  for (const id of order) if (!s.artifacts[id]) return id;
  let worst = order[0];
  for (const id of order) if ((s.artifacts[id]?.power || 0) < (s.artifacts[worst]?.power || 0)) worst = id;
  return worst;
}

function spendHerbs(game, active) {
  const s = game.state;
  for (let guard = 0; guard < 30; guard++) {
    const nine = pillCost(s, 'nineturn');
    if (s.herbs >= nine * 2) { game.brewPill('nineturn'); continue; }
    if (s.buffs.qi < 300 && s.herbs >= pillCost(s, 'qi') * 6) { game.brewPill('qi'); continue; }
    if (active && s.buffs.tap < 300 && s.herbs >= pillCost(s, 'marrow') * 6) { game.brewPill('marrow'); continue; }
    if (!s.insightPill && s.stage === 3 && s.herbs >= pillCost(s, 'insight') * 2) { game.brewPill('insight'); continue; }
    return;
  }
}

function runExpeditions(game) {
  const s = game.state;
  if (s.expedition || s.realm < D.DUEL_REALM) return;
  // Ruins pay best per minute once the wait is tolerable.
  const id = s.realm >= 2 ? 'ruins' : s.realm >= 1 ? 'beasts' : 'herbs';
  game.startExpedition(id);
}

function runDuels(game, rand) {
  const s = game.state;
  if (s.realm < D.DUEL_REALM || s.jianghu.cooldown > 0 || s.duel) return;
  const target = duelTarget(s);
  if (!target) return;
  const w = duelWindow(playerMight(s), target.might);
  if (w < 0.5) return; // a competent player does not pick fights they lose
  const r = game.beginDuel();
  if (!r.ok) return;
  let wins = 0;
  for (let i = 0; i < D.DUEL_CLASHES; i++) if (rand() < w) wins++;
  game.resolveDuel(wins);
}

function tryBreakthrough(game, rand) {
  const s = game.state;
  if (s.qi < breakthroughCost(s) || s.deviationCd > 0 || s.pendingTrib) return;
  const r = game.beginBreakthrough();
  if (!r.ok) return;
  if (r.kind === 'tribulation') {
    // The window's width IS the chance; a player of average skill lands it
    // exactly that often.
    game.resolveTribulation(rand() < r.chance);
  }
}

/* ------------------------------------------------------------- one run */

const MILESTONES = [
  { key: 'firstMinor', label: 'First minor breakthrough', hit: (s) => s.stage >= 1 || s.realm >= 1 },
  { key: 'realm1', label: '→ Qi Condensation', hit: (s) => s.realm >= 1 },
  { key: 'realm2', label: '→ Foundation (alchemy + forge)', hit: (s) => s.realm >= 2 },
  { key: 'realm3', label: '→ Core Formation (sect)', hit: (s) => s.realm >= 3 },
  { key: 'realm4', label: 'First reincarnation (Nascent Soul)', hit: (s) => s.realm >= 4 },
  { key: 'life2', label: 'Life 2 — Spirit Severing', hit: (s) => s.stats.rebirths >= 1 && s.realm >= 5 },
  { key: 'life3', label: 'Life 3 — Dao Seeking', hit: (s) => s.stats.rebirths >= 2 && s.realm >= 6 },
  { key: 'life4', label: 'Life 4 — Immortal Ascension', hit: (s) => s.stats.rebirths >= 3 && s.realm >= 7 },
];

function simulate(seed, { active }) {
  const rand = mulberry32(seed);
  const game = createGame({ random: rand, state: null });
  game.state.seed = seed;

  const s = game.state;
  const times = {};
  const pending = MILESTONES.slice();
  const dt = 1;
  const maxTicks = MAX_HOURS * 3600;

  for (let t = 0; t < maxTicks; t++) {
    game.tick(dt);
    if (active) {
      for (let i = 0; i < TAPS_PER_SEC; i++) game.cultivate();
    }

    runExpeditions(game);
    spendHerbs(game, active);
    spendStones(game, rand);
    spendQi(game, active);
    tryBreakthrough(game, rand);
    runDuels(game, rand);

    // Reincarnate one realm deeper each life, exactly as A18 describes.
    const targetRealm = Math.min(D.REALMS.length - 1, 4 + s.stats.rebirths);
    if (s.realm >= targetRealm && s.realm >= D.REBIRTH_REALM && s.realm < D.REALMS.length - 1) {
      // Take the whole realm before stepping into the wheel.
      if (s.stage >= 3 && s.qi >= breakthroughCost(s) * 0.4) game.reincarnate();
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].hit(s)) {
        times[pending[i].key] = t + 1;
        pending.splice(i, 1);
      }
    }
    if (!pending.length) break;
  }
  return { times, state: s, game };
}

/* ------------------------------------------------------------- reporting */

// Guard bands around the A18 table. A retune that leaves a band has changed the
// game's pacing and needs justifying in docs/DESIGN.md, not waving through.
// `spec` is A18's published figure, for the printed comparison.
const TARGETS = {
  idle: {
    firstMinor: { spec: 60,          band: [30, 180] },
    realm1:     { spec: 31 * 60,     band: [20 * 60, 50 * 60] },
    realm2:     { spec: 1.8 * 3600,  band: [1.1 * 3600, 2.6 * 3600] },
    realm3:     { spec: 2.7 * 3600,  band: [1.6 * 3600, 3.8 * 3600] },
    realm4:     { spec: 3.5 * 3600,  band: [2.2 * 3600, 5.0 * 3600] },
    life4:      { spec: 11.5 * 3600, band: [5 * 3600, 16 * 3600] },
  },
  active: {
    firstMinor: { spec: 40,          band: [15, 90] },
    realm1:     { spec: 17 * 60,     band: [10 * 60, 40 * 60] },
    realm2:     { spec: 37 * 60,     band: [25 * 60, 90 * 60] },
    realm3:     { spec: 46 * 60,     band: [30 * 60, 110 * 60] },
    realm4:     { spec: 55 * 60,     band: [35 * 60, 120 * 60] },
    life4:      { spec: 3.5 * 3600,  band: [1.5 * 3600, 6 * 3600] },
  },
};

function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

function run(mode) {
  const active = mode === 'active';
  const runs = [];
  for (let i = 0; i < SEEDS; i++) runs.push(simulate(1337 + i * 7919, { active }));

  const rows = MILESTONES.map((m) => {
    const hits = runs.map((r) => r.times[m.key]).filter((x) => x !== undefined);
    return {
      key: m.key,
      label: m.label,
      reached: hits.length,
      median: hits.length ? median(hits) : null,
    };
  });

  const width = Math.max(...MILESTONES.map((m) => m.label.length));
  const label = active ? `ACTIVE (${TAPS_PER_SEC} tap/s sustained)` : 'IDLE (no tapping)';
  console.log(`\n  ${label} — median of ${SEEDS} seed${SEEDS > 1 ? 's' : ''}`);
  console.log(`  ${'milestone'.padEnd(width)}  ${'sim'.padStart(9)}  ${'A18'.padStart(9)}`);
  console.log('  ' + '-'.repeat(width + 32));
  let failures = 0;
  for (const r of rows) {
    const target = TARGETS[mode][r.key];
    let note = '';
    let spec = '';
    if (target) {
      spec = fmtTime(target.spec);
      const [lo, hi] = target.band;
      if (r.median === null) { note = '  MISSED'; failures++; }
      else if (r.median < lo || r.median > hi) {
        note = `  OUT OF BAND [${fmtTime(lo)}..${fmtTime(hi)}]`;
        failures++;
      } else note = '  ok';
    }
    const t = r.median === null ? '—' : fmtTime(r.median);
    console.log(`  ${r.label.padEnd(width)}  ${t.padStart(9)}  ${spec.padStart(9)}${note}`);
  }

  if (VERBOSE) {
    const s = runs[0].state;
    console.log(`\n  seed 1337 end state: ${D.REALMS[s.realm].name} ${D.STAGE_NAMES[s.stage]}`);
    console.log(`    qi/s ${fmt(qiPerSecond(s))}  insight ${s.insight}  rebirths ${s.stats.rebirths}`);
    console.log(`    meridians ${s.meridians}/12  mastered ${D.masteredCount(s)}/10  records ${Object.keys(s.records).length}/35`);
    console.log(`    rank ${s.jianghu.rank}  renown +${Math.max(0, 100 - s.jianghu.rank)}%  age ${Math.floor(s.age)}`);
    console.log(`    sect ${s.sect.founded ? `${s.sect.name} (${s.sect.disciples.length} disciples)` : 'none'}`);
    console.log(`    stones ${fmt(s.stones)}  herbs ${fmt(s.herbs)}  cores ${fmt(s.cores)}`);
    for (const t of D.TECHNIQUES) {
      const lvl = techLevel(s, t.id);
      if (lvl) console.log(`      ${t.name.padEnd(30)} ${lvl}/${t.cap}`);
    }
    console.log('\n  qi/s decomposition (seed 1337):');
    const parts = [
      ['realm', D.REALMS[s.realm].mult],
      ['stage', Math.pow(D.STAGE_BONUS, s.stage)],
      ['techniques', D.TECHNIQUES.reduce((m, t) => (t.type === 'qi' ? m * (1 + t.per * techLevel(s, t.id)) : m), 1)],
      ['meridians', Math.pow(D.MERIDIAN_BONUS, s.meridians)],
      [`arrays x${s.arrays}`, 1 + 0.5 * s.arrays],
      [`nine-turn x${s.nineTurn}`, 1 + 0.02 * s.nineTurn],
      [`insight x${s.insight}`, 1 + 0.1 * s.insight],
      [`pavilion L${s.sect.facilities.pavilion}`, 1 + 0.1 * s.sect.facilities.pavilion],
      ['robe', 1 + (s.artifacts.robe?.power || 0) / 100],
      ['renown', 1 + Math.max(0, 100 - s.jianghu.rank) / 100],
      ['records', 1 + Object.keys(s.records).reduce((n, k) => n + (D.RECORD_BY_ID[k]?.bonus || 0), 0) / 100],
    ];
    for (const [label, mult] of parts) console.log(`    ${label.padEnd(18)} ×${fmt(mult)}`);
  }
  return failures;
}

let fails = 0;
if (CHECK) {
  fails += run('idle');
  fails += run('active');
  console.log(fails === 0 ? '\n  balance: PASS\n' : `\n  balance: ${fails} milestone(s) outside band\n`);
  process.exit(fails === 0 ? 0 : 1);
} else {
  run(ACTIVE ? 'active' : 'idle');
  console.log('');
}
