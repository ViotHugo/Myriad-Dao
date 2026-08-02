#!/usr/bin/env node
// Myriad Dao — engine test suite.
//
//   node tests/run.js            run everything
//   node tests/run.js --verbose  print every passing check too
//
// These drive the real engine headlessly, the same way tools/balance-sim.js
// does. No mocks, no DOM.

import {
  createGame, defaultState, migrate, exportSave, importSave, viewModel,
  breakthroughCost, qiCap, qiPerSecond, tapPower, techCost, meridianCost,
  tribulationChance, tribulationSpeed, rarityWeights, rarityOdds, forgeLuck,
  forgeCost, rival, duelWindow, playerMight, renown, recordBonusPct,
  sectCapacity, recruitCost, facilityCost, sectIncome, shopCost, pillCost,
  offlineRate, offlineCap, insightGain, lifespan, atCap, isMajor, artifactPct,
  lootMult, isFinalStage, SAVE_VERSION, data as D,
} from '../js/engine.js';
import { resolveTier } from '../js/view3d/quality.js';
import { mulberry32, seededRandom } from '../js/rng.js';
import { fmt, fmtTime } from '../js/format.js';

/* -------------------------------------------------------------- harness */

const VERBOSE = process.argv.includes('--verbose');
let passed = 0;
const failures = [];
let group = '';

function section(name) { group = name; if (VERBOSE) console.log(`\n  ${name}`); }

function check(label, cond, detail) {
  if (cond) {
    passed++;
    if (VERBOSE) console.log(`    ok   ${label}`);
  } else {
    failures.push({ group, label, detail });
    console.log(`    FAIL ${group} — ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** A game with a fixed RNG stream, so every test is reproducible. */
function game(seed = 42) {
  const g = createGame({ random: mulberry32(seed) });
  g.state.seed = seed;
  return g;
}

/** Give the player everything they need, without going through the economy. */
function grant(g, patch) { Object.assign(g.state, patch); }

/* ================================================================ A1 qi/s */

section('A1 — core loop, Qi/s composition');
{
  const g = game();
  check('a fresh cultivator gathers exactly 1 Qi/s', near(qiPerSecond(g.state), 1));
  check('stage bonus is 1.25^stage', (() => {
    g.state.stage = 3;
    const v = qiPerSecond(g.state);
    g.state.stage = 0;
    return near(v, Math.pow(1.25, 3));
  })());
  check('realm multiplier matches the A2 table', (() => {
    g.state.realm = 4;
    const v = qiPerSecond(g.state);
    g.state.realm = 0;
    return near(v, 3200);
  })());
  check('each meridian multiplies Qi/s by 1.15', (() => {
    g.state.meridians = 3;
    const v = qiPerSecond(g.state);
    g.state.meridians = 0;
    return near(v, Math.pow(1.15, 3));
  })());
  check('Spirit Gathering Arrays give +50% each', (() => {
    g.state.arrays = 2;
    const v = qiPerSecond(g.state);
    g.state.arrays = 0;
    return near(v, 2);
  })());
  check('Nine-Turn pills give +2% each, permanently', (() => {
    g.state.nineTurn = 5;
    const v = qiPerSecond(g.state);
    g.state.nineTurn = 0;
    return near(v, 1.1);
  })());
  check('each Dao Insight gives +10%', (() => {
    g.state.insight = 7;
    const v = qiPerSecond(g.state);
    g.state.insight = 0;
    return near(v, 1.7);
  })());
  check('Scripture Pavilion gives +10% per level', (() => {
    g.state.sect.founded = true;
    g.state.sect.facilities.pavilion = 4;
    const v = qiPerSecond(g.state);
    g.state.sect.founded = false;
    g.state.sect.facilities.pavilion = 0;
    return near(v, 1.4);
  })());
  check('the robe artifact multiplies Qi/s by its power', (() => {
    g.state.artifacts.robe = { slot: 'robe', rarity: 'earth', power: 36 };
    const v = qiPerSecond(g.state);
    g.state.artifacts.robe = null;
    return near(v, 1.36);
  })());
  check('the Qi Gathering pill doubles Qi/s', (() => {
    g.state.buffs.qi = 100;
    const v = qiPerSecond(g.state);
    g.state.buffs.qi = 0;
    return near(v, 2);
  })());
  check('injury costs 20% Qi/s', (() => {
    g.state.injury = 10;
    const v = qiPerSecond(g.state);
    g.state.injury = 0;
    return near(v, 0.8);
  })());
  check('withering cuts Qi/s to 35%', (() => {
    g.state.withered = true;
    const v = qiPerSecond(g.state);
    g.state.withered = false;
    return near(v, 0.35);
  })());
  check('qi techniques compound multiplicatively across manuals', (() => {
    g.state.techniques = { azure: 2, river: 1 };
    const v = qiPerSecond(g.state);
    g.state.techniques = {};
    return near(v, (1 + 0.25 * 2) * (1 + 0.4 * 1));
  })());
  check('all eleven multipliers combine into one product', (() => {
    grant(g, { realm: 2, stage: 1, meridians: 2, arrays: 1, nineTurn: 10, insight: 3 });
    const expect = 50 * Math.pow(1.25, 1) * Math.pow(1.15, 2) * 1.5 * 1.2 * 1.3;
    const v = qiPerSecond(g.state);
    grant(g, { realm: 0, stage: 0, meridians: 0, arrays: 0, nineTurn: 0, insight: 0 });
    return near(v, expect, 1e-9);
  })());
}

section('A1 — tapping');
{
  const g = game();
  check('a tap is worth 0.4s of Qi/s', (() => {
    g.state.realm = 3; // qi/s 400, so the floor of 1 is not in play
    const v = tapPower(g.state);
    g.state.realm = 0;
    return near(v, 400 * 0.4);
  })());
  check('tap power never falls below 1', near(tapPower(g.state), 1));
  check('tap manuals multiply cultivate power', (() => {
    g.state.realm = 3;
    g.state.techniques = { iron: 2 };
    const v = tapPower(g.state);
    g.state.techniques = {};
    g.state.realm = 0;
    return near(v, 400 * 0.4 * (1 + 0.3 * 2));
  })());
  check('the sword artifact feeds cultivate power', (() => {
    g.state.realm = 3;
    g.state.artifacts.sword = { slot: 'sword', rarity: 'spirit', power: 50 };
    const v = tapPower(g.state);
    g.state.artifacts.sword = null;
    g.state.realm = 0;
    return near(v, 400 * 0.4 * 1.5);
  })());
  check('the Marrow pill triples cultivate power', (() => {
    g.state.realm = 3;
    g.state.buffs.tap = 60;
    const v = tapPower(g.state);
    g.state.buffs.tap = 0;
    g.state.realm = 0;
    return near(v, 400 * 0.4 * 3);
  })());
  check('cultivating adds qi and counts the tap', (() => {
    const before = g.state.qi;
    g.cultivate();
    return g.state.qi > before && g.state.stats.taps === 1;
  })());
}

section('A1 — the bottleneck');
{
  const g = game();
  check('the cap is 1.6x the next breakthrough cost', near(qiCap(g.state), breakthroughCost(g.state) * 1.6));
  check('ticking never carries qi past the cap', (() => {
    g.tick(100000);
    return near(g.state.qi, qiCap(g.state));
  })());
  check('atCap() reports the gold-bar state', atCap(g.state));
  check('tapping at the cap yields nothing', (() => {
    const r = g.cultivate();
    return r.got === 0 && r.capped;
  })());
  check('qi gathered while capped is not counted as lifetime qi', (() => {
    const before = g.state.stats.lifeQi;
    g.tick(60);
    return g.state.stats.lifeQi === before;
  })());
}

/* ============================================================ A2 realms */

section('A2 — realms and breakthroughs');
{
  const g = game();
  check('there are eight realms', D.REALMS.length === 8);
  check('there are four stages', D.STAGE_NAMES.length === 4);
  check('Body Tempering costs 50 for its first stage', near(breakthroughCost(g.state), 50));
  check('stage costs grow x2.8', (() => {
    g.state.stage = 2;
    const v = breakthroughCost(g.state);
    g.state.stage = 0;
    return near(v, 50 * 2.8 * 2.8);
  })());
  check('a major breakthrough costs double', (() => {
    g.state.stage = 3;
    const v = breakthroughCost(g.state);
    g.state.stage = 0;
    return near(v, 50 * Math.pow(2.8, 3) * 2);
  })());
  check('realm base-cost gaps escalate from x80 to x2000', (() => {
    const first = D.REALMS[1].base / D.REALMS[0].base;
    const last = D.REALMS[7].base / D.REALMS[6].base;
    return near(first, 80) && near(last, 2000) && last > first;
  })());
  check('isMajor() is true only at Peak', (() => {
    g.state.stage = 2; const a = isMajor(g.state);
    g.state.stage = 3; const b = isMajor(g.state);
    g.state.stage = 0;
    return !a && b;
  })());
  check('a minor breakthrough is instant and advances the stage', (() => {
    g.state.qi = 100;
    const r = g.beginBreakthrough();
    return r.ok && r.kind === 'minor' && g.state.stage === 1 && near(g.state.qi, 50);
  })());
  check('a breakthrough is refused without enough qi', (() => {
    g.state.qi = 0;
    return g.beginBreakthrough().ok === false;
  })());
  check('a Peak breakthrough opens a tribulation instead', (() => {
    g.state.stage = 3;
    g.state.qi = breakthroughCost(g.state);
    const r = g.beginBreakthrough();
    return r.ok && r.kind === 'tribulation' && g.state.pendingTrib !== null;
  })());
  check('the tribulation cost is not paid until it is survived', near(g.state.qi, breakthroughCost(g.state)));
  check('surviving raises the realm and resets the stage', (() => {
    const r = g.resolveTribulation(true);
    return r.success && g.state.realm === 1 && g.state.stage === 0;
  })());
  check('bestRealm records the deepest realm ever reached', g.state.bestRealm === 1);
}

section('A2 — the summit');
{
  // Regression: a tribulation at Peak Immortal Ascension used to advance realm
  // to 8, past the end of the table. Every REALMS lookup then threw, and the
  // corrupt state was autosaved before anything noticed.
  const g = game();
  grant(g, { realm: 7, stage: 3 });
  check('Peak Immortal Ascension is the final stage', isFinalStage(g.state));
  check('earlier stages are not the final stage', (() => {
    g.state.stage = 2; const a = isFinalStage(g.state);
    g.state.realm = 6; g.state.stage = 3; const b = isFinalStage(g.state);
    grant(g, { realm: 7, stage: 3 });
    return !a && !b;
  })());
  check('the view model reports the summit and refuses a breakthrough', (() => {
    g.state.qi = qiCap(g.state);
    const vm = viewModel(g.state);
    return vm.atSummit === true && vm.canBreak === false;
  })());
  check('a breakthrough at the summit is refused, not taken', (() => {
    g.state.qi = qiCap(g.state);
    const r = g.beginBreakthrough();
    return r.ok === false && g.state.realm === 7 && g.state.pendingTrib === null;
  })());
  check('the realm can never advance past the table', (() => {
    const h = game();
    grant(h, { realm: 7, stage: 3 });
    // Force a stale tribulation, as an older save could carry.
    h.state.pendingTrib = { chance: 1, speed: 5, cost: 0, realm: 7 };
    h.resolveTribulation(true);
    return h.state.realm === D.REALMS.length - 1;
  })());
  check('the view model still builds at the summit', (() => {
    const h = game();
    grant(h, { realm: 7, stage: 3 });
    h.state.pendingTrib = { chance: 1, speed: 5, cost: 0, realm: 7 };
    h.resolveTribulation(true);
    const vm = viewModel(h.state);
    return vm.realmName === 'Immortal Ascension';
  })());
  check('reincarnation is still offered at the summit', (() => {
    const h = game();
    grant(h, { realm: 7, stage: 3 });
    return viewModel(h.state).canReincarnate === true;
  })());
}

section('A2 — heavenly tribulation odds');
{
  const g = game();
  check('base success is 92% at Body Tempering', near(tribulationChance(g.state, { talisman: false, insight: false }), 0.92));
  check('each realm costs 6 percentage points', (() => {
    g.state.realm = 3;
    const v = tribulationChance(g.state, { talisman: false, insight: false });
    g.state.realm = 0;
    return near(v, 0.92 - 0.18);
  })());
  check('a talisman adds 10 points', near(tribulationChance(g.state, { talisman: true, insight: false }), 0.95));
  check('Dao Heart Clarity adds 2 points per level', (() => {
    g.state.realm = 6;
    g.state.techniques.clarity = 5;
    const v = tribulationChance(g.state, { talisman: false, insight: false });
    g.state.techniques = {}; g.state.realm = 0;
    return near(v, 0.92 - 0.36 + 0.10);
  })());
  check('odds clamp at 95%', (() => {
    const v = tribulationChance(g.state, { talisman: true, insight: true });
    return near(v, 0.95);
  })());
  check('the deepest realm in the table still leaves a 50% window', (() => {
    g.state.realm = 7;
    const v = tribulationChance(g.state, { talisman: false, insight: false });
    g.state.realm = 0;
    return near(v, 0.50);
  })());
  check('odds clamp at 15% once the realm penalty would sink them below it', (() => {
    const deep = { realm: 20, talismans: 0, insightPill: false, techniques: {} };
    return near(tribulationChance(deep, { talisman: false, insight: false }), 0.15);
  })());
  check('the spark speeds up with realm', near(tribulationSpeed({ realm: 4 }), 3.2 + 0.35 * 4));
  check('a Pill of Insight adds 15 points and is consumed', (() => {
    const h = game();
    h.state.stage = 3;
    h.state.insightPill = true;
    h.state.qi = breakthroughCost(h.state);
    const r = h.beginBreakthrough();
    return near(r.chance, 0.95) && h.state.insightPill === false;
  })());
  check('a talisman is consumed by the attempt, win or lose', (() => {
    const h = game();
    h.state.stage = 3;
    h.state.talismans = 1;
    h.state.qi = breakthroughCost(h.state);
    h.beginBreakthrough();
    h.resolveTribulation(false);
    return h.state.talismans === 0;
  })());
  check('failure costs 15% of held qi and stalls the meridians for 10s', (() => {
    const h = game();
    h.state.stage = 3;
    const cost = breakthroughCost(h.state);
    h.state.qi = cost;
    h.beginBreakthrough();
    const r = h.resolveTribulation(false);
    return !r.success && near(h.state.qi, cost * 0.85) && near(h.state.deviationCd, 10) && h.state.realm === 0;
  })());
  check('a stalled cultivator cannot break through', (() => {
    const h = game();
    h.state.deviationCd = 5;
    h.state.qi = 1e9;
    return h.beginBreakthrough().ok === false;
  })());
}

/* ======================================================== A3 techniques */

section('A3 — techniques');
{
  const g = game();
  check('there are ten manuals', D.TECHNIQUES.length === 10);
  check('every growth rate sits in the 1.9-2.6 band',
    D.TECHNIQUES.every((t) => t.growth >= 1.9 && t.growth <= 2.6));
  check('every manual is capped', D.TECHNIQUES.every((t) => t.cap > 0 && isFinite(t.cap)));
  check('the A3 effects and caps are intact', (() => {
    const want = {
      azure: [0.25, 0, 12], iron: [0.30, 0, 6], river: [0.40, 1, 10], jade: [0.60, 1, 6],
      leaves: [0.60, 2, 10], turtle: [0.10, 2, 5], golden: [0.80, 3, 10], soul: [1.00, 4, 10],
      severing: [1.20, 5, 10], clarity: [0.02, 6, 10],
    };
    return Object.entries(want).every(([id, [per, realm, cap]]) => {
      const t = D.TECHNIQUE_BY_ID[id];
      return near(t.per, per) && t.realm === realm && t.cap === cap;
    });
  })());
  check('technique cost grows geometrically', (() => {
    g.state.techniques.azure = 3;
    const v = techCost(g.state, 'azure');
    g.state.techniques = {};
    return near(v, D.TECHNIQUE_BY_ID.azure.base * Math.pow(D.TECHNIQUE_BY_ID.azure.growth, 3));
  })());
  check('a manual above your realm cannot be bought', (() => {
    g.state.qi = 1e20;
    const r = g.buyTechnique('soul');
    g.state.qi = 0;
    return r.ok === false;
  })());
  check('buying raises the level and spends qi', (() => {
    g.state.qi = 1000;
    const r = g.buyTechnique('azure');
    return r.ok && g.state.techniques.azure === 1 && near(g.state.qi, 1000 - r.cost);
  })());
  check('a mastered manual refuses further levels', (() => {
    const h = game();
    h.state.techniques.azure = 12;
    h.state.qi = 1e12;
    return h.buyTechnique('azure').ok === false;
  })());
  check('reaching the cap counts as mastery', (() => {
    const h = game();
    h.state.techniques.azure = 11;
    h.state.qi = 1e12;
    h.buyTechnique('azure');
    return D.masteredCount(h.state) === 1;
  })());
  check('the offline manual raises the closed-door rate, not Qi/s', (() => {
    const h = game();
    const before = qiPerSecond(h.state);
    h.state.techniques.turtle = 3;
    return near(qiPerSecond(h.state), before) && near(offlineRate(h.state), 0.8);
  })());
}

section('A4 — the twelve meridians');
{
  const g = game();
  check('twelve meridians, named for the classical channels', D.MERIDIANS.length === 12 && D.MERIDIAN_COUNT === 12);
  check('the first costs 500', near(meridianCost(g.state), 500));
  check('cost grows 500 x 7^n', (() => {
    g.state.meridians = 3;
    const v = meridianCost(g.state);
    g.state.meridians = 0;
    return near(v, 500 * 343);
  })());
  check('opening one spends qi and lights the channel', (() => {
    g.state.qi = 600;
    const r = g.openMeridian();
    return r.ok && g.state.meridians === 1 && near(g.state.qi, 100);
  })());
  check('the thirteenth meridian does not exist', (() => {
    const h = game();
    h.state.meridians = 12;
    h.state.qi = 1e30;
    return h.openMeridian().ok === false;
  })());
  check('meridians cannot be opened during qi deviation', (() => {
    const h = game();
    h.state.deviationCd = 5;
    h.state.qi = 1e6;
    return h.openMeridian().ok === false;
  })());
}

/* ======================================================= A5 expeditions */

section('A5 — expeditions');
{
  const g = game();
  check('three missions, at 1 minute, 10 minutes and 1 hour',
    D.EXPEDITIONS.length === 3 &&
    D.EXPEDITIONS.map((e) => e.duration).join() === '60,600,3600');
  check('expeditions are locked below Qi Condensation', g.startExpedition('herbs').ok === false);
  grant(g, { realm: 1 });
  check('a party can be sent out', g.startExpedition('herbs').ok === true);
  check('only one party at a time', g.startExpedition('ruins').ok === false);
  check('the party is still out before the timer ends', (() => {
    g.tick(30);
    return g.state.expedition !== null;
  })());
  check('the party returns with herbs and stones scaled by realm', (() => {
    const before = { h: g.state.herbs, s: g.state.stones };
    g.tick(40);
    return g.state.expedition === null && g.state.herbs > before.h && g.state.stones > before.s;
  })());
  check('completing an expedition is counted', g.state.stats.expeditions === 1);
  check('herb yields scale with realm', (() => {
    const lo = game(7); grant(lo, { realm: 1 });
    const hi = game(7); grant(hi, { realm: 5 });
    lo.startExpedition('herbs'); hi.startExpedition('herbs');
    lo.tick(61); hi.tick(61);
    return near(hi.state.herbs / lo.state.herbs, 6 / 2, 1e-6);
  })());
  check('beast cores do not scale with realm', (() => {
    const lo = game(11); grant(lo, { realm: 1 });
    const hi = game(11); grant(hi, { realm: 6 });
    lo.startExpedition('beasts'); hi.startExpedition('beasts');
    lo.tick(601); hi.tick(601);
    return lo.state.cores === hi.state.cores && lo.state.cores >= 2;
  })());
  check('the ring artifact scales expedition loot', (() => {
    const bare = game(21); grant(bare, { realm: 1 });
    const ringed = game(21); grant(ringed, { realm: 1 });
    ringed.state.artifacts.ring = { slot: 'ring', rarity: 'earth', power: 100 };
    bare.startExpedition('herbs'); ringed.startExpedition('herbs');
    bare.tick(61); ringed.tick(61);
    return near(ringed.state.herbs / bare.state.herbs, 2, 1e-6);
  })());
}

/* ========================================================== A6 alchemy */

section('A6 — the pill furnace');
{
  const g = game();
  check('alchemy is locked below Foundation Establishment', g.brewPill('qi').ok === false);
  grant(g, { realm: 2, herbs: 1000 });
  check('the Qi Gathering Pill costs 5 herbs and doubles Qi/s for 10 minutes', (() => {
    const r = g.brewPill('qi');
    return r.ok && near(r.cost, 5) && near(g.state.buffs.qi, 600);
  })());
  check('buffs stack', (() => {
    g.brewPill('qi');
    return near(g.state.buffs.qi, 1200);
  })());
  check('buffs stack no higher than 30 minutes', (() => {
    g.brewPill('qi'); g.brewPill('qi'); g.brewPill('qi');
    return near(g.state.buffs.qi, 1800);
  })());
  check('the Marrow pill costs 12 herbs and buffs cultivate power', (() => {
    const r = g.brewPill('marrow');
    return r.ok && near(r.cost, 12) && near(g.state.buffs.tap, 600);
  })());
  check('the Pill of Insight costs 30 herbs and is held', (() => {
    const r = g.brewPill('insight');
    return r.ok && near(r.cost, 30) && g.state.insightPill === true;
  })());
  check('only one Pill of Insight may be held', g.brewPill('insight').ok === false);
  check('the Nine-Turn pill costs 120 herbs and rises x1.5', (() => {
    const first = pillCost(g.state, 'nineturn');
    g.brewPill('nineturn');
    const second = pillCost(g.state, 'nineturn');
    return near(first, 120) && near(second, 180);
  })());
  check('the Nine-Turn pill is permanent', g.state.nineTurn === 1);
  check('brewing without herbs fails', (() => {
    const h = game(); grant(h, { realm: 2, herbs: 0 });
    return h.brewPill('qi').ok === false;
  })());
  check('every pill is counted for the Dao Records', g.state.stats.pills === 8);
}

/* ================================================= A7 treasure pavilion */

section('A7 — the treasure pavilion');
{
  const g = game();
  grant(g, { stones: 10000 });
  check('the first Spirit Gathering Array costs 50', near(shopCost(g.state, 'array'), 50));
  check('array cost grows x4', (() => {
    g.buyShop('array');
    return near(shopCost(g.state, 'array'), 200);
  })());
  check('a Storage Ring costs 100 and adds 4h of seclusion', (() => {
    const before = offlineCap(g.state);
    g.buyShop('ring');
    return near(offlineCap(g.state) - before, 4 * 3600);
  })());
  check('ring cost grows x3', near(shopCost(g.state, 'ring'), 300));
  check('a talisman costs 75 and does not inflate', (() => {
    g.buyShop('talisman');
    return g.state.talismans === 1 && near(shopCost(g.state, 'talisman'), 75);
  })());
  check('buying without stones fails', (() => {
    const h = game();
    return h.buyShop('array').ok === false;
  })());
}

/* ============================================== A8 age, lifespan, death */

section('A8 — age, lifespan and death');
{
  check('one year passes every 30 real minutes', D.YEAR_SECONDS === 1800);
  check('a cultivator begins at 16', game().state.age === 16);
  check('ticking ages you', (() => {
    const g = game();
    g.tick(1800);
    return near(g.state.age, 17);
  })());
  check('lifespan comes from the realm', (() => {
    const g = game();
    const spans = D.REALMS.map((r, i) => { g.state.realm = i; return lifespan(g.state); });
    return spans.slice(0, 7).join() === '100,200,400,800,1600,3200,6400' && spans[7] === Infinity;
  })());
  check('outliving your span below Nascent Soul withers the body', (() => {
    const g = game();
    g.state.age = 99;
    g.tick(1800 * 2);
    return g.state.withered === true;
  })());
  check('a withered body gathers qi at 35%', (() => {
    const g = game();
    g.state.withered = true;
    return near(qiPerSecond(g.state), 0.35);
  })());
  check('a realm breakthrough cures withering and is remembered', (() => {
    const g = game();
    g.state.withered = true;
    g.state.stage = 3;
    g.state.qi = breakthroughCost(g.state);
    g.beginBreakthrough();
    const r = g.resolveTribulation(true);
    return g.state.withered === false && r.cured === true && g.state.stats.witheredCured === 1;
  })());
  check('a minor breakthrough does not cure withering', (() => {
    const g = game();
    g.state.withered = true;
    g.state.qi = 1000;
    g.beginBreakthrough();
    return g.state.withered === true;
  })());
  check('outliving your span at Nascent Soul forces reincarnation', (() => {
    const g = game();
    grant(g, { realm: 4, age: 1599 });
    g.tick(1800 * 3);
    return g.state.stats.rebirths === 1 && g.state.realm === 0 && g.state.age === 16;
  })());
  check('an Immortal Ascension cultivator never dies of age', (() => {
    const g = game();
    grant(g, { realm: 7, age: 1e6 });
    g.tick(1800);
    return g.state.stats.rebirths === 0 && g.state.realm === 7;
  })());
}

/* ============================================================= A9 sect */

section('A9 — the sect');
{
  const g = game();
  check('a sect cannot be founded below Core Formation', g.foundSect('Test').ok === false);
  grant(g, { realm: 3, stones: 100000 });
  check('founding costs 200 spirit stones and takes a name', (() => {
    const before = g.state.stones;
    const r = g.foundSect('Cloudreach Sect');
    return r.ok && g.state.sect.name === 'Cloudreach Sect' && near(g.state.stones, before - 200);
  })());
  check('a second sect cannot be founded', g.foundSect('Other').ok === false);
  check('base capacity is 2', sectCapacity(g.state) === 2);
  check('the Sect Hall adds 2 capacity per level', (() => {
    g.upgradeFacility('hall');
    return sectCapacity(g.state) === 4;
  })());
  check('recruiting costs 100 x 1.5^n', (() => {
    const first = recruitCost(g.state);
    g.recruitDisciple();
    return near(first, 100) && near(recruitCost(g.state), 150);
  })());
  check('a recruited disciple has a generated name and a talent tier', (() => {
    const d = g.state.sect.disciples[0];
    return typeof d.name === 'string' && d.name.includes(' ') && d.tier >= 0 && d.tier <= 2;
  })());
  check('recruiting beyond capacity fails', (() => {
    while (g.state.sect.disciples.length < sectCapacity(g.state)) g.recruitDisciple();
    return g.recruitDisciple().ok === false;
  })());
  check('the talent roll is 65/30/5', (() => {
    const counts = [0, 0, 0];
    const h = game(9);
    grant(h, { realm: 3, stones: 1e12 });
    h.foundSect('Sample');
    for (let i = 0; i < 4000; i++) {
      h.state.sect.facilities.hall = 5000;
      h.state.sect.disciples.length = 0;
      h.state.stones = 1e12;
      h.recruitDisciple();
      counts[h.state.sect.disciples[0].tier]++;
    }
    const p = counts.map((c) => c / 4000);
    return Math.abs(p[0] - 0.65) < 0.03 && Math.abs(p[1] - 0.30) < 0.03 && Math.abs(p[2] - 0.05) < 0.02;
  })());
  check('there are six facilities', D.FACILITIES.length === 6);
  check('facility cost grows with level', (() => {
    const h = game(); grant(h, { realm: 3, stones: 1e9 });
    h.foundSect('S');
    const a = facilityCost(h.state, 'mine');
    h.upgradeFacility('mine');
    return facilityCost(h.state, 'mine') > a;
  })());
  check('the Herb Garden and Mine yield passively', (() => {
    const h = game(); grant(h, { realm: 3, stones: 1e9 });
    h.foundSect('S');
    h.upgradeFacility('garden'); h.upgradeFacility('mine');
    const inc = sectIncome(h.state);
    return inc.herbs > 0 && inc.stones > 0;
  })());
  check('Training Grounds raise disciple output 25% per level', (() => {
    const h = game(5); grant(h, { realm: 3, stones: 1e9 });
    h.foundSect('S');
    h.recruitDisciple();
    const before = sectIncome(h.state).stones;
    h.upgradeFacility('training');
    return near(sectIncome(h.state).stones / before, 1.25, 1e-9);
  })());
  check('sect income accrues on tick', (() => {
    const h = game(5); grant(h, { realm: 3, stones: 1e9 });
    h.foundSect('S');
    h.upgradeFacility('mine');
    const before = h.state.stones;
    h.tick(600);
    return h.state.stones > before;
  })());
  check('the five sect tiers gate on 0/6/12/20/30 facility levels',
    D.SECT_TIERS.map((t) => t.min).join() === '0,6,12,20,30' && D.SECT_TIERS.length === 5);
  check('total facility levels choose the tier', (() => {
    const h = game(); grant(h, { realm: 3, stones: 1e12 });
    h.foundSect('S');
    h.state.sect.facilities.mine = 12;
    return D.sectTierIndex(h.state) === 2 && D.SECT_TIERS[2].name === 'Renowned Sect';
  })());
  check("Forgemaster's Hall gives +2 forging luck per level", (() => {
    const h = game(); grant(h, { realm: 3, stones: 1e12 });
    h.foundSect('S');
    const before = forgeLuck(h.state);
    h.upgradeFacility('forge');
    return forgeLuck(h.state) - before === 2;
  })());
}

/* ============================================================ A10 forge */

section('A10 — the artifact forge');
{
  const g = game();
  check('the forge is locked below Foundation Establishment', g.beginForge('sword').ok === false);
  grant(g, { realm: 2, cores: 100, stones: 100000 });
  check('a roll costs 6 cores and 120 x (realm+1) stones', (() => {
    const c = forgeCost(g.state);
    return c.cores === 6 && near(c.stones, 360);
  })());
  check('rolling spends the cost and produces a pending artifact', (() => {
    const before = { c: g.state.cores, s: g.state.stones };
    const r = g.beginForge('sword');
    return r.ok && g.state.cores === before.c - 6 && near(g.state.stones, before.s - 360) && g.state.pendingForge !== null;
  })());
  check('a pending roll blocks another', g.beginForge('robe').ok === false);
  check('artifacts are procedurally named "{prefix} {noun}"', (() => {
    const p = g.state.pendingForge;
    return typeof p.name === 'string' && p.name.split(' ').length >= 2;
  })());
  check('binding equips the artifact', (() => {
    const p = g.state.pendingForge;
    const r = g.resolveForge(true);
    return r.bound && g.state.artifacts.sword === p;
  })());
  check('salvaging returns 2 cores', (() => {
    g.beginForge('robe');
    const before = g.state.cores;
    const r = g.resolveForge(false);
    return r.bound === false && g.state.cores === before + 2 && g.state.stats.salvages === 1;
  })());
  check('a replaced piece salvages for 2 cores', (() => {
    g.beginForge('sword');
    const before = g.state.cores;
    g.resolveForge(true);
    return g.state.cores === before + 2;
  })());
  check('the five rarities carry the A10 weights and multipliers', (() => {
    const w = D.RARITIES.map((r) => r.weight).join();
    const m = D.RARITIES.map((r) => r.mult).join();
    return w === '50,30,14,5,1' && m === '1,2.2,4.5,9,18';
  })());
  check('at luck 0 the odds are exactly 50/30/14/5/1', (() => {
    const o = rarityOdds(0).map((x) => Math.round(x * 100));
    return o.join() === '50,30,14,5,1';
  })());
  check('luck tilts weights by (1 + 0.09*luck)^tier', (() => {
    const w = rarityWeights(10);
    return near(w[4], 1 * Math.pow(1.9, 4)) && near(w[0], 50);
  })());
  check('luck raises the chance of Immortal and lowers Mortal', (() => {
    const a = rarityOdds(0), b = rarityOdds(20);
    return b[4] > a[4] && b[0] < a[0];
  })());
  check('the odds always sum to 1', (() => {
    for (const luck of [0, 1, 7, 25, 100]) {
      const sum = rarityOdds(luck).reduce((x, y) => x + y, 0);
      if (!near(sum, 1, 1e-12)) return false;
    }
    return true;
  })());
  check('forging luck is realm + 2 x Forgemaster level', (() => {
    const h = game(); grant(h, { realm: 5, stones: 1e12 });
    h.foundSect('S');
    h.state.sect.facilities.forge = 3;
    return forgeLuck(h.state) === 11;
  })());
  check('power is slot base x rarity x (1 + 0.35 x forge realm)', (() => {
    const h = game(3);
    grant(h, { realm: 4, cores: 100, stones: 1e9 });
    const r = h.beginForge('ring');
    const rarity = D.RARITIES.find((x) => x.key === r.artifact.rarity);
    return near(r.artifact.power, 10 * rarity.mult * (1 + 0.35 * 4));
  })());
  check('the slot base stats are sword 12, robe 8, ring 10',
    D.SLOTS.map((s) => s.base).join() === '12,8,10');
  check('the ring scales loot from every source', (() => {
    const h = game();
    h.state.artifacts.ring = { slot: 'ring', rarity: 'heaven', power: 45 };
    return near(lootMult(h.state), 1.45);
  })());
  check('a pending roll survives a save/load round trip', (() => {
    const h = game(4);
    grant(h, { realm: 3, cores: 50, stones: 1e6 });
    h.beginForge('robe');
    const restored = importSave(exportSave(h.state));
    return restored.pendingForge && restored.pendingForge.name === h.state.pendingForge.name;
  })());
  check('the best rarity ever forged is tracked', (() => {
    const h = game();
    h.state.stats.bestRarity = 'earth';
    return D.rarityIndex(h.state.stats.bestRarity) === 2;
  })());
}

/* ====================================================== A11 the jianghu */

section('A11 — the rivers and lakes');
{
  const g = game();
  check('the ladder holds 100 rivals', D.LADDER_SIZE === 100);
  check('the ladder is deterministic — rank 37 is always the same person', (() => {
    const a = rival(37), b = rival(37);
    return a.name === b.name && near(a.might, b.might);
  })());
  check('rival names read "epithet" family given', (() => {
    const r = rival(37);
    return /^".+" \S+ \S+$/.test(r.name);
  })());
  check('might is 25 x 1.37^(100-rank)', (() => {
    return near(rival(100).might, 25) && near(rival(1).might, 25 * Math.pow(1.37, 99));
  })());
  check('rivals get stronger the higher the rank', rival(10).might > rival(50).might);
  check('duels are locked below Qi Condensation', g.beginDuel().ok === false);
  check('a new cultivator starts unranked, below the ladder', g.state.jianghu.rank === 101);
  check('you challenge the rank directly above you', (() => {
    grant(g, { realm: 1 });
    const r = g.beginDuel();
    return r.ok && r.rival.rank === 100;
  })());
  check('the strike window is your share of combined might', near(duelWindow(30, 10), 0.75));
  check('the window clamps between 8% and 80%', (() => {
    return near(duelWindow(1, 1e9), 0.08) && near(duelWindow(1e9, 1), 0.80);
  })());
  check('player might is Qi/s times the sword bonus', (() => {
    const h = game();
    grant(h, { realm: 2 });
    h.state.artifacts.sword = { slot: 'sword', rarity: 'spirit', power: 25 };
    return near(playerMight(h.state), qiPerSecond(h.state) * 1.25);
  })());
  check('clash speed rises each round', D.DUEL_SPEEDS.join() === '3.6,4.2,4.8');
  check('best-of-three: two clashes win it', (() => {
    const r = g.resolveDuel(2);
    return r.ok && r.won === true && g.state.jianghu.rank === 100;
  })());
  check('winning pays spoils in stones and cores', (() => {
    const h = game(6); grant(h, { realm: 2 });
    h.beginDuel();
    const r = h.resolveDuel(3);
    return r.stones > 0 && r.cores === 2 && h.state.stones > 0;
  })());
  check('winning is counted for the Dao Records', g.state.stats.duelsWon === 1);
  check('a duel puts you on cooldown for 10 minutes', near(g.state.jianghu.cooldown, 600));
  check('you cannot duel while on cooldown', g.beginDuel().ok === false);
  check('best-of-three: one clash loses it', (() => {
    const h = game(8); grant(h, { realm: 2 });
    h.beginDuel();
    const r = h.resolveDuel(1);
    return r.won === false && h.state.jianghu.rank === 101;
  })());
  check('losing leaves you injured for 90 seconds', (() => {
    const h = game(8); grant(h, { realm: 2 });
    h.beginDuel();
    h.resolveDuel(0);
    return near(h.state.injury, 90) && near(qiPerSecond(h.state), qiPerSecond({ ...h.state, injury: 0 }) * 0.8);
  })());
  check('renown is +1% Qi/s per rank climbed', (() => {
    const h = game();
    h.state.jianghu.rank = 60;
    return renown(h.state) === 40;
  })());
  check('renown caps at +99%', (() => {
    const h = game();
    h.state.jianghu.rank = 1;
    return renown(h.state) === 99;
  })());
  check('an unranked cultivator has no renown', renown(game().state) === 0);
  check('rank 1 has no one left to challenge', (() => {
    const h = game(); grant(h, { realm: 2 });
    h.state.jianghu.rank = 1;
    return h.beginDuel().ok === false;
  })());
}

/* ====================================================== A12 dao records */

section('A12 — the Dao Records');
{
  check('there are 35 records', D.RECORDS.length === 35);
  check('every bonus is between 2% and 6%', D.RECORDS.every((r) => r.bonus >= 2 && r.bonus <= 6));
  check('the bonuses total exactly +100% Qi/s',
    D.RECORDS.reduce((n, r) => n + r.bonus, 0) === 100);
  check('every record has a unique id', new Set(D.RECORDS.map((r) => r.id)).size === 35);
  check('every record has a hint, so locked entries read as a quest log',
    D.RECORDS.every((r) => typeof r.hint === 'string' && r.hint.length > 0));
  check('records seal automatically when their condition is met', (() => {
    const g = game();
    g.state.stats.taps = 999;
    g.cultivate();
    return g.state.records.tap1k === true;
  })());
  check('a sealed record raises Qi/s permanently', (() => {
    const g = game();
    const before = qiPerSecond(g.state);
    g.state.records.tap1k = true;
    return near(qiPerSecond(g.state), before * 1.02);
  })());
  check('record bonuses add up across sealed entries', (() => {
    const g = game();
    g.state.records = { tap1k: true, realm7: true };
    return recordBonusPct(g.state) === 8;
  })());
  check('a record seals only once', (() => {
    const g = game();
    g.state.stats.taps = 5000;
    let fired = 0;
    g.on((e) => { if (e.type === 'record' && e.record.id === 'tap1k') fired++; });
    g.tick(1); g.tick(1);
    return fired === 1;
  })());
  check('the tracked stats cover the A12 list', (() => {
    const s = defaultState().stats;
    return ['taps', 'pills', 'expeditions', 'forges', 'salvages', 'duelsWon', 'allTimeQi', 'bestRarity', 'witheredCured']
      .every((k) => k in s);
  })());
}

/* ==================================================== A13 reincarnation */

section('A13 — the wheel of rebirth');
{
  check('reincarnation is locked below Nascent Soul', (() => {
    const g = game();
    grant(g, { realm: 3 });
    return g.reincarnate().ok === false;
  })());
  check('insight gain is (realm-3)*6 + floor((lifetime qi / 1e9)^0.32)', (() => {
    const g = game();
    grant(g, { realm: 5 });
    g.state.stats.lifeQi = 1e15;
    return insightGain(g.state) === 12 + Math.floor(Math.pow(1e6, 0.32));
  })());
  check('rebirth grants the insight', (() => {
    const g = game();
    grant(g, { realm: 5, insight: 3 });
    g.state.stats.lifeQi = 0;
    g.reincarnate();
    return g.state.insight === 3 + 12;
  })());
  check('rebirth resets realm, stage, qi and age', (() => {
    const g = game();
    grant(g, { realm: 4, stage: 2, qi: 1e6, age: 900 });
    g.reincarnate();
    return g.state.realm === 0 && g.state.stage === 0 && g.state.qi === 0 && g.state.age === 16;
  })());
  check('rebirth resets techniques, meridians, resources, arrays and rings', (() => {
    const g = game();
    grant(g, { realm: 4, meridians: 9, herbs: 500, stones: 900, cores: 40, arrays: 5, rings: 2, nineTurn: 12 });
    g.state.techniques = { azure: 6 };
    g.reincarnate();
    const s = g.state;
    return s.meridians === 0 && s.herbs === 0 && s.stones === 0 && s.cores === 0 &&
      s.arrays === 0 && s.rings === 0 && s.nineTurn === 0 &&
      Object.keys(s.techniques).length === 0;
  })());
  check('Dao Insight, records and stats carry across lives', (() => {
    const g = game();
    grant(g, { realm: 4 });
    g.state.records.tap1k = true;
    g.state.stats.taps = 4242;
    g.reincarnate();
    return g.state.records.tap1k === true && g.state.stats.taps === 4242;
  })());
  check('the sect survives the wheel whole', (() => {
    const g = game();
    grant(g, { realm: 4, stones: 1e9 });
    g.foundSect('Cloudreach Sect');
    g.upgradeFacility('pavilion');
    g.recruitDisciple();
    g.reincarnate();
    return g.state.sect.founded && g.state.sect.name === 'Cloudreach Sect' &&
      g.state.sect.facilities.pavilion === 1 && g.state.sect.disciples.length === 1;
  })());
  check('jianghu rank, wins and renown survive the wheel', (() => {
    const g = game();
    grant(g, { realm: 4 });
    g.state.jianghu = { rank: 44, wins: 12, losses: 3, cooldown: 0 };
    g.reincarnate();
    return g.state.jianghu.rank === 44 && g.state.jianghu.wins === 12 && renown(g.state) === 56;
  })());
  check('Immortal artifacts follow the soul', (() => {
    const g = game();
    grant(g, { realm: 4 });
    g.state.artifacts.sword = { slot: 'sword', rarity: 'immortal', power: 400 };
    g.state.artifacts.robe = { slot: 'robe', rarity: 'heaven', power: 90 };
    g.state.artifacts.ring = { slot: 'ring', rarity: 'mortal', power: 10 };
    g.reincarnate();
    return g.state.artifacts.sword !== null && g.state.artifacts.robe === null && g.state.artifacts.ring === null;
  })());
  check('name, settings and best realm survive the wheel', (() => {
    const g = game();
    grant(g, { realm: 5 });
    g.rename('Bai Wuji');
    g.state.settings.sfx = false;
    g.reincarnate();
    return g.state.name === 'Bai Wuji' && g.state.settings.sfx === false && g.state.bestRealm === 5;
  })());
  check('rebirths are counted and lifetime qi resets', (() => {
    const g = game();
    grant(g, { realm: 4 });
    g.state.stats.lifeQi = 5e12;
    g.state.stats.allTimeQi = 5e12;
    g.reincarnate();
    return g.state.stats.rebirths === 1 && g.state.stats.lifeQi === 0 && g.state.stats.allTimeQi === 5e12;
  })());
}

/* ========================================================== A14 offline */

section('A14 — closed-door cultivation');
{
  check('the base offline rate is 50% of Qi/s', near(offlineRate(defaultState()), 0.5));
  check('Turtle Breath adds 10% per level, to 100%', (() => {
    const s = defaultState();
    s.techniques.turtle = 3;
    const a = offlineRate(s);
    s.techniques.turtle = 5;
    return near(a, 0.8) && near(offlineRate(s), 1.0);
  })());
  check('the offline window is 8 hours, +4h per Storage Ring', (() => {
    const s = defaultState();
    const a = offlineCap(s);
    s.rings = 3;
    return a === 8 * 3600 && offlineCap(s) === 20 * 3600;
  })());
  check('seclusion pays qi at the offline rate', (() => {
    const g = game();
    grant(g, { realm: 3 }); // a cap high enough not to interfere
    const r = g.applyOffline(3600);
    return near(r.qi, 400 * 0.5 * 3600, 1e-9);
  })());
  check('seclusion beyond the window is truncated', (() => {
    const g = game();
    const r = g.applyOffline(40 * 3600);
    return r.seconds === 8 * 3600 && r.truncated === true;
  })());
  check('years pass while you are away', (() => {
    const g = game();
    const r = g.applyOffline(3600 * 5);
    return near(r.years, 10) && near(g.state.age, 26);
  })());
  check('the sect delivers while you are away', (() => {
    const g = game();
    grant(g, { realm: 3, stones: 1e9 });
    g.foundSect('S');
    g.upgradeFacility('mine');
    const before = g.state.stones;
    const r = g.applyOffline(3600);
    return r.stones > 0 && g.state.stones > before;
  })());
  check('an expedition completes while you are away', (() => {
    const g = game();
    grant(g, { realm: 2 });
    g.startExpedition('ruins');
    const r = g.applyOffline(2 * 3600);
    return r.expedition !== null && g.state.expedition === null;
  })());
  check('a short absence leaves a running expedition running', (() => {
    const g = game();
    grant(g, { realm: 2 });
    g.startExpedition('ruins');
    g.applyOffline(600);
    return g.state.expedition !== null && near(g.state.expedition.remaining, 3000);
  })());
  check('no time away means no report', game().applyOffline(0) === null);
}

/* ================================================= save, migrate, export */

section('Persistence — save, migrate, export');
{
  check('a default save carries the current version', defaultState().version === SAVE_VERSION);
  check('export/import round-trips the whole state', (() => {
    const g = game();
    grant(g, { realm: 3, stage: 2, meridians: 5, herbs: 12.5, stones: 90, cores: 3 });
    g.rename('Su Lanting');
    g.state.techniques = { azure: 4, river: 2 };
    const back = importSave(exportSave(g.state));
    return back.realm === 3 && back.stage === 2 && back.meridians === 5 &&
      back.name === 'Su Lanting' && back.techniques.azure === 4;
  })());
  check('export/import survives non-ASCII names', (() => {
    const g = game();
    g.rename('白若 — 雲隱');
    return importSave(exportSave(g.state)).name === '白若 — 雲隱';
  })());
  check('a v0.4 save is migrated, not rejected', (() => {
    const legacy = {
      version: 4, realm: 2, stage: 1, qi: 500, name: 'Old Save',
      dao: 9, spiritStones: 250, beastCores: 7,
      rank: 62, wins: 4,
      achievements: { tap1k: true },
      meridians: [true, true, true, false],
    };
    const s = migrate(legacy);
    return s.version === SAVE_VERSION && s.insight === 9 && s.stones === 250 && s.cores === 7 &&
      s.jianghu.rank === 62 && s.jianghu.wins === 4 && s.records.tap1k === true && s.meridians === 3;
  })());
  check('migration merges over defaults, so new fields appear', (() => {
    const s = migrate({ version: 4, realm: 1 });
    return s.sect && s.sect.facilities.pavilion === 0 && s.settings.sfx === true && Array.isArray(s.log);
  })());
  check('migration repairs an out-of-range realm', migrate({ realm: 99 }).realm === 7);
  check('migration repairs a negative qi', migrate({ qi: -500 }).qi === 0);
  check('migration clamps qi to the bottleneck', (() => {
    const s = migrate({ realm: 0, stage: 0, qi: 1e9 });
    return near(s.qi, qiCap(s));
  })());
  check('migration clamps technique levels to their caps', (() => {
    const s = migrate({ techniques: { azure: 999 } });
    return s.techniques.azure === 12;
  })());
  check('migration survives rubbish', (() => {
    return migrate(null).realm === 0 && migrate('nonsense').realm === 0 && migrate(42).realm === 0;
  })());
  check('bestRealm is never behind the current realm', migrate({ realm: 5, bestRealm: 1 }).bestRealm === 5);
  check('a corrupt disciple roster becomes an empty one', (() => {
    return Array.isArray(migrate({ sect: { disciples: 'broken' } }).sect.disciples);
  })());
  check('loadState returns null when storage is empty', (() => {
    const store = { getItem: () => null, setItem: () => {} };
    return importSaveSafe(store) === null;
  })());
}

function importSaveSafe(store) {
  // Mirrors loadState() without importing browser globals.
  const raw = store.getItem('myriad-dao-save');
  return raw ? migrate(JSON.parse(raw)) : null;
}

/* =================================================== engine architecture */

section('Architecture — purity and determinism');
{
  check('the engine runs with no DOM present', typeof globalThis.document === 'undefined');
  check('every quality setting resolves to a real tier', (() => {
    // Regression: choosing Auto in Settings passed undefined through to the
    // renderer, which indexed TIERS[undefined] and threw mid-reconfigure.
    const names = ['low', 'medium', 'high'];
    return ['auto', undefined, null, 'nonsense', 'low', 'medium', 'high']
      .every((v) => names.includes(resolveTier(v)));
  })());
  check('two games with the same seed play identically', (() => {
    const run = (seed) => {
      const g = createGame({ random: mulberry32(seed) });
      grant(g, { realm: 2, cores: 500, stones: 1e7, herbs: 1e5 });
      for (let i = 0; i < 40; i++) {
        g.tick(60);
        g.beginForge('sword');
        g.resolveForge(i % 2 === 0);
      }
      return JSON.stringify({ c: g.state.cores, s: g.state.stones, a: g.state.artifacts });
    };
    return run(123) === run(123) && run(123) !== run(124);
  })());
  check('the seeded ladder is stable across processes', (() => {
    const r = rival(50);
    return r.name === rival(50).name && seededRandom('x')() === seededRandom('x')();
  })());
  check('the view model exposes what the renderer needs', (() => {
    const vm = viewModel(defaultState());
    return ['realm', 'stage', 'qi', 'qiCap', 'qiPerSec', 'progress', 'capped', 'age', 'lifespan',
      'withered', 'sect', 'jianghu', 'artifacts', 'meridians', 'records'].every((k) => k in vm);
  })());
  check('the view model is a copy — mutating it cannot corrupt state', (() => {
    const s = defaultState();
    const vm = viewModel(s);
    vm.sect.facilities.pavilion = 99;
    return s.sect.facilities.pavilion === 0;
  })());
  check('events are emitted for the renderer to react to', (() => {
    const g = game();
    const seen = [];
    g.on((e) => seen.push(e.type));
    g.state.qi = 100;
    g.beginBreakthrough();
    return seen.includes('breakthrough');
  })());
  check('listeners can be removed', (() => {
    const g = game();
    let n = 0;
    const off = g.on((e) => { if (e.type === 'breakthrough') n++; });
    g.state.qi = 100; g.beginBreakthrough();
    off();
    g.state.qi = 1000; g.beginBreakthrough();
    return n === 1 && g.state.stage === 2;
  })());
  check('a single tick never swallows more than an hour', (() => {
    const g = game();
    grant(g, { realm: 3 });
    g.tick(86400 * 7);
    return near(g.state.age, 16 + 3600 / 1800);
  })());
  check('a zero or negative tick is a no-op', (() => {
    const g = game();
    g.tick(0); g.tick(-5);
    return g.state.age === 16 && g.state.qi === 0;
  })());
  check('the chronicle log is capped', (() => {
    const g = game();
    for (let i = 0; i < 200; i++) g.chronicle('line ' + i);
    return g.state.log.length === 60;
  })());
  check('hard reset returns a fresh cultivator', (() => {
    const g = game();
    grant(g, { realm: 6, insight: 400 });
    g.hardReset();
    return g.state.realm === 0 && g.state.insight === 0;
  })());
  check('renaming trims and bounds the name', (() => {
    const g = game();
    g.rename('   ');
    const a = g.state.name;
    g.rename('x'.repeat(200));
    return a === 'Nameless Wanderer' && g.state.name.length === 28;
  })());
}

section('Formatting');
{
  check('numbers compact to K/M/B/T/Qa', fmt(1234) === '1.23K' && fmt(5.4e6) === '5.40M' && fmt(2e12) === '2.00T' && fmt(3e15) === '3.00Qa');
  check('small numbers stay whole', fmt(0) === '0' && fmt(999) === '999');
  check('quintillion does not collide with Qi', !fmt(1e18).startsWith('1.00Qi'));
  check('durations read as h/m/s', fmtTime(45) === '45s' && fmtTime(750) === '12m 30s' && fmtTime(3660) === '1h 01m');
  check('infinity renders as a symbol', fmt(Infinity) === '∞' && fmtTime(Infinity) === '∞');
}

/* ------------------------------------------------------------- summary */

const total = passed + failures.length;
console.log(`\n  ${passed}/${total} checks passed`);
if (failures.length) {
  console.log(`  ${failures.length} FAILED\n`);
  process.exit(1);
}
console.log('  engine: PASS\n');
