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
import { resolveTier, createWatchdog, TIERS } from '../js/view3d/quality.js';
import { sceneryProgress } from '../js/view3d/progress.js';
import {
  PALETTES, luminance, LUMA, mixHex, desaturateHex, AURORA_COLOR, foregroundInk,
} from '../js/view3d/palette.js';
import {
  // `SEAT` is already taken in this file by cloud-plan's — the sea's seat, not
  // the cultivator's.
  PLATFORM, STONE, SEAT as ISLAND_SEAT, STONE_PROUD, platformOutline, stoneOutline, topRelief,
  surfaceAt, symmetryScore, STEPS, stepTop, CENSER, SMOKE,
} from '../js/view3d/platform-plan.js';
import { PLUM, plumSeat, plumSkeleton, framingBranch, turnBetween } from '../js/view3d/plum-plan.js';
// The vendored library, by path: the suite has no bundler and no node_modules,
// and one fact in stage 5 — where ExtrudeGeometry puts its bevel — is three's
// rather than ours, so it is driven against the real thing.
import * as THREE from '../vendor/three.module.min.js';
import {
  TIMES, timeOfDayAt, nearestTime, wrapDay, lerpDay, sunDirection, aerialTiers, AERIAL,
} from '../js/view3d/time-of-day.js';
import { CAMERA } from '../js/view3d/camera-config.js';
import {
  TILE, cloudAlpha, cloudTile, LAYERS, PLANE, SCROLL, SEAT, SWELL, VIEW_UV,
  ACROSS_UV, seatHeights, swellAt,
} from '../js/view3d/cloud-plan.js';
import {
  FRAMINGS, REFERENCE_ASPECT, cameraBasis, frameOf, placeAtDepth, unitsPerFrame,
  horizonV, composition, contactSheetPlan, sunOffsetDeg, clearOfCameras,
} from '../js/view3d/framing.js';
import {
  FIGURE, PLEATS, COLLAR, SASH, ARMS, POSE, SLEEVE_TRIM, HEAD, FACE, JIAN, SURFACES,
  bodyRadius, skirtRings, robeRings, pleatSegments, hemOutline, collarPanels,
  sashTails, cuffs, cuffDrop, figureParts, asymmetryScore, shoulderDropDeg,
  jianAt, jianLength, tasselStrands,
} from '../js/view3d/figure-plan.js';
import { specularFrom } from '../js/view3d/surface.js';
import { makeNoise3, ridged3 } from '../js/view3d/noise.js';
import {
  PEAK_MESHES, SCALE_RANGE, peakPlacements, cloudBands,
} from '../js/view3d/peak-plan.js';
import {
  TERRAIN, TARN, SHORE, terrainField, terrainHeight, crestAt,
} from '../js/view3d/terrain-plan.js';
import { debugEnabled } from '../js/view3d/dev-flag.js';
import { mulberry32, seededRandom } from '../js/rng.js';
import { fmt, fmtTime } from '../js/format.js';
import { readFileSync } from 'node:fs';

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
  check('resolving a duel that is not running is refused, not thrown', (() => {
    // The UI used to read out.rival.name unconditionally. A forced death
    // mid-duel wipes state.duel, so this path is reachable in play.
    const h = game();
    grant(h, { realm: 2 });
    const r = h.resolveDuel(2);
    return r.ok === false && typeof r.reason === 'string';
  })());
  check('a forced rebirth mid-duel clears the in-flight duel', (() => {
    const h = game();
    grant(h, { realm: 4, age: 1599 });
    h.beginDuel();
    h.tick(1800 * 3);           // cross the lifespan; the shell fails
    return h.state.duel === null && h.state.stats.rebirths === 1;
  })());
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

  check('nothing this suite imports imports Three', (() => {
    // CI installs no dependencies — "the engine and its tools are plain ESM" —
    // so `import * as THREE` anywhere in this file's import closure does not
    // fail a check, it stops the suite from *starting* and takes the whole run
    // with it. That is exactly what happened when stage 7 reached into
    // shaders.js for one pure function; the arithmetic moved to surface.js and
    // this check is here so the next one is caught in the editor instead of in
    // a pull request.
    //
    // Everything a renderer module knows that the suite needs to assert lives
    // in a Three-free module — palette, framing, noise, the *-plan files,
    // surface — or is read as *text* with readFileSync, which is how the
    // shader sources are checked.
    const root = new URL('.', import.meta.url);
    const seen = new Set();
    const bad = [];
    const walk = (url) => {
      if (seen.has(url.href)) return;
      seen.add(url.href);
      let src;
      try { src = readFileSync(url, 'utf8'); } catch { return; }
      for (const m of src.matchAll(/(?:^|\n)\s*import[^;]*?from\s+'([^']+)'/g)) {
        const spec = m[1];
        if (spec.startsWith('.')) walk(new URL(spec, url));
        // Node's own builtins are always there; a bare specifier is a package,
        // and there is no package manager anywhere in this project's CI.
        else if (!spec.startsWith('node:')) bad.push(`${url.href.slice(root.href.length)} imports ${spec}`);
      }
    };
    walk(new URL('run.js', root));
    if (bad.length) console.log(`      ${bad.join('\n      ')}`);
    return bad.length === 0;
  })());
  check('the watchdog drops a tier when frames are slow', (() => {
    let tier = 'high';
    const w = createWatchdog((t) => { tier = t; });
    for (let i = 0; i < 180 + 120 * 6; i++) w(1 / 15, tier);
    return tier === 'low';
  })());
  check('the watchdog climbs back when there is headroom', (() => {
    let tier = 'low';
    const w = createWatchdog((t) => { tier = t; });
    for (let i = 0; i < 180 + 120 * 12; i++) w(1 / 120, tier);
    return tier === 'high';
  })());
  check('the watchdog leaves a comfortable high tier alone', (() => {
    let changes = 0;
    const w = createWatchdog(() => { changes++; });
    for (let i = 0; i < 180 + 120 * 8; i++) w(1 / 120, 'high');
    return changes === 0;
  })());
  check('the watchdog recovers at most once after dropping', (() => {
    // Slow, then fast for a long stretch. A transient stall — a shader compile,
    // a backgrounded tab, a thermal blip — must not sentence the device to the
    // upscaled tier for the rest of the session, so one climb back is allowed.
    // Exactly one: a device that genuinely cannot hold the frame has to settle
    // rather than oscillate, and the budget is spent for good after that.
    let tier = 'high';
    let changes = 0;
    const w = createWatchdog((t) => { tier = t; changes++; });
    for (let i = 0; i < 180 + 120 * 3; i++) w(1 / 15, tier);
    const afterDrop = tier;
    for (let i = 0; i < 120 * 24; i++) w(1 / 120, tier);
    return afterDrop === 'medium' && changes <= 2;
  })());
  check('no tier renders below the resolution of the screen', Object.entries(TIERS).every(
    // renderScale multiplies the backing store, so the product with pixelRatio
    // is what the frame is actually drawn at relative to CSS pixels. Under 1
    // means the browser is upscaling a smaller image, which is irreversible
    // blur rather than a subtle quality trade — `low` shipped at 0.75.
    ([, t]) => t.pixelRatio * t.renderScale >= 1,
  ));

  check('every tier multisamples the target the scene goes into', Object.entries(TIERS).every(
    // `antialias` is a flag on the canvas' default framebuffer, and the scene
    // is drawn into a WebGLRenderTarget instead — so it applies to a buffer
    // that is never drawn to. `msaa` is the one that counts, and since every
    // tier now composites, every tier needs it or it gets no antialiasing at
    // all however loudly it asks for it.
    ([, t]) => t.msaa > 0,
  ));

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

section('Scenery — the landscape as a readout');
{
  const T = TIERS.high;
  const vm = (patch = {}) => viewModel(Object.assign(defaultState(), patch));
  const withSect = (facilities, patch = {}) => {
    const st = Object.assign(defaultState(), patch);
    st.sect = { founded: true, name: 'S', disciples: [], facilities: Object.assign(
      { hall: 0, garden: 0, mine: 0, training: 0, pavilion: 0, forge: 0 }, facilities) };
    return viewModel(st);
  };

  check('the range fills out as the realm rises', (() => {
    const a = sceneryProgress(vm({ realm: 0 }), T).peakFraction;
    const b = sceneryProgress(vm({ realm: 7 }), T).peakFraction;
    // The floor has to read as a mountain range on the very first screen — at
    // 0.30 it was about seven pillars spread over three ranks, which reads as a
    // few rocks. The climb to a full range is what carries the progression.
    return a >= 0.5 && a < b && near(b, 1.0);
  })());
  check('the sea of cloud sinks as you climb', (() => {
    const a = sceneryProgress(vm({ realm: 0 }), T).cloudDrop;
    const b = sceneryProgress(vm({ realm: 7 }), T).cloudDrop;
    return a === 0 && b > a;
  })());
  check('the plum blooms across the four stages and sheds at Peak', (() => {
    const b = [0, 1, 2, 3].map((stage) => sceneryProgress(vm({ stage }), T).blossom);
    // bare -> budding -> full -> shedding
    return b[0] < b[1] && b[1] < b[2] && b[3] < b[2] && b[3] > b[1];
  })());
  check('petals fall hardest at Peak, when a breakthrough is due', (() => {
    const r = [0, 1, 2, 3].map((stage) => sceneryProgress(vm({ stage }), T).petalRate);
    return r[0] < r[1] && r[1] < r[2] && r[2] < r[3] && near(r[3], 1);
  })());
  check('cranes gather as jianghu renown climbs', (() => {
    const low = defaultState(); low.realm = 2; low.jianghu.rank = 101;
    const high = defaultState(); high.realm = 2; high.jianghu.rank = 1;
    return sceneryProgress(viewModel(high), T).cranes > sceneryProgress(viewModel(low), T).cranes;
  })());
  check('bamboo follows the sect herb garden', (() => {
    const none = sceneryProgress(vm({ realm: 3 }), T).bamboo;
    const some = sceneryProgress(withSect({ garden: 4 }, { realm: 3 }), T).bamboo;
    return none === 0 && some > 0;
  })());
  check('spirit motes follow the opened meridians', (() => {
    const a = sceneryProgress(vm({ realm: 3, meridians: 0 }), T).fireflies;
    const b = sceneryProgress(vm({ realm: 3, meridians: 12 }), T).fireflies;
    return a === 0 && b === T.fireflies;
  })());
  check('the waterfall waits for a realm or a mine', (() => {
    const early = sceneryProgress(vm({ realm: 0 }), T).waterfall;
    const mined = sceneryProgress(withSect({ mine: 1 }, { realm: 0 }), T).waterfall;
    const later = sceneryProgress(vm({ realm: 2 }), T).waterfall;
    return early === false && mined === true && later === true;
  })());
  check('every scenery count stays inside its quality budget', (() => {
    const st = defaultState();
    Object.assign(st, { realm: 7, stage: 2, meridians: 12 });
    st.jianghu.rank = 1;
    st.sect = { founded: true, name: 'S', disciples: [],
      facilities: { hall: 9, garden: 9, mine: 9, training: 9, pavilion: 9, forge: 9 } };
    return ['low', 'medium', 'high'].every((name) => {
      const t = TIERS[name];
      const p = sceneryProgress(viewModel(st), t);
      return p.cranes <= t.cranes && p.bamboo <= t.bamboo && p.fireflies <= t.fireflies
        && p.peakFraction <= 1 + 1e-9;
    });
  })());
}

section('Palette — the ink-wash value ladder');
{
  // The art direction rests on one relationship, and it is a numeric one, so it
  // is asserted rather than eyeballed. When it was only eyeballed the peaks
  // ended up borrowing the ridge ramp — which is authored against mist and runs
  // pale — and the furthest rank came out *lighter* than the sky behind it.
  // Nothing threw; the range simply stopped being a range.
  //
  // Since stage 2 the ladder is checked at *every* time of day, not just at the
  // one each realm happens to stand at. That is the whole point of the day
  // being data: the scrubber can put any realm under any sky, and a rank that
  // only reads at dusk is a rank that is wrong.
  const names = PALETTES.map((_, i) => `realm ${i}`);
  const DAY = Array.from({ length: 25 }, (_, i) => i / 24);

  /**
   * Every realm under every hour — the space the *scrubber* can reach. The
   * ladder must at least point the right way everywhere in it, because QA looks
   * at all of it.
   */
  const everywhere = (fn) => PALETTES.every((p) => DAY.every((t) => fn(p, timeOfDayAt(t))));

  /**
   * The space the game actually ships: each realm at its own hour, and every
   * point along the transition to the next one — where the ink and the day ease
   * together, exactly as index.js eases them. The full margins are held here.
   */
  const shipped = (fn) => PALETTES.every((p, i) => {
    const q = PALETTES[Math.min(i + 1, PALETTES.length - 1)];
    for (let s = 0; s <= 16; s++) {
      const k = s / 16;
      const blended = {
        ink: mixHex(p.ink, q.ink, k),
        cloud: mixHex(p.cloud, q.cloud, k),
        cloudCrest: mixHex(p.cloudCrest, q.cloudCrest, k),
      };
      if (!fn(blended, timeOfDayAt(lerpDay(p.tod, q.tod, k)), i)) return false;
    }
    return true;
  });

  check('every realm carries the full ink script', PALETTES.every((p) => (
    typeof p.ink === 'string' && /^#[0-9a-f]{6}$/.test(p.ink)
    && typeof p.tod === 'number' && p.tod >= 0 && p.tod <= 1
    && typeof p.bearing === 'number'
    && Array.isArray(p.ridges) && p.ridges.length === 5
    && typeof p.cloud === 'string' && typeof p.cloudCrest === 'string'
    && typeof p.water === 'string'
    // No realm may carry a sky, a fog or a light colour any more. Two owners
    // of the air is the fault this stage exists to remove, and the only way to
    // keep it removed is to fail the suite when one grows back.
    && p.sky === undefined && p.fog === undefined && p.light === undefined
    && p.sun === undefined && p.accent === undefined
  )));

  check('the eight realms walk one day, in order', (() => {
    // First light to daybreak, monotonically. The wheel comes round at
    // Ascension — tod 1 and tod 0 are the same sky — so the last realm may
    // land back on the first one's hour but nothing may go backwards.
    const tods = PALETTES.map((p) => p.tod);
    return tods[0] === 0 && tods[tods.length - 1] === 1
      && tods.every((t, i) => i === 0 || t > tods[i - 1]);
  })(), PALETTES.map((p) => p.tod).join(', '));

  check('the peaks are ink: darker than the sky they stand against, at the realm\'s own hour',
    shipped((p, tod) => {
      // The palest rank against the brightest thing it can be seen over. A
      // margin, not a tie: a few levels apart is a smudge, not a silhouette.
      const palest = Math.max(...aerialTiers(p.ink, tod.horizon).map(luminance));
      return palest < luminance(tod.horizon) - 20 && palest < 130;
    }), names.filter((_, i) => !shipped((p, tod, at) => (
      at !== i || Math.max(...aerialTiers(p.ink, tod.horizon).map(luminance))
        < luminance(tod.horizon) - 20
    ))).join(', '));

  check('and at every other hour the scrubber can put them under', everywhere((p, tod) => {
    // Weaker on purpose, and still a real bar. A night sky is 54 levels top to
    // bottom where a noon one is 220, so an absolute margin would either be
    // meaningless at noon or unmeetable at midnight; this one is relative, and
    // it is what keeps a range a range under any light QA points at it.
    const air = luminance(tod.horizon);
    const palest = Math.max(...aerialTiers(p.ink, tod.horizon).map(luminance));
    return palest < air - Math.max(10, air * 0.12);
  }));

  check('the ranks recede: near is darkest, far is palest', everywhere((p, tod) => {
    const [a, b, c] = aerialTiers(p.ink, tod.horizon).map(luminance);
    return a < b && b < c;
  }));

  check('and they desaturate as they go, which is the other half of distance',
    everywhere((p, tod) => {
      // Lighter alone gives a range of pale versions of the same hue, which
      // reads as closer mountains painted badly.
      //
      // Measured against the plain mix rather than in absolute chroma, because
      // the air itself has a colour: mixing a neutral ink toward a sunset
      // horizon *adds* saturation however hard you desaturate afterwards. What
      // has to fall with distance is how much of its own colour the rank keeps.
      const sat = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        return Math.max(...ch) - Math.min(...ch);
      };
      // Against a *neutral* air, which isolates the mechanism from the air's
      // own hue: whatever colour a rank of rock has, less of it survives the
      // further away it is.
      const grey = mixHex('#000000', '#ffffff', luminance(tod.horizon) / 255);
      const tiers = aerialTiers(p.ink, grey).map(sat);
      return tiers.every((v, i) => i === 0 || v <= tiers[i - 1] + 1);
    }));

  check('cloud is the brightest thing in the frame', shipped((p, tod) => (
    luminance(p.cloud) > Math.max(...aerialTiers(p.ink, tod.horizon).map(luminance)) + 55
    && luminance(p.cloudCrest) > luminance(p.cloud)
    && luminance(p.cloud) > luminance(tod.zenith)
  )));

  check('cloud never glares out of a night sky', PALETTES.every((p) => (
    // Bright relative to *its own* sky — the hour the realm actually stands at
    // — not absolutely: at 175 against a sky of 58 the night realms read as
    // snowdrifts under a midday sun.
    luminance(p.cloud) / luminance(timeOfDayAt(p.tod).horizon) < 3.2
  )), PALETTES.map((p, i) => (
    `${i}: ${(luminance(p.cloud) / luminance(timeOfDayAt(p.tod).horizon)).toFixed(2)}×`
  )).join(', '));

  check('no sun stands behind the camera', (() => (
    // The stage-1 gate: the sun has to be readable from a single glance at any
    // preset. A key within a few degrees of the lens is the flattest light
    // there is — nothing the camera sees is turned away from it, and every
    // shadow falls behind the thing that cast it, where it cannot be seen.
    // Sixty degrees is the floor; most of these are near ninety. Bearing is
    // the realm's half of the sun, and it is measured with the elevation the
    // day supplies — sunOffsetDeg ignores elevation, so any hour will do.
    PALETTES.every((p) => sunOffsetDeg(sunDirection(p.bearing, 30)) >= 60)
  ))(), PALETTES.map((p, i) => (
    `${i}: ${sunOffsetDeg(sunDirection(p.bearing, 30)).toFixed(0)}°`
  )).join(', '));

  check('the sun sweeps the sky rather than sitting in one corner', (() => {
    // Eight realms all keyed from the same bearing would be one lighting setup
    // wearing eight colour schemes. At least one has to come from behind.
    const offs = PALETTES.map((p) => sunOffsetDeg(sunDirection(p.bearing, 30)));
    return Math.max(...offs) > 140 && Math.max(...offs) - Math.min(...offs) > 50;
  })());

  check('the aurora is not the accent', (() => {
    // A background element wearing the accent makes the player's own qi
    // ordinary, and the curtains are the largest background element there is.
    const src = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
    const sky = src.slice(src.indexOf('export function makeSkyMaterial'));
    return typeof AURORA_COLOR === 'string'
      && /uAuroraColor \* curtain/.test(sky) && !/uAccent/.test(sky);
  })());
}

section('Light and tone — the three-light rig');
{
  const lighting = readFileSync(new URL('../js/view3d/lighting.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
  const post = readFileSync(new URL('../js/view3d/post.js', import.meta.url), 'utf8');

  check('there are exactly three lights, and no ambient anywhere', (() => {
    // Ambient light is the one light that cannot describe form: it lifts the
    // shadow side by exactly what it lifts the lit side. Removing it is the
    // single largest thing this stage did, so it is the thing most worth
    // guarding — including against a well-meaning `AmbientLight` added later
    // to "fix" a dark corner.
    const built = lighting.match(/new THREE\.[A-Za-z]*Light\(/g) || [];
    const anywhere = [lighting, shaders, index].some((s) => /new THREE\.AmbientLight/.test(s));
    return built.length === 3 && !anywhere
      && /new THREE\.DirectionalLight\(/.test(lighting)
      && /new THREE\.HemisphereLight\(/.test(lighting);
  })());

  check('only the sun casts, and its shadow camera is fitted to the island', (() => {
    // The range is four hundred units deep. A shadow map stretched over it has
    // no texels left for the thing the shadow is for, which is the figure on
    // her shelf — so the frustum is fitted to the foreground and the peaks are
    // left alone, exactly as the brief says.
    const casts = lighting.match(/castShadow = true/g) || [];
    const num = (name) => Number((lighting.match(new RegExp(`${name}: ([0-9.]+)`)) || [])[1]);
    return casts.length === 1 && /castShadow = false/.test(lighting)
      && num('extent') <= 40 && num('mapSize') === 1024
      && /shadow\.mapSize\.set\(ISLAND\.mapSize, ISLAND\.mapSize\)/.test(lighting);
  })());

  check('the renderer is ACES, sRGB and soft shadows', (() => (
    /outputColorSpace = THREE\.SRGBColorSpace/.test(index)
    && /toneMapping = THREE\.ACESFilmicToneMapping/.test(index)
    && /toneMappingExposure = 1\.0/.test(index)
    && /shadowMap\.enabled = true/.test(index)
    && /shadowMap\.type = THREE\.PCFSoftShadowMap/.test(index)
    && /ColorManagement\.enabled = true/.test(index)
  ))());

  check('the pixel ratio is capped at two whatever the tier asks', (() => (
    // A phone reporting 3 or 4 buys nothing anybody can see and costs real
    // frames. The tier cap still applies underneath it.
    /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(index)
  ))());

  check('the tone curve is applied once, to linear light, in the last pass', (() => {
    // Scene-referred in, display-referred out — and in that order. ACES
    // applied to values that are already gamma-encoded has no shoulder left to
    // roll off, which is the whole reason for the curve.
    const grade = shaders.slice(shaders.indexOf('export function makePostMaterial'));
    return /acesFilmic\(col \* uExposure\)/.test(grade)
      && /linearToSRGB\(acesFilmic/.test(grade)
      && grade.indexOf('linearToSRGB(acesFilmic') < grade.indexOf('smoothstep(1.05, 0.44, v)')
      && (shaders.match(/vec3 acesFilmic/g) || []).length === 1;
  })());

  check('exposure has one dial, and Stage 2 turns it on the renderer', (() => (
    /uExposure\.value = renderer\.toneMappingExposure/.test(post)
  ))());

  check('the post stack is RenderPass, bloom, grade — and nothing else', (() => {
    // No DOF and no SSAO: both cost more than everything else here put
    // together, on a landscape read at arm's length on a handset.
    const passes = post.match(/composer\.addPass\(([a-zA-Z]+)\)/g) || [];
    return passes.length === 3
      && /new RenderPass\(/.test(post) && /new UnrealBloomPass\(/.test(post)
      && /new ShaderPass\(postMat\)/.test(post)
      && !/(BokehPass|SSAOPass|GTAOPass|SAOPass)\.js/.test(post);
  })());

  check('the bloom is the brief\'s bloom, at half resolution', (() => (
    // UnrealBloomPass starts its mip chain at half the size it is handed and
    // never touches the full-resolution buffer, which is what makes five
    // blurred mips affordable on a phone.
    /threshold: 0\.85, strength: 0\.4, radius: 0\.6/.test(post)
    && /BLOOM\.strength, BLOOM\.radius, BLOOM\.threshold/.test(post)
  ))());

  check('the vignette and the grain are inside the brief', (() => {
    const grade = shaders.slice(shaders.indexOf('export function makePostMaterial'));
    const num = (name) => Number((grade.match(new RegExp(`${name}: \\{ value: ([0-9.]+)`)) || [])[1]);
    return Math.abs(num('uVignette') - 0.35) < 0.02 && num('uGrain') <= 0.02;
  })());

  check('nothing in the shading reads a flat ambient term any more', (() => (
    // The hemisphere replaced it: same cost, but a function of the normal, so
    // a face turned up to the sky and one turned down to the valley differ
    // before the sun has said anything.
    !/uAmbient/.test(shaders) && /vec3 hemisphere\(vec3 n\)/.test(shaders)
  ))());

  check('the key light has somewhere to fall to', (() => {
    // A full half-lambert wrap hands a surface pointing away from the sun half
    // of the key, which leaves the shading no range to spend. The wrap is a
    // quarter now — soft, but with a real zero at the bottom.
    const m = shaders.match(/dot\(n, normalize\(uLightDir\)\) \+ ([0-9.]+)\) \/ ([0-9.]+)/);
    return !!m && Number(m[1]) <= 0.35 && Math.abs(Number(m[2]) - (1 + Number(m[1]))) < 1e-9;
  })());

  check('the rim is an edge, not a wash over the foreground', (() => (
    // A fresnel term on a shelf twenty-five units across, seen from eight
    // degrees above it, is not an edge — at a low exponent it was two thirds
    // of the light on the whole foreground, and no sun or shadow could touch
    // any of it.
    /pow\(1\.0 - max\(dot\(n, v\), 0\.0\), 4\.0\) \* \(1\.0 - 0\.7 \* ramp\)/.test(shaders)
  ))());

  check('the ink materials can actually receive the shadow', (() => (
    // Three's own chunks, so shadowMap.type, bias, normalBias, radius and
    // intensity on the light are all live rather than decorative.
    /lights: true/.test(shaders) && /shadowmap_pars_fragment/.test(shaders)
    && /shadowmap_vertex/.test(shaders) && /getShadow\(directionalShadowMap/.test(shaders)
    && /uniform bool receiveShadow/.test(shaders)
  ))());

  check('sharing the env uniforms survives the lights merge', (() => (
    // UniformsUtils.merge deep-clones, which would hand every material its own
    // private uTime and uLightDir — and the whole file is built on those being
    // shared by reference so one realm transition re-lights the world.
    /Object\.assign\(\s*THREE\.UniformsUtils\.clone\(THREE\.UniformsLib\.lights\)/.test(shaders)
    && !/UniformsUtils\.merge\(/.test(shaders)
  ))());

  check('the figure casts and the platform receives', (() => {
    const avatar = readFileSync(new URL('../js/view3d/avatar.js', import.meta.url), 'utf8');
    const world = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');
    // She casts; she does not receive. At thirty units over a 1024 map she is
    // about sixty texels tall — enough to lay a clean shadow on the shelf,
    // nowhere near enough to resolve her own folds without acne.
    return /mesh\.castShadow = true/.test(avatar) && !/receiveShadow/.test(avatar)
      && /shelf\.receiveShadow = true/.test(world) && /stone\.castShadow = true/.test(world);
  })());

  check('the QA harness never looks at a stale build', (() => {
    // The service worker is cache-first over the whole shell, so on a machine
    // that has played once it serves yesterday's modules to today's page — and
    // the contact sheet is then a picture of a build that no longer exists.
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    return /if \(DEBUG\) \{[\s\S]*?getRegistrations[\s\S]*?unregister/.test(main)
      && /serviceWorker\.register\('\.\/sw\.js'\)/.test(main);
  })());
}

section('Framing — composing against the authored camera');
{
  // The scenery is placed by naming a spot in the frame, so this arithmetic is
  // load-bearing: if it drifts, whole mountain ranges move off-screen and
  // nothing throws. These numbers were checked against a live browser render.
  const roundTrip = (u, v, z) => {
    const f = frameOf(placeAtDepth(u, v, z));
    return Math.max(Math.abs(f.u - u), Math.abs(f.v - v));
  };
  check('placeAtDepth inverts frameOf exactly', (() => {
    let worst = 0;
    for (const z of [-40, -90, -160, -300, -520]) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        for (const v of [0.1, 0.35, 0.6, 0.9]) worst = Math.max(worst, roundTrip(u, v, z));
      }
    }
    return worst < 1e-9;
  })());

  check('the world framing looks down a diagonal, not along -z', (() => {
    // The whole reason frame-space placement exists: the visible slice of world
    // x at a given depth is nowhere near centred on zero.
    const left = placeAtDepth(0, 0.5, -140)[0];
    const right = placeAtDepth(1, 0.5, -140)[0];
    return left < -140 && right < -55 && right > left;
  })());

  check('the visible arc widens with depth', (() => {
    const span = (z) => placeAtDepth(1, 0.5, z)[0] - placeAtDepth(0, 0.5, z)[0];
    return span(-480) > span(-220) && span(-220) > span(-90);
  })());

  check('a ground point at infinity converges on the horizon line', (() => {
    // frameOf on a very distant point and horizonV on the framing are two
    // different derivations of the same line; they have to agree.
    const v = frameOf([0, 0, -9000]).v;
    return Math.abs(v - horizonV(FRAMINGS.world)) < 1e-3;
  })());

  check('a point behind the camera reports as behind', (() => {
    const b = frameOf([0, 0, 200]);
    return b.behind === true && Number.isNaN(b.u);
  })());

  check('things at the same depth shrink no further', (() => {
    // unitsPerFrame is how the scenery converts a frame fraction into a size.
    const a = unitsPerFrame(-100);
    const b = unitsPerFrame(-400);
    return b > a && a > 0;
  })());

  check('the camera basis is orthonormal and right-handed', (() => {
    const { x, y, z } = cameraBasis(FRAMINGS.world);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const len = (p) => Math.hypot(...p);
    return near(len(x), 1) && near(len(y), 1) && near(len(z), 1)
      && Math.abs(dot(x, y)) < 1e-9 && Math.abs(dot(y, z)) < 1e-9 && Math.abs(dot(x, z)) < 1e-9;
  })());

  check('every named framing can be inverted', (() => (
    Object.values(FRAMINGS).every((f) => {
      const p = placeAtDepth(0.5, 0.5, f.target[2] - 40, { framing: f });
      return p !== null && p.every(Number.isFinite);
    })
  ))());

  check('a wider screen sees more world at the same depth', (() => {
    const narrow = placeAtDepth(1, 0.5, -200, { aspect: REFERENCE_ASPECT })[0]
      - placeAtDepth(0, 0.5, -200, { aspect: REFERENCE_ASPECT })[0];
    const wide = placeAtDepth(1, 0.5, -200, { aspect: 1.6 })[0]
      - placeAtDepth(0, 0.5, -200, { aspect: 1.6 })[0];
    return Math.abs(wide) > Math.abs(narrow);
  })());

  check('summits clear the status bar and feet clear the UI', (() => {
    // The composition contract the peaks are placed against, read off the
    // locked safe zones rather than off two numbers typed into a test.
    const summit = frameOf(placeAtDepth(0.5, CAMERA.safeZone.top + 0.006, -190));
    const foot = frameOf(placeAtDepth(0.5, 1 - CAMERA.safeZone.bottom - 0.01, -190));
    return summit.v > CAMERA.safeZone.top && foot.v < 1 - CAMERA.safeZone.bottom;
  })());
}

/* ============================================ Stage 0 — the locked camera */

section('Camera lock — the composition contract');
{
  const HERO = FRAMINGS.world;
  const want = CAMERA.composition;
  const tol = want.tolerance;
  const hero = composition(HERO);

  check('the lens is a 45° perspective on a portrait frame',
    CAMERA.fov === 45 && HERO.fov === CAMERA.fov
    && CAMERA.referenceAspect < 1 && near(CAMERA.referenceAspect, 414 / 896),
    `fov ${CAMERA.fov}/${HERO.fov}, aspect ${CAMERA.referenceAspect.toFixed(4)}`);

  check('near and far planes come from the config too',
    CAMERA.near > 0 && CAMERA.far > CAMERA.near);

  check('the horizon sits at 45% of frame height',
    Math.abs(hero.horizonV - want.horizonV) <= tol.horizonV,
    `horizon at ${(hero.horizonV * 100).toFixed(2)}%`);

  check('the horizon is explicitly not centred',
    Math.abs(hero.horizonV - 0.5) > 0.02 && hero.horizonV < 0.5,
    `${(hero.horizonV * 100).toFixed(2)}% down the frame`);

  check('the horizon does not move with screen width', (() => {
    // It is a property of the lens and the tilt, so a tablet and a phone see
    // it in the same place. Aspect is not even an input.
    const a = horizonV(HERO);
    return [0.35, REFERENCE_ASPECT, 1, 1.9].every((aspect) => (
      Math.abs(composition(HERO, { aspect }).horizonV - a) < 1e-12
    ));
  })());

  check('the horizon is one straight line, whichever way you face', (() => {
    // Any horizontal direction at infinity has to land on it, or the camera
    // has picked up a roll and the whole frame is tilted.
    const far = [[0, 0, -9000], [9000, 0, 0], [-6000, 0, -6000], [3000, 0, 8000]];
    const vs = far.map((p) => frameOf(p)).filter((f) => !f.behind).map((f) => f.v);
    return vs.length >= 2 && Math.max(...vs) - Math.min(...vs) < 2e-3;
  })());

  check('the character anchor lands 60–62% down the frame',
    hero.anchorV >= 0.60 && hero.anchorV <= 0.62,
    `anchor at ${(hero.anchorV * 100).toFixed(2)}%`);

  check('the character occupies 12–15% of frame height',
    hero.characterHeightV >= 0.12 && hero.characterHeightV <= 0.15,
    `figure is ${(hero.characterHeightV * 100).toFixed(2)}% tall`);

  check('the anchor is off centre horizontally',
    Math.abs(hero.anchorU - want.anchorU) <= tol.anchorU && Math.abs(hero.anchorU - 0.5) > 0.02,
    `u = ${hero.anchorU.toFixed(3)}`);

  check('she stands below the horizon and her head does not cross it',
    hero.anchorV > hero.horizonV && hero.characterTopV > hero.horizonV,
    `head ${hero.characterTopV.toFixed(3)} vs horizon ${hero.horizonV.toFixed(3)}`);

  check('the whole figure is clear of both safe zones',
    hero.characterTopV > CAMERA.safeZone.top
    && hero.anchorV < 1 - CAMERA.safeZone.bottom,
    `figure spans ${hero.characterTopV.toFixed(3)}–${hero.anchorV.toFixed(3)}`);

  check('the safe zones are the reserved bands and they do not meet',
    CAMERA.safeZone.top === 0.12 && CAMERA.safeZone.bottom === 0.30
    && CAMERA.safeZone.top + CAMERA.safeZone.bottom < 1);

  check('the contract still holds on a wider phone', (() => {
    // Vertical composition is aspect-independent; a 9:16 handset and a taller
    // 3:4 one must agree, or "60% down the frame" means nothing.
    const wide = composition(HERO, { aspect: 0.75 });
    return Math.abs(wide.anchorV - hero.anchorV) < 1e-9
      && Math.abs(wide.characterHeightV - hero.characterHeightV) < 1e-9;
  })());

  check('every framing states a full pose and a lens', (() => (
    Object.values(FRAMINGS).every((f) => (
      Array.isArray(f.target) && f.target.length === 3 && f.target.every(Number.isFinite)
      && Number.isFinite(f.dist) && Number.isFinite(f.yaw) && Number.isFinite(f.pitch)
      && Number.isFinite(f.fov) && Number.isFinite(f.drift) && f.dist > 0
    ))
  ))());

  check('there is one camera config and the framings live inside it',
    FRAMINGS === CAMERA.framings && REFERENCE_ASPECT === CAMERA.referenceAspect);

  check('every lens is derived from the one fov', (() => {
    // Each framing's fov is written as FOV ± n, so a whole-number offset from
    // 45 is the fingerprint of a value that came from the config rather than
    // from somebody's fingers.
    const offsets = Object.values(FRAMINGS).map((f) => f.fov - CAMERA.fov);
    return offsets.every((d) => Number.isInteger(d) && Math.abs(d) <= 15);
  })());

  check('no lens number is left anywhere else in the renderer', (() => {
    // The gate: camera values in one object, not scattered literals. A
    // PerspectiveCamera built with a number instead of CAMERA.fov is exactly
    // the regression this is here to catch.
    const src = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    const ctor = src.match(/new THREE\.PerspectiveCamera\(([^)]*)\)/);
    return !!ctor && /CAMERA\.fov/.test(ctor[1]) && /CAMERA\.near/.test(ctor[1])
      && /CAMERA\.far/.test(ctor[1]);
  })());
}

section('Camera lock — the QA cameras');
{
  const presets = CAMERA.debugPresets;

  check('there are four fixed presets, named', presets.length === 4
    && ['hero', 'wide', 'close', 'profile'].every((id) => presets.some((p) => p.id === id)));

  check('every preset holds the locked horizon', presets.every((p) => (
    Math.abs(composition(p.framing).horizonV - CAMERA.composition.horizonV)
      <= CAMERA.composition.tolerance.horizonV
  )), presets.map((p) => `${p.id} ${composition(p.framing).horizonV.toFixed(3)}`).join(', '));

  check('the hero preset is the hero framing', (() => {
    const h = presets.find((p) => p.id === 'hero').framing;
    const w = FRAMINGS.world;
    return h.dist === w.dist && h.yaw === w.yaw && h.pitch === w.pitch && h.fov === w.fov
      && h.target.every((n, i) => n === w.target[i]);
  })());

  check('presets do not breathe, so a capture is repeatable',
    presets.every((p) => p.framing.drift === 0));

  check('the presets step the figure through four sizes', (() => {
    // wide < hero ≈ profile < close, and all four distinct enough to tell
    // apart at a glance on the sheet.
    const h = (id) => composition(presets.find((p) => p.id === id).framing).characterHeightV;
    return h('wide') < h('hero') && h('hero') < h('close') && h('close') > 0.25 && h('wide') < 0.06;
  })());

  check('the figure stays on screen in every preset', presets.every((p) => {
    const c = composition(p.framing);
    return c.characterTopV > 0 && c.anchorV < 1 && c.anchorU > 0 && c.anchorU < 1;
  }));
}

section('Camera lock — the contact sheet');
{
  const plan = contactSheetPlan();

  check('the sheet is four cameras by four skies',
    plan.rows === 4 && plan.columns === 4 && plan.rows * plan.columns === 16);

  check('the plan produces sixteen frames', plan.cells.length === 16,
    `${plan.cells.length} cells`);

  check('every frame is labelled, and no two labels collide',
    new Set(plan.cells.map((c) => c.label)).size === 16
    && plan.cells.every((c) => /\S+ · \S+/.test(c.label)));

  check('the sheet walks the whole day', (() => {
    const ts = CAMERA.timesOfDay.map((t) => t.t);
    return ts.length === 4 && ts[0] === 0
      && ts.every((t, i) => i === 0 || t > ts[i - 1]);
  })());

  check('each sampled time lands on an authored state, not between two', (() => {
    // A cell that looks wrong should be a time of day that is wrong, not an
    // artefact of blending — so every column sits exactly on a TIMES entry,
    // and the four columns are the four states in order.
    return CAMERA.timesOfDay.length === TIMES.length
      && CAMERA.timesOfDay.every((c, i) => c.t === TIMES[i].at && c.id === TIMES[i].id);
  })(), CAMERA.timesOfDay.map((c) => `${c.id} ${c.t}`).join(', '));

  check('the plan is pure — no renderer, no DOM', (() => {
    const src = readFileSync(new URL('../js/view3d/framing.js', import.meta.url), 'utf8');
    return !/\bthree\b|document\.|window\./.test(src);
  })());
}

section('Camera lock — grayscale is true luminance');
{
  // Only the post pass — shaders.js is a dozen materials and several of them
  // end on the same line of GLSL, so an unscoped indexOf finds the wrong one.
  const shaders = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
  const post = shaders.slice(shaders.indexOf('export function makePostMaterial'));

  check('the luminance weights are Rec. 601 and sum to one',
    LUMA.length === 3 && Math.abs(LUMA.reduce((a, b) => a + b, 0) - 1) < 1e-9
    && LUMA[1] > LUMA[0] && LUMA[0] > LUMA[2]);

  check('luminance() uses the shared weights', (() => {
    const white = luminance('#ffffff');
    const red = luminance('#ff0000');
    const green = luminance('#00ff00');
    const blue = luminance('#0000ff');
    return near(white, 255) && near(red, LUMA[0] * 255)
      && near(green, LUMA[1] * 255) && near(blue, LUMA[2] * 255);
  })());

  check('the post pass converts with those same weights', (() => {
    // Two rulers would be worse than none: QA would pass what the suite fails.
    // The GLSL interpolates LUMA rather than restating it, which is what makes
    // that impossible — so that is what gets asserted.
    const wired = `dot(col, vec3(\${LUMA[0]}, \${LUMA[1]}, \${LUMA[2]}))`;
    return post.includes(wired) && !/vec3\(\s*0\.299\s*,/.test(shaders);
  })());

  check('grayscale is the last thing that happens to the frame', (() => {
    // Applied before the flash or the vignette it would be measuring a picture
    // the player never sees.
    return post.indexOf('uGrayscale > 0.0') > post.indexOf('uFlashColor, clamp(uFlash')
      && post.indexOf('uGrayscale > 0.0') < post.indexOf('gl_FragColor = vec4(col, 1.0)');
  })());

  check('the toggle ships off', /uGrayscale: \{ value: 0 \}/.test(post));

  check('it works on every tier, because the grade is not optional', (() => {
    // The instrument used to have to force a render target into existence on
    // `low`, which shipped without a post pass at all. It cannot any more: the
    // last pass of the composer is what tone maps and encodes the frame, so a
    // tier without it would be putting raw linear light on an sRGB screen.
    // Bloom is the quality setting now; the grade runs everywhere, and so does
    // the toggle that lives inside it.
    const src = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    return Object.values(TIERS).every((t) => t.post === undefined)
      && TIERS.low.bloom === false && TIERS.high.bloom === true
      && /function setGrayscale/.test(src) && !/forcePost/.test(src);
  })());
}

section('Stage 2 — the day as data');
{
  const KEYS = ['zenith', 'horizon', 'sun', 'accent', 'rim',
    'sunElevation', 'fogDensity', 'exposure', 'sunPower', 'stars', 'bloom'];

  check('there are four authored states, and they are the four the brief names',
    TIMES.length === 4
    && TIMES.map((t) => t.id).join(',') === 'dawn,day,sunset,night'
    && TIMES.map((t) => t.at).join(',') === '0,0.25,0.5,0.75');

  check('every state carries every field', TIMES.every((t) => (
    KEYS.every((k) => t[k] !== undefined)
    && ['zenith', 'horizon', 'sun', 'accent', 'rim'].every((k) => /^#[0-9a-f]{6}$/.test(t[k]))
    && KEYS.every((k) => typeof t[k] === 'string' || Number.isFinite(t[k]))
  )));

  check('the table is the brief\'s table', (() => {
    // The one place the authored numbers are restated, so a nudge to any of
    // them is a deliberate edit in two files rather than a drift in one.
    const want = [
      ['dawn', '#2b3a52', '#8fa3b8', '#e8d5c0', 6, 0.018, 0.90, '#9fe3d0'],
      ['day', '#4a7ba8', '#cfe0ea', '#fff6e6', 55, 0.010, 1.10, '#8fe0c8'],
      ['sunset', '#6b3f52', '#f0a860', '#ff9a4d', 4, 0.016, 1.00, '#ffd98a'],
      ['night', '#0d1626', '#2a3752', '#cfe0ff', 40, 0.020, 0.75, '#7fd4ff'],
    ];
    return want.every(([id, zenith, horizon, sun, elev, fog, exp, accent], i) => {
      const t = TIMES[i];
      return t.id === id && t.zenith === zenith && t.horizon === horizon && t.sun === sun
        && t.sunElevation === elev && t.fogDensity === fog && t.exposure === exp
        && t.accent === accent;
    });
  })());

  check('night is the one that brings stars, bloom and a blue rim', (() => {
    const night = TIMES[3];
    const others = TIMES.slice(0, 3);
    // Bloom 0.55 at night against the day's 0.40, and a rim that is bluer than
    // the moon lighting it — the sky is the only thing standing behind her.
    const blue = (hex) => (parseInt(hex.slice(1), 16) & 255)
      - ((parseInt(hex.slice(1), 16) >> 16) & 255);
    return night.stars === 1 && night.bloom === 0.55
      && others.every((t) => t.bloom === 0.40 && t.stars < 0.5)
      && blue(night.rim) > blue(night.sun) && blue(night.rim) > 80;
  })());

  check('every value between two states is a lerp, and the shape never changes', (() => {
    const shape = [...KEYS, 'below', 'fog'].sort().join(',');
    for (let i = 0; i <= 96; i++) {
      const t = timeOfDayAt(i / 96);
      if (![...KEYS, 'below', 'fog'].every((k) => k in t)) return false;
      if (KEYS.filter((k) => k in t).concat(['below', 'fog']).sort().join(',') !== shape) return false;
      if (!/^#[0-9a-f]{6}$/.test(t.zenith) || !/^#[0-9a-f]{6}$/.test(t.horizon)) return false;
      if (!Number.isFinite(t.fogDensity) || !Number.isFinite(t.exposure)) return false;
    }
    return true;
  })());

  check('nothing on the dial pops', (() => {
    // The gate, as a number. Walk the whole day at a thousand steps and hold
    // every field to a ceiling on how much it may move in one step — no field
    // may jump more than about four times the average, which is what a
    // hard-swap between two states would look like.
    const N = 1000;
    const at = (i) => timeOfDayAt(i / N);
    const chan = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    let worstColor = 0;
    let worstNumber = 0;
    for (let i = 0; i <= N; i++) {
      const a = at(i);
      const b = at(i + 1);
      for (const k of ['zenith', 'horizon', 'sun', 'accent', 'rim', 'below']) {
        const [ar, ag, ab] = chan(a[k]);
        const [br, bg, bb] = chan(b[k]);
        worstColor = Math.max(worstColor, Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
      }
      for (const k of ['sunElevation', 'exposure', 'sunPower', 'stars', 'bloom']) {
        // Relative to the field's own range, so degrees and exposures are
        // judged on the same scale.
        const span = Math.max(...TIMES.map((t) => t[k])) - Math.min(...TIMES.map((t) => t[k]));
        if (span > 0) worstNumber = Math.max(worstNumber, Math.abs(a[k] - b[k]) / span);
      }
    }
    // One step of a thousand across four states: 4/1000 of any range, plus a
    // level of rounding on the colours.
    return worstColor <= 2 && worstNumber <= 0.006;
  })());

  check('the dial is a circle: night runs back into dawn', (() => {
    const a = timeOfDayAt(0.999);
    const b = timeOfDayAt(0.0);
    const near = (x, y) => Math.abs(x - y) < 0.02;
    return timeOfDayAt(1).horizon === TIMES[0].horizon
      && timeOfDayAt(-0.25).horizon === TIMES[3].horizon
      && timeOfDayAt(1.25).horizon === TIMES[1].horizon
      && near(a.exposure, b.exposure) && wrapDay(-0.1) === 0.9;
  })());

  check('easing the hour takes the short way round', (() => {
    // Ascension stands at daybreak and rebirth returns to first light: the same
    // sky, a distance of zero. Eased as a plain number that is a whole day run
    // backwards in three seconds.
    const stays = lerpDay(1.0, 0.0, 0.5) === 0 || wrapDay(lerpDay(1.0, 0.0, 0.5)) < 1e-9;
    const forward = lerpDay(0.78, 1.0, 0.5);
    const back = lerpDay(0.05, 0.95, 0.5);
    return stays && Math.abs(forward - 0.89) < 1e-9 && Math.abs(back - 0.0) < 1e-9;
  })());

  check('the fog colour IS the horizon colour', (() => {
    // Rule one of the whole stage, checked as identity rather than as
    // closeness: distant geometry hazing toward anything else is a rectangle
    // pasted on the sky. The renderer's half of this is asserted below.
    for (let i = 0; i <= 40; i++) {
      const t = timeOfDayAt(i / 40);
      if (t.fog !== t.horizon) return false;
    }
    return true;
  })());

  check('the world paints scene.fog from that colour, and the shaders read it back', (() => {
    const src = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');
    const idx = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    return /new THREE\.FogExp2\(/.test(src)
      && /fog\.color\.copy\(cur\.horizon\)/.test(src)
      && /fog\.density = cur\.density/.test(src)
      && /env\.uFogColor\.value\.copy\(fog\.color\)/.test(src)
      && /env\.uFogHigh\.value\.copy\(cur\.zenith\)/.test(src)
      && /env\.uFogDensity\.value = fog\.density/.test(src)
      && /scene\.fog = world\.fog/.test(idx);
  })());

  check('the sun is the realm\'s bearing and the day\'s elevation', (() => {
    const dir = sunDirection(-52, 6);
    const elev = (Math.atan2(dir[1], Math.hypot(dir[0], dir[2])) * 180) / Math.PI;
    const bearing = (Math.atan2(dir[0], dir[2]) * 180) / Math.PI;
    const unit = Math.abs(Math.hypot(...dir) - 1) < 1e-12;
    return unit && Math.abs(elev - 6) < 1e-9 && Math.abs(bearing + 52) < 1e-9;
  })());

  check('every hour puts the sun above the horizon and out of the zenith',
    TIMES.every((t) => t.sunElevation >= 3 && t.sunElevation <= 60),
    TIMES.map((t) => `${t.id}: ${t.sunElevation}°`).join(', '));

  check('the day is the only thing that decides exposure and bloom', (() => {
    // One dial each, both read off the world's own eased values, so neither can
    // step while the sky is still fading.
    const idx = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    const post = readFileSync(new URL('../js/view3d/post.js', import.meta.url), 'utf8');
    return /renderer\.toneMappingExposure = world\.atmosphere\.exposure/.test(idx)
      && /post\.setBloomStrength\(world\.atmosphere\.bloom\)/.test(idx)
      && /function setBloomStrength/.test(post)
      && /uExposure\.value = renderer\.toneMappingExposure/.test(post);
  })());

  check('the character\'s rim light is the day\'s, not the sun\'s', (() => {
    const src = readFileSync(new URL('../js/view3d/lighting.js', import.meta.url), 'utf8');
    return /rim\.color\.copy\(cur\.rimColor\)/.test(src)
      && /sun\.color\.copy\(cur\.sunColor\)/.test(src);
  })());

  check('nearestTime names the hour, wrapping at both ends',
    nearestTime(0.01).id === 'dawn' && nearestTime(0.99).id === 'dawn'
    && nearestTime(0.26).id === 'day' && nearestTime(0.74).id === 'night');
}

section('Stage 2 — aerial perspective, as three material tiers');
{
  check('there are three tiers and they recede', (() => (
    AERIAL.length === 3
    && AERIAL.map((t) => t.id).join(',') === 'near,mid,far'
    && AERIAL.every((t, i) => i === 0 || (
      t.air > AERIAL[i - 1].air && t.desat > AERIAL[i - 1].desat
      && t.fogCap > AERIAL[i - 1].fogCap && t.sun < AERIAL[i - 1].sun
    ))
  ))());

  check('a tier is lighter than the one in front of it, for any ink and any air', (() => {
    for (const ink of ['#000000', '#1b2129', '#2a1a1e', '#3a4a2a', '#ffffff']) {
      for (const t of [0, 0.17, 0.25, 0.5, 0.63, 0.75, 0.9]) {
        const air = timeOfDayAt(t).horizon;
        const [a, b, c] = aerialTiers(ink, air).map(luminance);
        const toward = luminance(ink) < luminance(air);
        if (toward ? !(a < b && b < c) : !(a > b && b > c)) return false;
      }
    }
    return true;
  })());

  check('and never darker than the air it stands in', (() => (
    PALETTES.every((p) => {
      for (let i = 0; i <= 24; i++) {
        const air = timeOfDayAt(i / 24).horizon;
        const palest = Math.max(...aerialTiers(p.ink, air).map(luminance));
        if (palest >= luminance(air)) return false;
      }
      return true;
    })
  ))());

  check('desaturation keeps a colour\'s value', (() => {
    // The whole reason the tiers can be derived rather than authored: pulling a
    // colour toward its own grey cannot move it up or down the value ladder,
    // so only the deliberate mix toward the air does.
    for (const hex of ['#2a1a1e', '#0d2a30', '#f0a860', '#7fd4ff']) {
      for (const k of [0, 0.12, 0.4, 1]) {
        if (Math.abs(luminance(desaturateHex(hex, k)) - luminance(hex)) > 1.5) return false;
      }
    }
    return true;
  })());

  check('mixing a colour with itself changes nothing',
    mixHex('#3c4552', '#3c4552', 0.37) === '#3c4552'
    && mixHex('#000000', '#ffffff', 0) === '#000000'
    && mixHex('#000000', '#ffffff', 1) === '#ffffff');

  check('a midpoint mix is the midpoint', mixHex('#000000', '#ffffff', 0.5) === '#808080');

  check('the three ranks are wired to the derived tiers, not to an authored ramp', (() => {
    const idx = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');
    return /aerialTiers\(p\.ink, tod\.horizon\)/.test(idx)
      && /const ink = p\.peaks/.test(scn)
      && scn.includes('fogCap: 0.22') && scn.includes('fogCap: 0.60');
  })());

  check('only the ink shaders apply the air', (() => {
    // scene.fog exists now, and three applies it to any stock material that
    // does not opt out. There are exactly two of those in the renderer, and a
    // third one appearing would be a second opinion about the air.
    const files = ['effects.js', 'avatar.js', 'sect.js', 'scenery.js', 'world.js'];
    return files.every((f) => {
      const src = readFileSync(new URL(`../js/view3d/${f}`, import.meta.url), 'utf8');
      const stock = src.match(/new THREE\.(Line|Points|Sprite|Mesh)[A-Za-z]*Material\(\{[^}]*\}/g) || [];
      return stock.every((m) => /fog: false/.test(m));
    });
  })());

  check('the scrubber never repaints while the game owns the hour', (() => {
    const src = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    return /dayOverride/.test(src) && /if \(dayOverride !== null\) return;/.test(src);
  })());
}

section('Stage 2 — the sky sphere');
{
  const shaders = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
  const sky = shaders.slice(
    shaders.indexOf('export function makeSkyMaterial'),
    shaders.indexOf('/* --------------------------------------------------------------- ridges */'),
  );
  const post = shaders.slice(shaders.indexOf('export function makePostMaterial'));
  const world = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');

  check('it is a BackSide sphere with a ShaderMaterial on it',
    /side: THREE\.BackSide/.test(sky) && /new THREE\.ShaderMaterial/.test(sky)
    && /new THREE\.SphereGeometry\(760, 64, 32\)/.test(world));

  check('three stops: zenith, horizon, below-horizon', (() => (
    /uZenith/.test(sky) && /uHorizon/.test(sky) && /uBelow/.test(sky)
    && /mix\(uHorizon, uZenith/.test(sky) && /mix\(col, uBelow/.test(sky)
    // and no fourth: the old top/mid pair is gone
    && !/uTop|uMid\b/.test(sky)
  ))());

  check('the sun disc is a smoothstep on dot(viewDir, sunDir), with a wide halo',
    /float cosA = dot\(d, normalize\(uSunDir\)\)/.test(sky)
    && /smoothstep\(DISC_COS - DISC_SOFT, DISC_COS \+ DISC_SOFT, cosA\)/.test(sky)
    && /smoothstep\(HALO_COS, 1\.0, cosA\)/.test(sky));

  check('there is no hardcoded moon left in it', (() => (
    // A set piece lit for one hour of one realm is exactly what this stage
    // exists to remove. The moon is the night's sun, at the night's direction.
    !/uMoon/.test(shaders) && !/vec3 md = normalize/.test(sky)
  ))());

  check('the dither is per pixel, one 255th, and the last thing in the pipeline', (() => {
    // In the post pass, not in the sky: the staircase appears where the frame
    // is quantised to eight bits, and that is the only place where 1/255 is a
    // step. A flat 1/255 of *linear* light in the sky shader would be half a
    // step at noon and seven steps of visible noise at midnight.
    const line = 'col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;';
    return post.includes(line)
      && post.indexOf(line) > post.indexOf('uGrayscale > 0.0')
      && post.indexOf(line) < post.indexOf('gl_FragColor = vec4(col, 1.0)')
      && !/gl_FragCoord/.test(sky);
  })());

  check('nothing else is laid over the sky', (() => {
    // No fbm in the base gradient — the noise that is left is the aurora, the
    // golden sea and the storm, all of which are flagged off in a plain sky.
    const base = sky.slice(sky.indexOf('vec3 d = normalize(vRay)'), sky.indexOf('if (uAurora > 0.0)'));
    return !/fbm\(/.test(base);
  })());

  check('the fabric striping is gone from the post pass', (() => {
    // Two anisotropic fbm octaves — one stretched along x, one along y — is a
    // weave, and a weave over a flat sky is a sheet hanging behind the
    // mountains. The isotropic paper tooth stays.
    return !/float fibre/.test(post) && /float tooth = hash21/.test(post)
      && !/fbm\(vec2\(px\.x \* 0\.016/.test(post);
  })());

  check('the sky reads its direction per fragment, not off the vertex position', (() => (
    // normalize(position) on a coarse sphere interpolates a chord where it
    // wants an arc, which steps the gradient once per segment: a vertical seam
    // every 11 degrees across the one surface with nothing else on it.
    /vRay = world\.xyz - cameraPosition/.test(sky) && !/vDir = normalize\(position\)/.test(sky)
  ))());
}

section('Stage 3 — the tile the sea is made of');
{
  // A seam is silent in every unit test ever written and a ruled grid over the
  // whole sea on screen, so the periodicity is asserted directly rather than
  // inferred from the tile looking fine in a dump of it.
  const samples = [];
  for (let i = 0; i < 64; i++) samples.push([(i * 0.1237) % 1, (i * 0.0791) % 1]);

  check('the tile is inside the texture budget, and a power of two',
    TILE <= 512 && (TILE & (TILE - 1)) === 0, `${TILE}²`);

  check('the field is periodic in u — no vertical seam', (() => {
    let worst = 0;
    for (const [u, v] of samples) {
      worst = Math.max(worst, Math.abs(cloudAlpha(u, v) - cloudAlpha(u + 1, v)));
      worst = Math.max(worst, Math.abs(cloudAlpha(u, v) - cloudAlpha(u - 3, v)));
    }
    return worst < 1e-9;
  })());

  check('the field is periodic in v — no horizontal seam', (() => {
    let worst = 0;
    for (const [u, v] of samples) {
      worst = Math.max(worst, Math.abs(cloudAlpha(u, v) - cloudAlpha(u, v + 1)));
      worst = Math.max(worst, Math.abs(cloudAlpha(u, v) - cloudAlpha(u, v - 2)));
    }
    return worst < 1e-9;
  })());

  check('the swell is periodic too, so the surface meets itself', (() => {
    let worst = 0;
    for (const [u, v] of samples) {
      worst = Math.max(worst, Math.abs(swellAt(u, v, 17) - swellAt(u + 1, v, 17)));
      worst = Math.max(worst, Math.abs(swellAt(u, v, 17) - swellAt(u, v + 1, 17)));
    }
    return worst < 1e-9 && SWELL.amplitude > 0;
  })());

  check('it is cloud, not a wash: open gaps, solid bodies, and coverage near a third', (() => {
    // Four layers of it are composited, and stacked alphas converge on their
    // mean: at half coverage a layer the union comes out even everywhere and
    // the structure cancels statistically. This is the number that stops that.
    const tile = cloudTile({ size: 64, seed: 3, cells: 8, coverage: 0.36 });
    let sum = 0, clear = 0, solid = 0;
    const n = tile.length / 4;
    for (let i = 1; i < tile.length; i += 4) {
      sum += tile[i];
      if (tile[i] < 12) clear++;
      if (tile[i] > 243) solid++;
    }
    const mean = sum / n / 255;
    return mean > 0.24 && mean < 0.48 && clear / n > 0.10 && solid / n > 0.02;
  })());

  check('every channel carries it, because alphaMap reads the green one', (() => {
    // A single-channel texture hands three a zero here: an entirely invisible
    // sea, from a tile that is correct in every dump of it.
    const tile = cloudTile({ size: 8 });
    for (let i = 0; i < tile.length; i += 4) {
      if (tile[i] !== tile[i + 1] || tile[i + 1] !== tile[i + 2]) return false;
    }
    return true;
  })());

  check('it is deterministic — the same seed is the same tile', (() => {
    const a = cloudTile({ size: 16, seed: 5 });
    const b = cloudTile({ size: 16, seed: 5 });
    const c = cloudTile({ size: 16, seed: 6 });
    return a.every((x, i) => x === b[i]) && !a.every((x, i) => x === c[i]);
  })());
}

section('Stage 3 — where the sea sits, against the locked camera');
{
  const framing = FRAMINGS.world;
  const basis = cameraBasis(framing);
  const eyeY = basis.pos[1];
  const horizon = horizonV(framing);
  const heights = seatHeights();

  // A point on a horizontal plane at height `h`, `d` units out along the
  // camera's own bearing — and where it lands in the frame. The real
  // projection, not an approximation of it: this is the whole argument.
  const fwd = Math.hypot(basis.z[0], basis.z[2]);
  const seaV = (h, d) => frameOf([
    basis.pos[0] - (basis.z[0] / fwd) * d, h, basis.pos[2] - (basis.z[2] / fwd) * d,
  ], { framing }).v;

  /** The depth the middle of the sea is seen at. */
  const MID = 110;

  check('the brief\'s own heights would be a ceiling at this camera', (() => {
    // y = 2.0, 2.6, 3.2, 3.8 against an eye at 2.0251: the first is 25 mm under
    // it and the other three are over it. A plane above the eye is seen from
    // below and converges on the horizon from the top of the frame — an
    // overcast lid over every summit, with the brightest rung of the value
    // ladder laid over the darkest.
    const brief = [2.0, 2.6, 3.2, 3.8];
    return eyeY - brief[0] > 0 && eyeY - brief[0] < 0.05
      && brief.slice(1).every((y) => y > eyeY);
  })(), `eye at y ${eyeY.toFixed(4)}`);

  check('and the lowest of them would be two pixels tall', (() => {
    // Its entire extent, from the near plane to four hundred units out, lands
    // inside a sliver under the horizon.
    const nearest = seaV(2.0, CAMERA.near);
    const furthest = seaV(2.0, PLANE / 2);
    return nearest - horizon < 0.07 && furthest - horizon < 0.001;
  })());

  check('the brief\'s 0.6 spacing is under 1% of the frame; this stack is over 2%', (() => {
    const brief = Math.abs(seaV(2.0, MID) - seaV(2.6, MID));
    const ours = Math.abs(seaV(heights[0], MID) - seaV(heights[1], MID));
    return brief < 0.01 && ours > 0.02;
  })(), `brief ${(Math.abs(seaV(2.0, MID) - seaV(2.6, MID)) * 100).toFixed(2)}%`);

  check('every layer hangs below the eye', heights.every((h) => h < eyeY - 1),
    heights.map((h) => h.toFixed(2)).join(' '));

  check('they stack in frame order, and far enough apart to be seen apart', (() => {
    const vs = heights.map((h) => seaV(h, MID));
    for (let i = 1; i < vs.length; i++) {
      if (!(vs[i] < vs[i - 1] - 0.02)) return false;   // higher layer, higher in frame
    }
    return true;
  })());

  check('the sea never crosses the skyline', (() => {
    // Everything below the eye projects below the horizon at every depth, which
    // is what keeps the brightest rung out of the sky and off the summits.
    for (const h of heights) {
      for (const d of [30, 60, 110, 198, 400, 4000]) {
        if (seaV(h, d) <= horizon) return false;
      }
    }
    return true;
  })());

  check('the whole sea lands in the strip the player can actually see', (() => {
    // Between the skyline and the band the UI owns. A horizontal surface has
    // only that strip to occupy at this tilt: higher and it is in the sky where
    // the ranks are, lower and it is behind the shelf.
    const floor = 1 - CAMERA.safeZone.bottom + 0.02;
    const nearShore = seaV(heights[0], LAYERS[0].near[1]);
    const farEdge = seaV(heights[heights.length - 1], LAYERS[LAYERS.length - 1].far[1]);
    return SEAT.v > horizon + 0.1 && SEAT.v < floor
      && nearShore < floor && farEdge > horizon + 0.02;
  })(), `shore ${seaV(heights[0], LAYERS[0].near[1]).toFixed(3)}`);

  check('the banks are staggered, so four layers are four distances', (() => {
    for (let i = 1; i < LAYERS.length; i++) {
      if (!(LAYERS[i].near[0] > LAYERS[i - 1].near[0] + 15)) return false;
      if (!(LAYERS[i].near[1] > LAYERS[i].near[0])) return false;
    }
    return true;
  })());

  check('the sea fades out before its own rectangle does', (() => (
    // A 400-unit square centred on the eye reaches 200 units in the worst
    // direction. Anything still opaque at that radius draws a straight edge
    // across the frame the first time the player swings the camera.
    LAYERS.every((L) => L.far[1] <= PLANE / 2 - 1 && L.far[0] < L.far[1])
  ))());

  check('and it starts beyond the foreground island', LAYERS.every((L) => L.near[0] >= 30));
}

section('Stage 3 — the sea as it is drawn');
{
  const src = readFileSync(new URL('../js/view3d/cloud-sea.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');

  check('the build is the brief\'s: basic material, alpha map, both sides, no depth write',
    /new THREE\.MeshBasicMaterial\(/.test(src) && /alphaMap: map/.test(src)
    && /transparent: true/.test(src) && /depthWrite: false/.test(src)
    && /side: THREE\.DoubleSide/.test(src)
    && /new THREE\.PlaneGeometry\(PLANE, PLANE/.test(src) && PLANE === 400);

  check('it opts out of the tone curve the post pass already applies', (() => (
    // A stock material applies the renderer's ACES curve in its own fragment
    // shader. The composer applies it again at the end. Twice is milk.
    /toneMapped: false/.test(src)
  ))());

  check('it opts out of scene.fog and hazes by hand instead', (() => (
    // exp² fog is total by 400 units: switched on, the far half of a surface
    // drawn to the horizon *is* the horizon colour, and the sea stops existing.
    /fog: false/.test(src) && /uFogColor/.test(src) && /uFogDensity/.test(src)
  ))());

  check('it takes its light from the rig, not from a second opinion', (() => (
    // env.uLightDir and env.uLightColor are what lighting.js writes and what
    // every ink shader reads, so the cloud and the rock cannot disagree about
    // where the sun is.
    /env\.uLightDir\.value/.test(src) && /env\.uLightColor\.value/.test(src)
    && !/new THREE\.Vector3\(0\.4/.test(src)
  ))());

  check('the world paints it after the light rig, never before',
    world.indexOf('lighting.apply(cur)') < world.indexOf('cloudSea.apply('));

  check('the alpha map is anisotropic, short axis along the sightline',
    LAYERS.every((L) => L.repeat[1] > L.repeat[0] * 2),
    LAYERS.map((L) => L.repeat.join(':')).join(' '));

  check('the across-view axis really is across the view', (() => {
    // Re-derived from the framing rather than trusted: the plane's local +x is
    // world +x and its uv.y runs against world z, so the camera's bearing in uv
    // is atan2(-z.z … ). If the camera moves and this constant does not, the
    // whole anisotropy is pointing the wrong way and the sea reads as still.
    const b = cameraBasis(FRAMINGS.world);
    const viewUv = Math.atan2(-b.z[2] * -1, -b.z[0]);   // (dx, -dz) of the view
    const dot = Math.cos(ACROSS_UV) * Math.cos(viewUv) + Math.sin(ACROSS_UV) * Math.sin(viewUv);
    return Math.abs(viewUv - VIEW_UV) < 0.02 && Math.abs(dot) < 0.03;
  })());

  check('the painter\'s stack goes furthest first', (() => {
    // These write no depth. Ordered nearest-first — which is how the list reads
    // — the palest, furthest layer composites last and paints over the three in
    // front of it, and the sea collapses to one flat sheet.
    for (let i = 1; i < LAYERS.length; i++) {
      if (!(LAYERS[i].order < LAYERS[i - 1].order)) return false;
    }
    return true;
  })());

  check('it sits between the ridge strips and the near mist in that stack', (() => (
    // Above the ridges and the standing decks (-6 … -17), so it drowns their
    // feet; below the near mist band (-4), so the air still lies over it. No
    // ties: a tie hands the order to a distance sort that can flip.
    LAYERS.every((L) => L.order > -6 && L.order < -4)
    && new Set(LAYERS.map((L) => L.order)).size === LAYERS.length
  ))());

  check('the near layer leads the parallax, and the drift stays calm', (() => {
    // World units per second, which is what the brief's 0.0015 reads as: that
    // fraction of the 400-unit plane. The nearest layer is the fastest — the
    // index ramp taken as written runs the furthest one quickest, which is
    // parallax backwards — and even it takes most of a minute to cross.
    const n = LAYERS.length;
    const speed = (i) => SCROLL * ((n - i) / 2) * PLANE;
    for (let i = 1; i < n; i++) if (!(speed(i) < speed(i - 1))) return false;
    return speed(0) > 0.3 && speed(0) < 1.5;
  })(), `${(SCROLL * (LAYERS.length / 2) * PLANE).toFixed(2)} units/s on the near layer`);

  check('every layer drifts on its own heading', (() => (
    new Set(LAYERS.map((L) => L.heading)).size === LAYERS.length
    && new Set(LAYERS.map((L) => L.rotation)).size === LAYERS.length
    // …and mostly across the view, or the scroll is spent on the compressed axis
    && LAYERS.every((L) => Math.abs(Math.sin(L.heading)) < 0.5)
  ))());

  check('the sun tint is a trace, and it is the sun\'s colour', (() => {
    const tint = Number(/const SUN_TINT = ([\d.]+)/.exec(src)?.[1]);
    return tint > 0 && tint <= 0.3;
  })());

  check('the haze is capped well short of the air', (() => {
    // Cloud that has reached the air colour is not the top rung of the ladder
    // any more, it is the middle one.
    const cap = Number(/const HAZE_CAP = ([\d.]+)/.exec(src)?.[1]);
    return cap > 0 && cap <= 0.35;
  })());

  check('the tile is generated once per session, not once per scene rebuild', (() => (
    // A quality change rebuilds the whole world. Seventy milliseconds of noise
    // per rebuild is a stutter the player would read as the game hanging.
    /let tileData = null/.test(src) && /if \(!tileData\)/.test(src)
  ))());

  check('every tier asks for a number of layers that exists',
    Object.values(TIERS).every((t) => Number.isInteger(t.cloudLayers)
      && t.cloudLayers >= 0 && t.cloudLayers <= LAYERS.length)
    && TIERS.low.cloudLayers <= TIERS.medium.cloudLayers
    && TIERS.medium.cloudLayers <= TIERS.high.cloudLayers
    && TIERS.high.cloudLayers === LAYERS.length);

  check('a tier change rebuilds the scene rather than leaving the old stack up', (() => {
    const index = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    return /'cloudLayers'/.test(index)
      && index.indexOf("'cloudLayers'") > index.indexOf('const GEOMETRY_KEYS');
  })());

  check('both new modules are in the service worker shell', (() => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    return sw.includes("'./js/view3d/cloud-sea.js'") && sw.includes("'./js/view3d/cloud-plan.js'");
  })());
}

/** The far shore's crest, as frame positions across the whole visible width. */
function crestSamples(field) {
  const out = [];
  for (let i = 0; i <= 20; i++) {
    const u = -0.05 + i * 0.055;
    const x = placeAtDepth(u, 0.45, SHORE.z)[0];
    const y = crestAt(x, field);
    out.push(frameOf([x, y, SHORE.z]).v);
  }
  return out;
}

section('Stage 4 — the noise the granite is carved from');
{
  const noise = makeNoise3(7);

  check('a seed reproduces a mountain exactly', (() => {
    const a = makeNoise3(11);
    const b = makeNoise3(11);
    for (const p of [[0.5, 1.5, 2.5], [-3.2, 7.1, 0.4], [100.25, -0.5, 33]]) {
      if (a(...p) !== b(...p)) return false;
    }
    // Sampled off the lattice: simplex is zero at every integer corner whatever
    // the permutation is, so an integer probe compares nothing.
    return a(0.31, 1.77, 2.13) !== makeNoise3(12)(0.31, 1.77, 2.13);
  })());

  check('simplex stays inside about ±1 and averages to nothing', (() => {
    let lo = 9, hi = -9, sum = 0;
    for (let i = 0; i < 8000; i++) {
      const v = noise((i * 0.137) % 37 - 18, (i * 0.311) % 23 - 11, (i * 0.719) % 41 - 20);
      lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v;
    }
    return lo > -1.05 && hi < 1.05 && lo < -0.7 && hi > 0.7 && Math.abs(sum / 8000) < 0.05;
  })());

  check('ridged noise is 0..1 and piles up at the crease', (() => {
    // `1 - |noise|` folds the field at every zero crossing, so the distribution
    // is skewed hard toward 1 — that skew *is* the ridge. A symmetric histogram
    // means the absolute value went missing and the rock is a lumpy taper.
    const bins = new Array(10).fill(0);
    let lo = 9, hi = -9;
    for (let i = 0; i < 8000; i++) {
      const v = ridged3(noise, (i * 0.137) % 37 - 18, (i * 0.311) % 23 - 11,
        (i * 0.719) % 41 - 20, { freq: 0.7 });
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      bins[Math.min(9, Math.floor(v * 10))]++;
    }
    const upper = bins.slice(6).reduce((a, b) => a + b, 0);
    const lower = bins.slice(0, 4).reduce((a, b) => a + b, 0);
    return lo >= 0 && hi <= 1 && upper > lower * 3;
  })());

  check('two octaves, and the second is offset as well as scaled', (() => {
    // Both octaves folding in the same places only deepens one crease. The
    // second is displaced in the lattice, which is what breaks the first.
    const src = readFileSync(new URL('../js/view3d/noise.js', import.meta.url), 'utf8');
    return /1 - Math\.abs\(noise\(/.test(src) && /octaves = 2/.test(src)
      && /ox \+= 17\.31/.test(src);
  })());
}

section('Stage 4 — six rocks, and no cones');
{
  const src = readFileSync(new URL('../js/view3d/peaks.js', import.meta.url), 'utf8');
  const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');

  check('the range is five or six unique meshes, no more', (() => (
    PEAK_MESHES.length >= 5 && PEAK_MESHES.length <= 6
    && new Set(PEAK_MESHES.map((m) => m.id)).size === PEAK_MESHES.length
  ))(), `${PEAK_MESHES.length} meshes`);

  check('every blank is a cylinder, and nothing in the range is a cone', (() => (
    // A cone is the one shape the eye names instantly and never mistakes for
    // landscape. The pines keep theirs — a pine *is* a cone — but no rock may.
    /new THREE\.CylinderGeometry\(/.test(src) && !/ConeGeometry/.test(src)
    && !/ConeGeometry/.test(readFileSync(new URL('../js/view3d/peak-plan.js', import.meta.url), 'utf8'))
  ))());

  check('the blanks are 7–9 sided and 12–16 rows', PEAK_MESHES.every((m) => (
    m.radialSegments >= 7 && m.radialSegments <= 9
    && m.heightSegments >= 12 && m.heightSegments <= 16
  )), PEAK_MESHES.map((m) => `${m.radialSegments}×${m.heightSegments}`).join(' '));

  check('no summit is a point: radiusTop is 0.15–0.6 of radiusBottom',
    PEAK_MESHES.every((m) => m.radiusTop >= 0.15 && m.radiusTop <= 0.6),
    PEAK_MESHES.map((m) => m.radiusTop.toFixed(2)).join(' '));

  check('each carries 2–4 shelves', PEAK_MESHES.every((m) => m.shelves >= 2 && m.shelves <= 4));

  check('every blank is reshaped into a mountain mass before surface noise', PEAK_MESHES.every((m) => (
    m.silhouette && m.silhouette.base >= 0.3 && m.silhouette.shoulder > 0
    && m.silhouette.waist > 0 && m.silhouette.asym > 0
    && Array.isArray(m.silhouette.drift) && m.silhouette.drift.length === 2
  )));

  check('the top profiles are varied, and the set covers the brief', (() => {
    const tops = PEAK_MESHES.map((m) => m.top);
    return tops.includes('plateau') && tops.includes('saddle')
      && tops.includes('arch') && PEAK_MESHES.some((m) => m.lean)
      && new Set(tops).size >= 4;
  })(), PEAK_MESHES.map((m) => m.top).join(' '));

  check('the plateau carries a pavilion, built into its own mesh', (() => (
    // A silhouette on the summit is the scale cue: a mountain with nothing on
    // it could be thirty metres tall. Merged rather than instanced separately,
    // so it costs no draw call.
    /function pavilionGeometry/.test(src) && /top === 'plateau'/.test(src)
    && /mergeGeometries\(\[geo, pav\]\)/.test(src)
  ))());

  check('the arch is negative space, not a painted-on hole', (() => (
    /function archPeak/.test(src) && /const gap = spec\.radiusBottom/.test(src)
  ))());

  check('the displacement is radial and welded to the seam', (() => (
    // Every cylinder repeats its seam column and shares its rim with the caps.
    // A displacement that is a pure function of the *position* gives the
    // duplicates the same answer; anything that reached for a vertex index
    // would tear the mesh open along the seam and at both caps.
    /pos\.setXYZ\(i, x \* rs \* mass \+ dx, y, z \* rs \* mass \* squash \+ dz\)/.test(src)
    && /const r = Math\.hypot\(x, z\)/.test(src)
  ))());

  check('the silhouette has talus, shoulders, a neck and off-axis drift', (() => (
    /const base =/.test(src) && /const shoulder =/.test(src)
    && /const waist =/.test(src) && /const crag =/.test(src)
    && /const buttress =/.test(src) && /const driftEase =/.test(src)
  ))());

  check('a radius may never cross the axis', (() => (
    // Through zero, the two triangles sharing the vertex fold through each
    // other and the face renders with its winding — and its lighting —
    // inverted: a bright shard in the middle of a dark rock.
    /rs = Math\.max\(0\.35, rs\)/.test(src)
  ))());

  check('the whole range is one material and one draw call per mesh', (() => (
    /const peakMat = makeGraniteMaterial\(/.test(scn)
    && (scn.match(/makeGraniteMaterial\(/g) || []).length === 1
    && /new THREE\.InstancedMesh\(geo, peakMat, mine\.length\)/.test(scn)
  ))());

  check('all the stage-4 rock fits in eight draw calls', (() => {
    // Six instanced peak meshes and one ground mesh. The budget is the reason
    // the set is six rocks and not fourteen: an InstancedMesh draws one
    // geometry, so a unique silhouette costs a draw call and they have to be
    // spent where the eye is looking.
    const meshes = PEAK_MESHES.length;
    const ground = 1;
    return meshes + ground <= 8;
  })(), `${PEAK_MESHES.length} peak meshes + 1 ground`);
}

section('Stage 4 — the composition, against the locked camera');
{
  const placed = peakPlacements();
  const bands = cloudBands();
  const byBand = (b) => placed.filter((p) => p.band === b);

  check('three hero, five supporting, six distant', (() => (
    byBand('hero').length === 3 && byBand('supporting').length === 5
    && byBand('distant').length === 6 && placed.length === 14
  ))(), `${byBand('hero').length}/${byBand('supporting').length}/${byBand('distant').length}`);

  check('every peak lands in the frame, or deliberately off its edge', placed.every((p) => {
    const head = frameOf(p.summit);
    return !head.behind && head.u > -0.15 && head.u < 1.15;
  }));

  check('every summit clears the status bar and stays above the horizon',
    placed.every((p) => p.headV >= CAMERA.safeZone.top && p.headV < horizonV() - 0.08),
    `${Math.min(...placed.map((p) => p.headV)).toFixed(3)}..${Math.max(...placed.map((p) => p.headV)).toFixed(3)}`);

  check('the host is the tallest thing in the frame, and it stands on a third', (() => {
    // 主山: a range with no hierarchy is a texture. The host has to be the
    // dominant *frame* height — not the dominant world height, which the
    // distant band wins simply by being far away.
    const host = placed.find((p) => p.id === 'host');
    const frameHeight = (p) => p.footV - p.headV;
    return placed.every((p) => p === host || frameHeight(p) < frameHeight(host))
      && Math.abs(host.u - 1 / 3) < 0.05;
  })());

  check('no two instances share a rotation', (() => (
    new Set(placed.map((p) => p.yaw)).size === placed.length
    && new Set(placed.map((p) => p.tilt.join(','))).size === placed.length
  ))());

  check('every instance is tilted off plumb, but only slightly',
    placed.every((p) => p.tilt.every((t) => Math.abs(t) > 0.005 && Math.abs(t) < 0.06)));

  check('every scale is inside the authored 0.6 … 2.2', placed.every((p) => (
    p.unitScale >= SCALE_RANGE[0] && p.unitScale <= SCALE_RANGE[1]
  )), `${Math.min(...placed.map((p) => p.unitScale)).toFixed(2)}..${Math.max(...placed.map((p) => p.unitScale)).toFixed(2)}`);

  check('and the set really does vary in size', (() => {
    // Fourteen peaks all at 1.0 would be the picket fence with extra steps.
    const s = placed.map((p) => p.unitScale);
    return Math.max(...s) / Math.min(...s) > 2;
  })());

  check('instances of one mesh are never neighbours across the frame', (() => {
    // Two copies of the same rock side by side is the one arrangement where a
    // shared silhouette is unmissable, whatever the rotation.
    for (const mesh of PEAK_MESHES) {
      const us = placed.filter((p) => p.mesh.id === mesh.id).map((p) => p.u).sort((a, b) => a - b);
      for (let i = 1; i < us.length; i++) if (us[i] - us[i - 1] < 0.12) return false;
    }
    return true;
  })());

  check('every foot lands inside a cloud, and every summit stands clear of it',
    placed.every((p) => bands.some((b) => (
      p.footV > b.top && p.footV < b.bottom && p.headV < b.top
    ))), placed.filter((p) => !bands.some((b) => (
      p.footV > b.top && p.footV < b.bottom && p.headV < b.top
    ))).map((p) => p.id).join(', ') || 'all fourteen');

  check('the three heroes stand in the sea of cloud itself', (() => {
    // Not merely veiled by a deck: their feet are below the lowest layer and
    // their summits above the highest, and they stand inside the square the
    // four planes actually cover, so the rock genuinely passes through the sea.
    const heights = seatHeights();
    const eye = cameraBasis(FRAMINGS.world).pos;
    return byBand('hero').every((p) => (
      p.position[1] < Math.min(...heights)
      && p.summit[1] > Math.max(...heights)
      && Math.abs(p.position[0] - eye[0]) < PLANE / 2
      && Math.abs(p.position[2] - eye[2]) < PLANE / 2
    ));
  })());

  check('the reveal keeps a horizon at every realm', (() => {
    // progress.js floors peakFraction at 0.52, so the opening realm shows nine
    // of fourteen. Taken in table order those nine are the heroes and most of
    // the supporting band, and the skyline is simply absent — which reads as
    // unfinished rather than as unearned.
    const shown = Math.max(9, Math.round(placed.length * 0.52));
    const opening = placed.slice(0, shown);
    return opening.filter((p) => p.band === 'distant').length >= 3
      && opening.filter((p) => p.band === 'supporting').length >= 3
      && opening.filter((p) => p.band === 'hero').length === 3;
  })());

  check('and the lowest tier still draws a whole composition',
    TIERS.low.peaks >= 9 && TIERS.high.peaks === 14
    && Object.values(TIERS).every((t) => t.peaks <= 14 && t.spires === undefined));
}

section('Stage 4 — the ground, and the seam it covers');
{
  const field = terrainField();
  const src = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');

  check('the ground is a subdivided plane, displaced per vertex', (() => (
    /new THREE\.PlaneGeometry\(\s*TERRAIN\.width, TERRAIN\.depth, TERRAIN\.segX, TERRAIN\.segZ,?\s*\)/.test(src)
    && /terrainHeight\(x, z, field\)/.test(src)
    && TERRAIN.segX >= 64 && TERRAIN.segZ >= 32
  ))(), `${TERRAIN.segX}×${TERRAIN.segZ}`);

  check('it is laid down the way that keeps its faces pointing at the sky', (() => (
    // rotateX(-PI/2) preserves the winding; +PI/2 turns the whole valley
    // inside-out and back-face culling deletes it.
    /groundGeo\.rotateX\(-Math\.PI \/ 2\)/.test(src)
  ))());

  check('the far shore is a ridgeline, not a rule', (() => {
    // Sampled across the whole visible width: the crest has to *move*, or the
    // flat plane has simply been replaced by a flat plane with texture on it.
    const vs = crestSamples(field);
    const spread = Math.max(...vs) - Math.min(...vs);
    return spread > 0.02;
  })(), (() => {
    const vs = crestSamples(field);
    return `v ${Math.min(...vs).toFixed(3)}..${Math.max(...vs).toFixed(3)}`;
  })());

  check('and it stands above where the sea of cloud stops, in every column', (() => {
    // The whole point. A radial fade on a horizontal plane is a ring, and a
    // ring seen from 11° above projects to a horizontal line — the razor seam.
    // Nothing done to the sea can fix that; the land has to be in front of it.
    const seaEdge = cloudBands()[0].top;
    return crestSamples(field).every((v) => v < seaEdge - 0.02);
  })());

  check('the crest is nearer than the sea it hides the edge of', (() => {
    // Higher is not enough: land *behind* the fade would be seen through the
    // gap rather than covering it. Every crest sample has to be inside the
    // radius the sea is still drawn at.
    const eye = cameraBasis(FRAMINGS.world).pos;
    const far = Math.max(...LAYERS.map((L) => L.far[1]));
    for (let i = 0; i <= 12; i++) {
      const x = placeAtDepth(-0.05 + i * 0.09, 0.45, SHORE.z)[0];
      const d = Math.hypot(x - eye[0], SHORE.z - eye[2]);
      if (d > far) return false;
    }
    return true;
  })());

  check('the ground never rises through the meditation shelf', (() => {
    // The island is the one thing in the frame the player is standing on.
    for (let x = -40; x <= 40; x += 4) {
      for (let z = -40; z <= 10; z += 4) {
        if (Math.hypot(x, z) > 30) continue;
        if (terrainHeight(x, z, field) > -18) return false;
      }
    }
    return true;
  })());

  check('the tarn sits in a hollow the ground actually has', (() => {
    // Water is flat, so the one flat plane left in the scene is only safe while
    // the ground around it is higher than it on *every* side — walked here
    // rather than argued from the section, because a river along this valley
    // failed exactly that way: the downhill bank was under the surface and the
    // sheet ran out of its own bed.
    if (terrainHeight(TARN.x, TARN.z, field) > TARN.surface - 2) return false;
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = TARN.x + Math.cos(th) * TARN.rx * 1.5;
      const z = TARN.z + Math.sin(th) * TARN.rz * 1.5;
      if (terrainHeight(x, z, field) < TARN.surface + 1) return false;
    }
    return true;
  })());

  check('and it is offset in depth where it meets its own bed', (() => (
    // The one genuinely near-coplanar pair in the scene. At three hundred units
    // the depth buffer cannot separate them and the surface tears into shards.
    /polygonOffset = true/.test(src) && /polygonOffsetFactor = -2/.test(src)
  ))());

  check('the mist bands can no longer walk their own edge into frame', (() => {
    // The floating white polygon of the sunset build: a band 2.2 frames wide
    // wrapping at ±90 world units, so its faded corner crossed the picture.
    // The limit is derived from the band now, not authored.
    return /const width = frameWidth \* 4/.test(src)
      && /band\.userData\.drift = Math\.max\(0, width \* 0\.5 - width \* 0\.14 - frameWidth \* 0\.68\)/.test(src)
      && !/if \(b\.position\.x > limit\)/.test(src);
  })());

  check('the four new modules are in the service worker shell', (() => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    return ['noise', 'peaks', 'peak-plan', 'terrain-plan']
      .every((m) => sw.includes(`'./js/view3d/${m}.js'`));
  })());
}

section('Stage 4 — how the granite is lit');
{
  const src = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
  const granite = src.slice(src.indexOf('export function makeGraniteMaterial'));

  check('it is a flat-shaded standard material, opaque, roughness 0.9, metal 0',
    /new THREE\.MeshStandardMaterial\(/.test(granite)
    && /roughness: 0\.9/.test(granite) && /metalness: 0/.test(granite)
    && /flatShading: true/.test(granite)
    && /transparent: false/.test(granite) && /opacity: 1/.test(granite));

  check('it opts out of the tone curve and of scene.fog, like the sea does',
    /toneMapped: false/.test(granite) && /fog: false/.test(granite));

  check('the air it takes is the one air, capped per rank', (() => (
    /uFogColor: env\.uFogColor/.test(granite) && /uFogDensity: env\.uFogDensity/.test(granite)
    && /applyFogCapped\(lit, vViewPosition\.z, cap, vWorldY\)/.test(granite)
    && /attribute float aFogCap/.test(granite)
  ))());

  check('the three ranks are still wired to the derived aerial tiers', (() => {
    const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');
    return /const ink = p\.peaks/.test(scn) && /setColorAt/.test(scn)
      && scn.includes('fogCap: 0.22') && scn.includes('fogCap: 0.60');
  })());

  check('the hot edge is the sun\'s, and it is gated on facing the sun', (() => (
    /uLightColor \* edge \* smoothstep\(-0\.10, 0\.55, sun\) \* uSunEdge/.test(granite)
  ))());

  check('nothing out there wears the accent', (() => (
    // uRimColor is the player's own qi. A background element carrying it makes
    // her light ordinary, and the range is the largest background element there
    // is. The old rock shader added a trace of it; this one adds none.
    !/uRimColor/.test(granite)
  ))());

  check('the Lambert divisor is undone, so the range is on the same ladder', (() => (
    // BRDF_Lambert divides by pi. Every colour in this renderer was authored
    // against shading that does not, so without this the peaks come out three
    // times darker than the palette says they are.
    /gain = Math\.PI/.test(granite) && /outgoingLight \* uGain/.test(granite)
  ))());

  check('the karst vertex-shader profile is gone with the range it carved',
    !/karstProfile/.test(src) && !/makeRockMaterial/.test(src));
}

section('Stage 5 — the platform, and the symmetry it has to not have');
{
  const src = readFileSync(new URL('../js/view3d/platform-plan.js', import.meta.url), 'utf8');
  const wrl = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');
  const rock = readFileSync(new URL('../js/view3d/rock.js', import.meta.url), 'utf8');
  const plan = platformOutline();

  const regular = (n, r = 10) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });

  check('it is a hand-authored Shape extruded with a bevel, not a cylinder', (() => (
    /new THREE\.Shape\(/.test(rock) && /new THREE\.ExtrudeGeometry\(/.test(rock)
    && /bevelEnabled: true/.test(rock)
    // The shelf and its apron were the last two CylinderGeometry in world.js.
    && !/new THREE\.CylinderGeometry\(/.test(wrl)
  ))());

  check('~11 points, and no two the same radius', (() => {
    const rs = plan.map(([x, z]) => Math.hypot(x, z));
    return plan.length >= 10 && plan.length <= 12
      && new Set(rs.map((r) => r.toFixed(3))).size === rs.length;
  })(), `${plan.length} points`);

  check('no two angular gaps are the same either', (() => {
    // Equal gaps are half of what makes a polygon regular; equal *radii* are
    // the other half, and either one on its own is enough for the eye.
    const a = plan.map(([x, z]) => Math.atan2(z, x)).sort((p, q) => p - q);
    const gaps = a.map((v, i) => {
      let d = a[(i + 1) % a.length] - v;
      if (d <= 0) d += Math.PI * 2;
      return d.toFixed(3);
    });
    return new Set(gaps).size === gaps.length;
  })());

  check('the scorer reads zero on every regular polygon, and on an ellipse', (() => {
    const ellipse = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [Math.cos(a) * 12, Math.sin(a) * 8];
    });
    return [3, 5, 7, 9, 11, 16, 64].every((n) => symmetryScore(regular(n)) < 1e-6)
      && symmetryScore(ellipse) < 1e-6;
  })());

  check('the platform silhouette has no detectable regular symmetry',
    symmetryScore(plan) > 0.04, symmetryScore(plan).toFixed(4));

  check('nor does the meditation stone it sits inside',
    symmetryScore(stoneOutline()) > 0.04, symmetryScore(stoneOutline()).toFixed(4));

  check('the irregularity is where the camera can see it', (() => {
    // Only the arc from about 190° to 290° is ever on screen. Points spread
    // evenly put two of them in there and a straight line between, which is a
    // lively plan that renders as a smooth curve.
    const seen = plan.filter(([x, z]) => {
      const f = frameOf([x, topRelief(x, z), z]);
      return !f.behind && f.u > -0.05 && f.u < 1.15;
    });
    return seen.length >= 5;
  })());

  check('the rim relief, not the radii, is what breaks the silhouette', (() => {
    // Measured on the real projection: the eye is 2.03 units above a slab
    // twenty-one across, so swinging a radius barely moves the edge. Height
    // does. Both are sampled here and the flat version has to come out flat.
    const span = (lift) => {
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < plan.length; i++) {
        const [ax, az] = plan[i];
        const [bx, bz] = plan[(i + 1) % plan.length];
        for (let t = 0; t < 1; t += 0.05) {
          const x = ax + (bx - ax) * t;
          const z = az + (bz - az) * t;
          const f = frameOf([x, lift ? topRelief(x, z) : 0, z]);
          if (f.behind || f.u < 0 || f.u > 1 || f.v > 0.65) continue;
          lo = Math.min(lo, f.v);
          hi = Math.max(hi, f.v);
        }
      }
      return hi - lo;
    };
    return span(false) < 0.02 && span(true) > 0.035;
  })());

  check('the chipping is a pure function of position', (() => (
    // ExtrudeGeometry is not indexed, so a shared vertex is stored two or three
    // times. Jitter from a counter gives the copies different answers and the
    // cap tears open; a hash of the position gives them the same one.
    /function chipAt\(x, z, k\)/.test(rock) && /Math\.sin\(x \* 127\.1 \+ z \* 311\.7/.test(rock)
  ))());

  check('the top-face chip is the brief\'s ±0.05', PLATFORM.chip === 0.05);

  check('the underside is darker than the top, and it is in the geometry', (() => (
    // A per-vertex albedo multiplier, because the hemisphere term cannot
    // separate the underside of an overhang from the wall beside it.
    /export function applyTint/.test(rock)
    && /tint: \{ top: 1\.15, bottom: 0\.52/.test(wrl)
    && /attribute float aTint/.test(readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8'))
  ))());

  check('the island is one mesh, and so is its dressing', (() => (
    // Two meshes on one material is two draw calls. Stage 5 adds four objects
    // to a frame that was already at 87 of a budget of 90.
    /mergeGeometries\(\[\s*slabGeometry/.test(wrl)
    && /mergeGeometries\(\[stepsGeometry\(STEPS\), censerGeo\]\)/.test(wrl)
  ))());
}

section('Stage 5 — the seat, and where ExtrudeGeometry actually puts its bevel');
{
  const rock = readFileSync(new URL('../js/view3d/rock.js', import.meta.url), 'utf8');
  const wrl = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');

  // The one fact in this stage that belongs to three rather than to us, driven
  // against the real vendored library: get it wrong and nothing throws, the
  // island just floats a third of a unit above where every other module
  // believes it is.
  const slabExtent = (depth, bevelThickness) => {
    const shape = new THREE.Shape([[10, 0], [0, 10], [-10, 0], [0, -10]]
      .map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: 1,
      steps: 1,
      bevelEnabled: true,
      bevelThickness,
      bevelSize: 0.4,
      bevelOffset: 0,
      bevelSegments: 2,
    });
    g.rotateX(Math.PI / 2);
    g.translate(0, -bevelThickness, 0);
    g.computeBoundingBox();
    return g.boundingBox;
  };

  check('the bevel is added OUTSIDE depth, at both ends', (() => {
    // Not "cut inside it", which is what this file used to claim. A slab asked
    // for depth 3.5 with a 0.30 bevel comes back 4.1 deep.
    const shape = new THREE.Shape([[10, 0], [0, 10], [-10, 0], [0, -10]]
      .map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 3.5,
      curveSegments: 1,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.4,
      bevelOffset: 0,
      bevelSegments: 2,
    });
    g.computeBoundingBox();
    return near(g.boundingBox.min.z, -0.3) && near(g.boundingBox.max.z, 3.8);
  })());

  check('so a slab has to be pushed down by its own bevel to sit on its origin',
    [[PLATFORM.depth, PLATFORM.bevel.thickness], [STONE.depth, STONE.bevel.thickness]]
      .every(([d, bt]) => {
        const box = slabExtent(d, bt);
        return near(box.max.y, 0) && near(box.min.y, -(d + 2 * bt));
      }));

  check('and slabGeometry does exactly that', /geo\.translate\(0, -bevel\.thickness, 0\)/.test(rock));

  check('the cultivator sits on rock rather than inside it', (() => {
    // characterAnchor is [0, 0, 0] and the avatar's own lowest vertex is its
    // y = 0, so anything authored above SEAT where she sits is a figure that
    // reads short. It measured 10.2% of frame height against a contract of
    // 13.5% while the stone's top face was at +0.42.
    const anchor = CAMERA.composition.characterAnchor;
    return ISLAND_SEAT === anchor[1]
      && surfaceAt(anchor[0], anchor[2]) < ISLAND_SEAT
      && /stone\.position\.y = SEAT/.test(wrl);
  })());

  check('the stone stands proud of the platform, and the platform hangs off it', (() => {
    // Under *her* — the rim is allowed to stand higher than the seat, and does:
    // the relief swings +0.38 out at the edge, which is a broken terrace rather
    // than a table. What may not happen is rock above the seat where she is,
    // and the relief is faded to nothing inside r/R < 0.34 for exactly that.
    const seated = [[0, 0], [1.5, 1.5], [-2, 1], [2, -2]]
      .every(([x, z]) => surfaceAt(x, z) < ISLAND_SEAT);
    return STONE_PROUD > 0.1 && STONE_PROUD < 0.4
      && near(PLATFORM.top, ISLAND_SEAT - STONE_PROUD)
      && seated;
  })());

  check('there is still rock to see between the rim and her feet', (() => {
    // Every unit the stone stands proud is a unit the whole platform drops, and
    // the strip closes entirely at about −0.60.
    const feet = frameOf(CAMERA.composition.characterAnchor).v;
    const plan = platformOutline();
    let rim = 0;
    for (let i = 0; i < plan.length; i++) {
      const [ax, az] = plan[i];
      const [bx, bz] = plan[(i + 1) % plan.length];
      for (let t = 0; t < 1; t += 0.04) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const f = frameOf([x, surfaceAt(x, z), z]);
        if (f.behind || f.u < 0 || f.u > 1 || f.v > 0.68) continue;
        rim = Math.max(rim, f.v);
      }
    }
    return feet - rim > 0.02;
  })());

  check('nothing on the island seats itself any other way', (() => (
    // Four different answers to "what am I standing on" is how three of the
    // four ended up underground. surfaceAt() is the only one now.
    /censerAt = \[CENSER\.at\[0\], surfaceAt\(/.test(wrl)
    && /v\.set\(x, surfaceAt\(x, z\) \+ h - 0\.35, z\)/.test(wrl)
    && /plumSeat\(\)/.test(readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8'))
  ))());
}

section('Stage 5 — the set dressing, against the locked camera');
{
  const plan = platformOutline();
  // The outline's reach at a bearing, so a tread can be checked for overhang.
  const outlineAt = (x, z) => {
    const a = Math.atan2(z, x);
    const pts = plan
      .map(([px, pz]) => ({ a: Math.atan2(pz, px), r: Math.hypot(px, pz) }))
      .sort((p, q) => p.a - q.a);
    let hi = pts.findIndex((p) => p.a >= a);
    if (hi < 0) hi = 0;
    const lo = (hi - 1 + pts.length) % pts.length;
    let da = pts[hi].a - pts[lo].a;
    if (da <= 0) da += Math.PI * 2;
    let t = a - pts[lo].a;
    if (t < 0) t += Math.PI * 2;
    return pts[lo].r + (pts[hi].r - pts[lo].r) * (t / da);
  };

  /** A tread's top, in world space — the same arithmetic props.js builds it at. */
  const treadAt = (s) => [s.at[0], stepTop(s), s.at[1]];

  check('no tread overhangs the rock it is cut into', STEPS.every((s) => (
    Math.hypot(s.at[0], s.at[1]) + Math.max(s.w, s.d) / 2 < outlineAt(s.at[0], s.at[1]) - 0.4
  )));

  check('the flight is a stair: every tread stands on the rock, by a descending amount', (() => (
    // The invariant that catches the bug that was here. Four of six treads were
    // *below their own surface* — a flight of steps buried in the rock it is
    // cut into — because they were authored as absolute world heights against a
    // platform whose real top was 0.30 higher than the code believed.
    STEPS.every((s) => s.proud > 0.05)
    && STEPS.every((s, i) => i === 0 || s.proud < STEPS[i - 1].proud)
    && STEPS.every((s) => stepTop(s) > surfaceAt(s.at[0], s.at[1]))
  ))());

  check('and it climbs the shoulder before it drops away', (() => {
    // Not a monotone descent in world y, and it should not be: the rim relief
    // swings +-0.42 under the path, so it goes up over the high point at 260°
    // and down the far side. What descends is its height above the rock.
    const v = STEPS.map((s) => frameOf(treadAt(s)).v);
    return v[0] > v[2] && v[5] > v[2];
  })());

  check('every tread stays seated whatever the relief does under it', STEPS.every((s) => (
    // `h` is the depth of the prism, and the rim relief swings ±0.42 — a tread
    // whose base clears the surface is a slab floating over a hole.
    stepTop(s) - s.h < surfaceAt(s.at[0], s.at[1]) - 0.4
  )));

  check('and it leads off the frame', (() => {
    const us = STEPS.map((s) => frameOf(treadAt(s)).u);
    // It starts clear of the cultivator at u 0.44 and the last tread is past
    // the edge of the picture — that is the whole point of it being there.
    return Math.min(...us) > 0.55 && Math.max(...us) > 1.05;
  })());

  check('most of it notches the platform\'s own skyline', (() => {
    // Nothing below the top plane and beyond the rim can be seen from this
    // camera, so the only reading a path gets at this scale is as a break in
    // the silhouette. Measured against the rim at each tread's own bearing.
    const breaks = STEPS.filter((s) => {
      const a = Math.atan2(s.at[1], s.at[0]);
      const R = outlineAt(s.at[0], s.at[1]);
      const rx = Math.cos(a) * R;
      const rz = Math.sin(a) * R;
      return frameOf(treadAt(s)).v <= frameOf([rx, surfaceAt(rx, rz), rz]).v + 1e-4;
    });
    return breaks.length >= 4;
  })(), `${STEPS.length} treads`);

  check('the censer stands on the platform, clear of the figure and of the UI', (() => {
    const f = frameOf([CENSER.at[0], surfaceAt(CENSER.at[0], CENSER.at[1]), CENSER.at[1]]);
    const anchor = CAMERA.composition.anchorU;
    return Math.hypot(CENSER.at[0], CENSER.at[1]) < outlineAt(CENSER.at[0], CENSER.at[1]) - 1
      && f.u > anchor + 0.2 && f.u < 1
      && f.v > CAMERA.safeZone.top && f.v < 1 - CAMERA.safeZone.bottom;
  })());

  check('and it stands *on* it — the whole vessel is above the rock', (() => {
    // Its base used to be seated on bare `topRelief`, which is a lift and not a
    // height, so the bottom 0.30 of a 0.62-tall burner was underground.
    const base = surfaceAt(CENSER.at[0], CENSER.at[1]);
    return base < ISLAND_SEAT && CENSER.height > 0.3 && near(base, PLATFORM.top);
  })());

  check('its smoke rises into open sky above the near band', (() => {
    const base = surfaceAt(CENSER.at[0], CENSER.at[1]);
    const top = frameOf([
      CENSER.at[0] + SMOKE.lean[0], base + CENSER.height + SMOKE.height,
      CENSER.at[1] + SMOKE.lean[1],
    ]);
    return top.v < horizonV() && top.u > 0 && top.u < 1;
  })());

  check('the plum grows out of the rock, not through it', (() => {
    // Its root flare dips just under the surface and the trunk starts on it.
    // The old seat was a hand-tuned −0.05 against a platform whose real top was
    // 0.30 higher, so all four root stubs were buried.
    const seat = plumSeat();
    return near(seat[1], surfaceAt(PLUM.at[0], PLUM.at[1]))
      && Math.hypot(seat[0], seat[2]) < outlineAt(seat[0], seat[2]) - 0.6;
  })());
}

section('Stage 5 — 梅, and the end of the leafless tree');
{
  const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');
  const plumSrc = readFileSync(new URL('../js/view3d/plum-plan.js', import.meta.url), 'utf8');
  const tree = plumSkeleton();

  check('the recursive branch function is gone', (() => (
    // It was a self-similar fan of thinning twigs, which is an oak in February.
    // Nothing in the renderer may grow a tree by recursion any more.
    !/function plumBranches/.test(scn) && !/plumBranches\(/.test(scn)
    && !/grow\(to, child/.test(plumSrc)
  ))());

  check('nothing in the foreground is ever bare', (() => {
    // The old floor was 0.06 — nine flowers on a thirty-seven-segment tree,
    // which is a *bare deciduous tree* and shipped in every first screenshot.
    const T = TIERS.medium;
    return [0, 1, 2, 3].every((stage) => {
      const st = defaultState();
      st.stage = stage;
      return sceneryProgress(viewModel(st), T).blossom >= 0.25;
    });
  })());

  check('the trunk is a chain of 4–6 tapered lengths',
    tree.trunkDirs.length >= 4 && tree.trunkDirs.length <= 6, `${tree.trunkDirs.length}`);

  check('every joint is an angular change of direction, never a curve', (() => {
    // Under about fifteen degrees the chain reads as one slightly bent pole and
    // the segment boundaries become a subdivision artefact rather than the
    // point of the shape.
    const turns = tree.trunkDirs.slice(1).map((d, i) => turnBetween(tree.trunkDirs[i], d));
    return turns.every((t) => t > 0.26) && turns.length >= 3;
  })(), tree.trunkDirs.slice(1)
    .map((d, i) => ((turnBetween(tree.trunkDirs[i], d) * 180) / Math.PI).toFixed(0)).join('° '));

  check('3–4 mains, each with 2–3 subs, and it thins aggressively', (() => {
    const full = plumSkeleton({ subs: 3 });
    const lean = plumSkeleton({ subs: 2 });
    const radii = full.segments.map((s) => s.r0);
    return full.tips.length >= 12 && full.tips.length <= 20
      && lean.tips.length < full.tips.length
      // The thinnest twig is under a tenth of the trunk it left.
      && Math.min(...radii) < Math.max(...radii) * 0.1;
  })(), `${plumSkeleton().tips.length} tips`);

  check('the blossom is a lit surface, not a fresnel shell', (() => {
    // A glow material is brightest at the silhouette and empty in the middle,
    // so a disc facing the camera renders as a *ring*. Two hundred tiny rings
    // is not blossom.
    const sh = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
    return /export function makeBlossomMaterial/.test(sh)
      && /roughness = 0\.7/.test(sh) && /emissive/.test(sh)
      && /makeBlossomMaterial\(env, \{ color: '#f5d0dc'/.test(scn)
      && !/makeGlowMaterial/.test(scn);
  })());

  check('flowers run #f5d0dc to near-white, and cluster at the tips',
    /nearWhite = new THREE\.Color\('#fff2f4'\)/.test(scn)
    && /setColorAt\(i, tmpColor\.copy\(petalPink\)\.lerp\(nearWhite/.test(scn)
    && /const tip = tips\[i % tips\.length\]/.test(scn));

  check('the bark is near-black, taken there from the one place', (() => (
    /BARK_SINK/.test(scn) && /multiplyScalar\(BARK_SINK\)/.test(scn)
  ))());
}

section('Stage 5 — the framing branch');
{
  const branch = framingBranch();
  const box = (() => {
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const s of branch.segments) {
      for (const p of [s.from, s.to]) {
        const f = frameOf(p);
        if (f.behind) continue;
        u0 = Math.min(u0, f.u); u1 = Math.max(u1, f.u);
        v0 = Math.min(v0, f.v); v1 = Math.max(v1, f.v);
      }
    }
    return { u0, u1, v0, v1 };
  })();
  const clipped = {
    u0: Math.max(0, box.u0), u1: Math.min(1, box.u1),
    v0: Math.max(0, box.v0), v1: Math.min(1, box.v1),
  };
  const area = (clipped.u1 - clipped.u0) * (clipped.v1 - clipped.v0);

  check('it occupies roughly the top-right fifth of the frame',
    area > 0.15 && area < 0.26, `${(area * 100).toFixed(1)}%`);

  check('and it is in the top right, not somewhere else that is 20%',
    clipped.u1 > 0.98 && clipped.u0 > 0.5 && clipped.v0 < 0.02 && clipped.v1 < horizonV());

  check('it is partially out of frame, on two edges', box.u1 > 1.05 && box.v0 < -0.05,
    `u→${box.u1.toFixed(2)} v→${box.v0.toFixed(2)}`);

  check('it is *near*, which is what makes it large', (() => {
    // Authored in world coordinates it was retuned four times and still only
    // covered nine percent, because a limb hanging two and a half units at a
    // depth of six moves eight percent down the picture. The fix is depth: the
    // eye is at z = 12.2, so a root at z = +4 is where a world unit is a ninth
    // of the frame's height instead of a twentieth.
    const eye = cameraBasis().pos;
    const near = Math.min(...branch.segments.map((s) => (
      Math.hypot(s.from[0] - eye[0], s.from[1] - eye[1], s.from[2] - eye[2])
    )));
    return near < 12 && unitsPerFrame(branch.segments[0].from[2]) < 10;
  })());

  check('it is in front of every peak in the range', (() => {
    const eye = cameraBasis().pos;
    const branchDepth = Math.max(...branch.segments.map((s) => -(s.to[2] - eye[2])));
    return peakPlacements().every((p) => -(p.position[2] - eye[2]) > branchDepth);
  })());

  check('it thins from root to tip and never gets thicker', (() => {
    const spine = branch.segments.slice(0, 6);
    return spine.every((s, i) => i === 0 || s.r0 <= spine[i - 1].r0);
  })());

  check('every limb zigzags across the frame as well as down it', (() => {
    // Written as three limbs hanging straight down they came out as parallel
    // vertical bars of even width, which is a gantry, and no amount of taper
    // rescues the shape of a gantry.
    const drops = branch.segments.slice(6);
    const across = drops.map((s) => Math.abs(frameOf(s.to).u - frameOf(s.from).u));
    return across.filter((d) => d > 0.03).length >= drops.length * 0.6;
  })());

  check('the tree and the branch share one mesh and one material', (() => {
    const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');
    return /const parts = treeParts\.concat\(frameParts\)/.test(scn)
      && /new THREE\.InstancedMesh\(branchGeo, barkMat, parts\.length\)/.test(scn);
  })());
}

section('Stage 5 — the near band is the bottom of the value ladder');
{
  const wrl = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');
  const scn = readFileSync(new URL('../js/view3d/scenery.js', import.meta.url), 'utf8');

  check('the foreground is cut from the realm\'s ink, never from `ground`', (() => (
    /groundMat\.uniforms\.uColor\.value\.copy\(cur\.fore\)/.test(wrl)
    && /foregroundInk\(p\.ink\)/.test(wrl)
  ))());

  check('it is darker than the ink the range is carved from, in every realm',
    PALETTES.every((p) => luminance(foregroundInk(p.ink)) < luminance(p.ink) * 0.6));

  check('and darker than the nearest rank of peaks under every sky', (() => (
    PALETTES.every((p) => TIMES.every((t) => {
      const near = aerialTiers(p.ink, t.horizon)[0];
      return luminance(foregroundInk(p.ink)) < luminance(near);
    }))
  ))());

  check('the loose rock on it is lighter, so it does not vanish into it',
    PALETTES.every((p) => (
      luminance(foregroundInk(p.ink, 0.32)) > luminance(foregroundInk(p.ink)) * 1.15
    )));

  check('the rim term is a trace, because on near-black albedo it is additive', (() => (
    // At 0.08 it was not a trace: `pow(1 - dot(n, v), 4)` runs at 0.55 over a
    // top seen from eight degrees above, and the grayscale sheet put the
    // platform at 82 against a midground of 67 — the nearest rock in the frame
    // lighter than the range behind it, arriving through a term with nothing to
    // do with the palette.
    /rim: 0\.02, bands: 3, flat: true, tint: true/.test(wrl)
  ))());

  check('the platform is flat shaded, or the rim relief does nothing', (() => (
    // The top is nine large triangles between the outline points, each tipped a
    // different way. Smooth-shaded they average into one even grey.
    /const groundMat = makeInkMaterial\(env, \{[^}]*flat: true/.test(wrl)
  ))());

  check('no cone survives in the foreground or the range', (() => (
    // The pines were five stacked ConeGeometry skirts, which is a fir, which is
    // a Christmas card — and they are the only man-height thing in the
    // midground, so the eye sizes the whole landform off whatever they are.
    !/new THREE\.ConeGeometry\(/.test(wrl) && !/new THREE\.ConeGeometry\(/.test(scn)
  ))());

  check('a pine is layered horizontal plates with sky between them', (() => {
    const src = readFileSync(new URL('../js/view3d/trees.js', import.meta.url), 'utf8');
    return /const PLATES = \[/.test(src) && (src.match(/\{ y: /g) || []).length >= 3
      && /the lit top of the plate/.test(src) && /shaded underside/.test(src);
  })());
}

section('Stage 6 — the garment, and the cone it replaces');
{
  // A phone, in CSS pixels. Everything in this section that claims to be
  // legible is measured in these — "0.09 world units" is not a fact about a
  // picture, and the whole gate for this stage is what survives being 13% of a
  // 414×896 frame.
  const W = 414;
  const H = 896;
  const pxBetween = (framing, a, b) => {
    const fa = frameOf(a, { framing });
    const fb = frameOf(b, { framing });
    return Math.hypot((fa.u - fb.u) * W, (fa.v - fb.v) * H);
  };
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const preset = (id) => CAMERA.debugPresets.find((p) => p.id === id).framing;
  const avatar = readFileSync(new URL('../js/view3d/avatar.js', import.meta.url), 'utf8');

  check('she is not one lathe with two rings round her any more', (() => (
    // The old figure: LatheGeometry hem-to-collar, a TorusGeometry collar and a
    // TorusGeometry sash. The tori stayed — a sash *is* a band — but the body
    // is built from the plan now, and nothing in here lathes a profile.
    !/new THREE\.LatheGeometry/.test(avatar)
    && /figure-plan\.js/.test(avatar) && /garment\.js/.test(avatar)
    && /pleatedSkirtGeometry/.test(avatar) && /collarPanelGeometry/.test(avatar)
  ))());

  check('the garment welds down into a handful of draw calls', (() => (
    // Ten separate primitives on four materials would be ten calls. The robe,
    // the trim, the inner collar and the tails are four.
    /mergeGeometries\(robeParts\)/.test(avatar) && /mergeGeometries\(trimParts\)/.test(avatar)
    && /mergeGeometries\(innerParts\)/.test(avatar)
  ))());

  /* ------------------------------------------------------------ 裳 pleats */

  check('10–14 pleats, strictly alternating ridge and valley', (() => {
    const segs = pleatSegments();
    if (PLEATS.count < 10 || PLEATS.count > 14) return false;
    if (segs.length !== PLEATS.count * 2) return false;
    return segs.every((s, i) => s.ridge === (i % 2 === 0))
      && segs.every((s) => (s.ridge ? s.scale > 0.96 : s.scale < 0.9));
  })(), `${PLEATS.count} pleats`);

  check('a fold is deep enough to catch light on one side and not the other', (() => {
    // The whole point of a pleat at this scale is that the ridge and the valley
    // take different steps off the toon ramp. Eight centimetres at a hem radius
    // of half a unit is a facet turned ~17° from its neighbour, which is more
    // than one band of a four-band ramp.
    const drop = bodyRadius(FIGURE.hem) * (1 - PLEATS.valley);
    return drop > 0.05 && drop < 0.13;
  })(), `${(bodyRadius(FIGURE.hem) * (1 - PLEATS.valley)).toFixed(3)} world units`);

  check('the pleats are individually distinguishable at the two near cameras', (() => {
    // Measured where it counts: ridge to ridge, across the face of the skirt,
    // for the folds actually turned toward the lens. Near the silhouette every
    // lathe compresses to nothing, so the edge is not the test.
    const spacing = (id) => {
      const framing = preset(id);
      const eye = cameraBasis(framing).pos;
      const y = (FIGURE.hem + FIGURE.waist) / 2;
      const r = bodyRadius(y);
      const at = (a) => [Math.sin(a) * r, y, Math.cos(a) * r];
      const segs = pleatSegments();
      const gaps = [];
      for (let i = 0; i < segs.length; i += 2) {
        const p0 = at(segs[i].angle);
        const n = [Math.sin(segs[i].angle), Math.cos(segs[i].angle)];
        const to = [eye[0] - p0[0], eye[2] - p0[2]];
        const len = Math.hypot(to[0], to[1]) || 1;
        if ((n[0] * to[0] + n[1] * to[1]) / len < 0.55) continue;
        gaps.push(pxBetween(framing, p0, at(segs[(i + 2) % segs.length].angle)));
      }
      return median(gaps);
    };
    return spacing('hero') > 12 && spacing('close') > 30;
  })());

  check('the hem is neither level nor periodic', (() => {
    // Level is a lampshade. Periodic is worse: a wobble that comes back into
    // phase with the pleats is a wobble the eye reads as part of the fluting,
    // and the whole skirt goes back to being a solid of revolution.
    const ys = hemOutline().map((p) => p[1]);
    const range = Math.max(...ys) - Math.min(...ys);
    const distinct = new Set(ys.map((y) => y.toFixed(4))).size;
    // Every rotation of the sequence, compared with itself. A hem that repeats
    // every k segments scores ~0 at that lag.
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    let closest = Infinity;
    for (let lag = 1; lag < ys.length; lag++) {
      let sum = 0;
      for (let i = 0; i < ys.length; i++) {
        const d = ys[i] - ys[(i + lag) % ys.length];
        sum += d * d;
      }
      closest = Math.min(closest, Math.sqrt(sum / ys.length) / (Math.max(...ys) - mean));
    }
    return range > 0.06 && distinct >= 20 && closest > 0.35;
  })());

  check('but the pleats themselves do repeat, which is the difference', (() => {
    // The platform may have no symmetry the eye can find; a pleated skirt must
    // have one. Cloth folded by a person repeats — that is what makes it read
    // as folded rather than as eroded.
    const scale = pleatSegments().map((s) => s.scale);
    let worst = 0;
    for (let i = 0; i < scale.length; i++) {
      worst = Math.max(worst, Math.abs(scale[i] - scale[(i + 2) % scale.length]));
    }
    return worst < 0.12;
  })());

  check('nothing the stage authored is below the rock she sits on', (() => {
    // The seat is measured, not chosen — see the header of figure-plan.js. A
    // trim band, a cuff or a tail placed under it is a feature that does not
    // exist in any shipped frame.
    const hemLow = Math.min(...hemOutline().map((p) => p[1]));
    return hemLow > FIGURE.seat - PLEATS.hemWobble - 1e-6
      && cuffs().every((c) => c.at[1] > FIGURE.seat)
      && sashTails().every((t) => t.points[t.points.length - 1][1] > FIGURE.seat);
  })(), `hem ${Math.min(...hemOutline().map((p) => p[1])).toFixed(3)} vs seat ${FIGURE.seat}`);

  check('the trim band at the hem follows the hem, and stands proud of the cloth', (() => {
    const garment = readFileSync(new URL('../js/view3d/garment.js', import.meta.url), 'utf8');
    return /hemBandGeometry/.test(garment) && /s\.hem/.test(garment)
      && PLEATS.trim.lift > 0 && PLEATS.trim.height > 0.05;
  })());

  check('the robe is graded darker toward the hem in vertex colour', (() => {
    const garment = readFileSync(new URL('../js/view3d/garment.js', import.meta.url), 'utf8');
    // Cheap fake AO: every point round a ring has the same normal at the same
    // height, so no light in the rig can separate the pooled hem from the waist.
    return /export function gradeToHem/.test(garment) && /applyTint/.test(garment)
      && /gradeToHem\(/.test(avatar) && /tint: true/.test(avatar);
  })());

  /* ----------------------------------------------------- 交领右衽 the collar */

  check('there is a crossed collar, and the left panel is over the right', (() => {
    const panels = collarPanels();
    const by = Object.fromEntries(panels.map((p) => [p.id, p]));
    if (!by.left || !by.right || !by.inner) return false;
    // 右衽. The layering is the radial standoff and nothing else — no
    // renderOrder, no polygonOffset, so it is right from every camera.
    return by.left.lift > by.right.lift && by.right.lift > by.inner.lift;
  })());

  check('both panels cross the centre line, which is what makes it a V', (() => {
    const mid = (panel) => panel.rows.map(([a, b]) => (a[0] + b[0]) / 2);
    const panels = collarPanels();
    const left = mid(panels.find((p) => p.id === 'left'));
    const right = mid(panels.find((p) => p.id === 'right'));
    // Left starts on her left and ends past centre on her right; right mirrors
    // it. Two lines that both stop at x = 0 are a chevron, not a crossing.
    return left[0] > 0.08 && left[left.length - 1] < -0.08
      && right[0] < -0.08 && right[right.length - 1] > 0.08;
  })());

  check('it runs from the neck to below the sternum', (() => {
    const ys = collarPanels().flatMap((p) => p.rows.flat().map((q) => q[1]));
    return Math.max(...ys) > FIGURE.collar - 0.02 && Math.min(...ys) < 0.90
      && Math.min(...ys) > FIGURE.waist;
  })());

  check('the inner robe shows above the outer collar, in a second tone', (() => {
    const panels = collarPanels();
    const inner = panels.find((p) => p.id === 'inner');
    const outerTop = Math.max(...panels.filter((p) => p.id !== 'inner')
      .flatMap((p) => p.rows.flat().map((q) => q[1])));
    return inner.tone === 'inner'
      && Math.max(...inner.rows.flat().map((q) => q[1])) > outerTop
      && /innerMat/.test(avatar) && /lerp\(WHITE/.test(avatar);
  })());

  check('every collar panel lies on the body, not near it', (() => (
    // Wrapped onto `bodyRadius` by construction, so a retune of the profile
    // cannot leave the collar floating in front of the chest.
    collarPanels().every((panel) => panel.rows.flat().every((p) => {
      const r = Math.hypot(p[0], p[2]);
      return Math.abs(r - (bodyRadius(p[1]) + panel.lift)) < 0.02;
    }))
  ))());

  check('the collar is legible at 100% on a 414×896 phone', (() => {
    // The gate for this stage, as a number. A light band on dark cloth needs
    // about five pixels before it stops being a shape and becomes an edge
    // artefact; the outer panels carry the read and the inner one is an accent
    // inside it.
    const width = (id, panelId) => {
      const framing = preset(id);
      const panel = collarPanels().find((p) => p.id === panelId);
      return median(panel.rows.map(([a, b]) => pxBetween(framing, a, b)));
    };
    return width('hero', 'right') > 5 && width('hero', 'left') > 5
      && width('close', 'right') > 12 && width('close', 'left') > 12
      && width('profile', 'left') > 5 && width('hero', 'inner') > 2.5;
  })(), `hero ${median(collarPanels().find((p) => p.id === 'left').rows
    .map(([a, b]) => pxBetween(preset('hero'), a, b))).toFixed(1)} px`);

  /* --------------------------------------------------------- 广袖 sleeves */

  check('the arms are outside the body they hang off', (() => (
    // They used to be capsules at x = ±0.29 with a radius of 0.10 inside a robe
    // whose radius at the same height was 0.46 — not hidden by the sleeves,
    // *inside the body*. The figure had no arms in any shipped frame.
    ARMS.every((arm) => (
      Math.hypot(arm.elbow[0], arm.elbow[2]) + arm.upper[1] > bodyRadius(arm.elbow[1])
    ))
  ))());

  check('each cuff hangs well below its hand, and clears the seat', (() => (
    cuffDrop().every((c) => c.drop > 0.15) && cuffs().every((c) => c.at[1] > FIGURE.seat)
  ))(), cuffDrop().map((c) => `${c.side} ${c.drop.toFixed(2)}`).join(' '));

  check('both cuffs break the body outline from all four QA cameras', (() => {
    // The gate. The body is a solid of revolution, so its silhouette at a
    // height is `bodyRadius` whichever way the camera stands; a cuff is only
    // part of the outline if it projects outside that.
    const margin = (framing, cuff) => {
      const y = cuff.at[1];
      const R = bodyRadius(y);
      const uAt = (x, z) => frameOf([x, y, z], { framing }).u;
      let bodyMax = -Infinity;
      let bodyMin = Infinity;
      let cuffMax = -Infinity;
      let cuffMin = Infinity;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const u = uAt(Math.sin(a) * R, Math.cos(a) * R);
        bodyMax = Math.max(bodyMax, u);
        bodyMin = Math.min(bodyMin, u);
        const c = uAt(cuff.at[0] + Math.sin(a) * cuff.r, cuff.at[2] + Math.cos(a) * cuff.r);
        cuffMax = Math.max(cuffMax, c);
        cuffMin = Math.min(cuffMin, c);
      }
      return Math.max(cuffMax - bodyMax, bodyMin - cuffMin) * W;
    };
    return CAMERA.debugPresets.every((p) => cuffs().every((c) => margin(p.framing, c) > 0))
      // …and at the framing the game actually ships, by enough to see.
      && cuffs().every((c) => margin(preset('hero'), c) > 3);
  })());

  check('a sleeve is a stack of horizontal rings, so its mouth is level', (() => {
    const garment = readFileSync(new URL('../js/view3d/garment.js', import.meta.url), 'utf8');
    // Swept along a slanted axis instead, the mouth comes out slanted, and the
    // far lip of the cuff went thirteen centimetres into the rock.
    return /export function drapeGeometry/.test(garment)
      && ARMS.every((arm) => arm.sleeve.rings.length >= 4)
      && ARMS.every((arm) => arm.sleeve.rings.every((r, i, all) => i === 0 || r[0] < all[i - 1][0]));
  })());

  check('each sleeve widens toward its mouth and carries the hem\'s trim', (() => (
    ARMS.every((arm) => {
      const rs = arm.sleeve.rings.map((r) => r[3]);
      return rs.every((r, i) => i === 0 || r > rs[i - 1]);
    }) && SLEEVE_TRIM.height > 0.04 && SLEEVE_TRIM.lift > 0
  ))());

  /* ------------------------------------------------------------ 腰带 sash */

  check('the two bands are still there, and they sit on the body', (() => (
    SASH.bands.length === 2 && SASH.bands.every((b) => b.lift > 0 && b.tube > 0.02)
    && SASH.bands[0].y < SASH.bands[1].y
  ))());

  check('there is a knot, and it is off to the front-left', (() => {
    const [x, y, z] = SASH.knot.at;
    const bearing = (Math.atan2(x, z) * 180) / Math.PI;
    return x > 0 && z > 0 && bearing > 20 && bearing < 75
      && Math.abs(Math.hypot(x, z) - bodyRadius(y)) < 0.12;
  })());

  check('two tails, both hanging free of the skirt behind them', (() => {
    // "Free" as a number: every sample stands off the cloth by at least four
    // centimetres — three pixels at the hero framing, eight at the close QA
    // camera — and the tip kicks further out again, which is the one place the
    // eye can see daylight between a ribbon and what it is lying against.
    const tails = sashTails();
    if (tails.length !== 2) return false;
    return tails.every((t) => t.points.every((p) => (
      Math.hypot(p[0], p[2]) - bodyRadius(p[1]) >= SASH.standoff - 1e-9
    )));
  })());

  check('they fall to mid-skirt, and they are not a matched pair', (() => {
    const tails = sashTails();
    const mid = (FIGURE.hem + FIGURE.waist) / 2;
    const tips = tails.map((t) => t.points[t.points.length - 1][1]);
    const falls = tails.map((t) => t.points[0][1] - t.points[t.points.length - 1][1]);
    return tips.every((y) => y < mid + 0.06 && y > FIGURE.hem)
      && falls.every((f) => f > 0.15)
      && Math.abs(falls[0] - falls[1]) > 0.01
      && tails[0].width !== tails[1].width;
  })());

  check('the tails are their own mesh, for the stage that has to move them', (() => (
    /const tails = new THREE\.Mesh\(/.test(avatar) && /sashTails\(\)/.test(avatar)
  ))());

  /* ------------------------------------------------------------- the pose */

  check('one shoulder is about three degrees lower than the other', (() => {
    const measured = shoulderDropDeg();
    // Measured off the arms rather than declared, and held to what POSE says,
    // so the pose cannot be documented as three degrees and modelled as none.
    return Math.abs(measured - POSE.shoulderDropDeg) < 0.3
      && measured > 2.5 && measured < 4.2;
  })(), `${shoulderDropDeg().toFixed(2)}°`);

  check('the head does not follow the shoulders', (() => (
    POSE.headTiltDeg > 1.5 && Math.abs(POSE.headTurnDeg) > 2 && POSE.bodyYaw !== 0
    && /headGroup\.rotation\.set/.test(avatar)
  ))());

  check('the figure is not bilaterally symmetric', (() => (
    // Every part reflected through x = 0 and matched to the nearest part of the
    // original set. A mirror-perfect figure scores 0, and a figure that scores
    // 0 is read as manufactured — the same signal a regular polygon sends.
    asymmetryScore() > 0.04
  ))(), `score ${asymmetryScore().toFixed(3)} over ${figureParts().length} parts`);

  check('the hands rest asymmetrically, one in front of the other', (() => {
    const [left, right] = ARMS.map((a) => a.hand);
    return Math.abs(left.at[1] - right.at[1]) > 0.02
      && Math.abs(left.at[2] - right.at[2]) > 0.005
      && Math.abs(Math.abs(left.at[0]) - Math.abs(right.at[0])) > 0.02;
  })());

  /* -------------------------------------------- the instrument can see her */

  check('no standing rock stands between a QA camera and the figure', (() => {
    // Replayed from the same seeded stream world.js places them with. Rock 4
    // came out at a bearing of −40.3° against a profile camera looking in along
    // −41.8°, and a QA camera that cannot see its subject is not an instrument.
    const rand = mulberry32(97);
    const bearings = [];
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const r = 5.2 + rand() * 3.4;
      rand(); rand(); rand(); rand(); rand();
      bearings.push(clearOfCameras(Math.atan2(Math.cos(a) * r, Math.sin(a) * r)));
    }
    const wrl = readFileSync(new URL('../js/view3d/world.js', import.meta.url), 'utf8');
    return /clearOfCameras\(/.test(wrl) && bearings.every((b) => CAMERA.debugPresets.every((p) => {
      const d = (((b - p.framing.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return Math.abs(d) > (15 * Math.PI) / 180;
    }));
  })());
}

section('Stage 7 — the head, the two marks that are her face, and the sword');
{
  const W = 414;
  const H = 896;
  const pxBetween = (framing, a, b) => {
    const fa = frameOf(a, { framing });
    const fb = frameOf(b, { framing });
    return Math.hypot((fa.u - fb.u) * W, (fa.v - fb.v) * H);
  };
  const preset = (id) => CAMERA.debugPresets.find((p) => p.id === id).framing;
  const avatar = readFileSync(new URL('../js/view3d/avatar.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../js/view3d/shaders.js', import.meta.url), 'utf8');
  const view3d = ['world.js', 'scenery.js', 'sect.js', 'trees.js', 'effects.js', 'cloud-sea.js'];

  /* ------------------------------------------------------- head and hair */

  check('the topknot is wrapped at its base', (() => (
    // 冠. One ring in the trim tone, and the line that says the hair was
    // dressed rather than grown that way.
    HEAD.band.radius > HEAD.knot.radius && HEAD.band.tube > 0.015
    && HEAD.band.at[1] < HEAD.knot.at[1] && HEAD.band.at[1] > HEAD.cap.lift
    && /crownBand/.test(avatar)
  ))());

  check('the hairpin is jade, and a material of its own', (() => {
    // Pale against black hair is a value step of about five to one, which is
    // why the pin is the piece that reads when nothing else on the head does.
    const pin = luminance(SURFACES.pin.color);
    const hair = luminance('#171a1f');
    return pin / hair > 4 && SURFACES.pin.roughness <= 0.3 && SURFACES.pin.emissive > 0.3
      && /pinMat/.test(avatar) && !/pin = new THREE\.Mesh\([^)]*trimMat/.test(avatar);
  })(), `jade ${luminance(SURFACES.pin.color).toFixed(0)} vs hair ${luminance('#171a1f').toFixed(0)}`);

  check('two to four loose strands, none of them twins, all outside the skull', (() => {
    const n = HEAD.strands.length;
    if (n < 2 || n > 4) return false;
    const widths = new Set(HEAD.strands.map((s) => s.width));
    // Each one starts at the scalp and leaves it: no point inside the skull,
    // and the loose end well clear of it, which is what breaks the outline.
    const on = ([x, y, z]) => (x / (HEAD.radius * HEAD.scale[0])) ** 2
      + (y / (HEAD.radius * HEAD.scale[1])) ** 2
      + (z / (HEAD.radius * HEAD.scale[2])) ** 2;
    const outside = HEAD.strands.every((s) => s.points.every((p) => on(p) > 0.98)
      && on(s.points[s.points.length - 1]) > 1.15);
    // Two at the temples (+z, the side she faces) and two at the nape (−z).
    const front = HEAD.strands.filter((s) => s.points[0][2] > 0).length;
    return widths.size === n && outside && front >= 1 && front <= n - 1;
  })(), `${HEAD.strands.length} strands`);

  check('the head is not a sphere', (() => {
    const garment = readFileSync(new URL('../js/view3d/garment.js', import.meta.url), 'utf8');
    return /export function bevelJaw/.test(garment) && /bevelJaw\(/.test(avatar)
      && HEAD.jaw.taper > 0.15 && HEAD.jaw.lift > 0;
  })());

  /* ------------------------------------------------------------- the face */

  check('the face is two marks, and there is no third', (() => (
    // Two marks and nothing else, in the plan and in the builder alike.
    FACE.eyes.length === 2
    && !/const (mouth|nose|nostrils|brows?)\b/.test(avatar)
    && Object.keys(FACE).length === 1
  ))());

  check('the marks sit on the front of the head, under the hair', (() => (
    FACE.eyes.every((eye) => {
      const [x, y, z] = eye.at;
      const r = Math.hypot(x / HEAD.scale[0], y / HEAD.scale[1], z / HEAD.scale[2]);
      // On the surface (not floating, not buried), on the +z side, and below
      // the cap's lower edge so the hair does not swallow them.
      return z > 0.1 && Math.abs(r - HEAD.radius) < 0.02
        && y < HEAD.cap.radius * Math.cos(Math.PI * HEAD.cap.theta) + HEAD.cap.lift;
    })
  ))());

  check('they are small, and they are not a mirrored pair', (() => {
    const [a, b] = FACE.eyes;
    const width = (eye) => eye.radius * eye.scale[0] * 2;
    // ~4 CSS px across at the hero framing: a mark, not an eye. A modelled eye
    // at this size is a smudge the viewer keeps trying to resolve, which is
    // the whole of the uncanny read.
    const px = width(a) * 70.6;
    return px > 2.5 && px < 7
      && (a.radius !== b.radius || a.at[1] !== b.at[1]);
  })(), `${(FACE.eyes[0].radius * FACE.eyes[0].scale[0] * 2 * 70.6).toFixed(1)} px across`);

  /* --------------------------------------------------------- the materials */

  check('the material table is the one the stage specified', (() => (
    SURFACES.robe.roughness === 0.85 && SURFACES.trim.roughness === 0.40
    && SURFACES.hair.roughness === 0.60 && SURFACES.skin.roughness === 0.90
    && SURFACES.pin.roughness === 0.25
  ))());

  check('roughness is spent rather than stored', (() => {
    // A number written down and never read is worse than no number. The ink
    // material grew a Blinn lobe to spend these on — and the mapping is steep
    // on purpose, so the robe and the skin keep the flat ink look the whole
    // renderer is built on and only the glossy things pick up a highlight.
    const matte = specularFrom(SURFACES.robe.roughness);
    const jade = specularFrom(SURFACES.pin.roughness);
    return /uGloss/.test(shaders) && /uShine/.test(shaders)
      && /pow\(max\(dot\(n, normalize\(key \+ v\)\), 0\.0\), uShine\)/.test(shaders)
      && jade.gloss / matte.gloss > 100 && jade.shine > matte.shine * 2
      && specularFrom(1).gloss === 0;
  })(), `robe ${specularFrom(0.85).gloss.toFixed(4)}, jade ${specularFrom(0.25).gloss.toFixed(3)}`);

  check('the materials are built from the table, not from loose numbers', (() => (
    /\.\.\.SURFACES\.robe/.test(avatar) && /\.\.\.SURFACES\.trim/.test(avatar)
    && /\.\.\.SURFACES\.hair/.test(avatar) && /\.\.\.SURFACES\.skin/.test(avatar)
    && /\.\.\.SURFACES\.pin/.test(avatar)
  ))());

  /* ------------------------------------------------ the accent, and its owners */

  check('the accent is opt-in, and the default edge is the air', (() => (
    // This term used to be unconditional: every ink surface in the world wore a
    // trace of the player's aura along its outline. Now a surface takes the air
    // at its own height — which is what an edge lit by the sky behind it
    // actually is — unless it is one of the four things that owns her colour.
    /mix\(airAt\(vWorldY\), uRimColor, uAccent\)/.test(shaders)
    && /accent = 0, accentGlow = 0/.test(shaders)
  ))());

  check('no terrain, sky or foliage wears it', (() => {
    // Every ink material outside the figure, checked at its call site. The
    // granite the whole range is cut from has its own assertion in stage 4;
    // this is everything else out there.
    for (const file of view3d) {
      const src = readFileSync(new URL(`../js/view3d/${file}`, import.meta.url), 'utf8');
      const calls = src.match(/makeInkMaterial\(env, \{[^}]*\}/g) || [];
      if (calls.some((c) => /accent/.test(c))) return false;
    }
    return true;
  })());

  check('the sect\'s lanterns are lamplight now, not her qi', (() => {
    const src = readFileSync(new URL('../js/view3d/sect.js', import.meta.url), 'utf8');
    // A valley of teal lanterns at noon and blue ones at night, three hundred
    // units away, wearing the colour that is supposed to be hers alone.
    return /LAMPLIGHT/.test(src) && !/lanternMat\.uniforms\.uColor\.value\.set\(p\.accent\)/.test(src);
  })());

  check('and the figure still owns it: trim, hairpin, qi, particles', (() => (
    SURFACES.trim.accent === 1 && SURFACES.trim.accentGlow > 0
    && SURFACES.pin.accent === 1 && SURFACES.pin.accentGlow > 0
    && SURFACES.robe.accent === undefined && SURFACES.skin.accent === undefined
    && /meridianMat\.uniforms\.uColor\.value\.set\(p\.accent\)/.test(avatar)
    && /moteMat\.uniforms\.uColor\.value\.copy\(auraColor\)/.test(avatar)
  ))());

  /* ------------------------------------------------------------- 剑 the jian */

  check('there is a jian, and it has all four of its parts and a tassel', (() => (
    JIAN.scabbard && JIAN.grip && JIAN.guard && JIAN.pommel && JIAN.tassel
    && JIAN.scabbard.to > 0.6 && JIAN.grip.span[0] > JIAN.scabbard.to
    && JIAN.pommel.span[1] === 1
    && tasselStrands().length >= 3
  ))());

  check('the grip is wrapped, not turned', (() => (
    // Six rings alternating proud and slack. At six CSS pixels across, a smooth
    // cylinder and a wrapped one differ by nothing; a ribbed one catches the
    // key light six times and reads as bound cord.
    JIAN.grip.cords >= 4 && JIAN.grip.cord > 0.005
    && /JIAN\.grip\.cords \* 2/.test(avatar)
  ))());

  check('it is planted in the rock, not standing on it', (() => (
    // The tip is below the stone's top face; everything that has to be seen is
    // above it.
    JIAN.tip[1] < FIGURE.seat - 0.05 && jianAt(JIAN.scabbard.to)[1] > FIGURE.seat
    && jianLength() > 1.0
  ))(), `tip ${JIAN.tip[1]} vs seat ${FIGURE.seat}`);

  check('it stands clear of the figure from every camera', (() => {
    // She is a seated triangle; the sword is the vertical the composition did
    // not have. Both of those need the two shapes to stay separate.
    const gap = (framing) => {
      let edge = -Infinity;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const y = 0.5;
        edge = Math.max(edge, frameOf([Math.sin(a) * bodyRadius(y), y, Math.cos(a) * bodyRadius(y)],
          { framing }).u);
      }
      const sword = Math.min(frameOf(JIAN.tip, { framing }).u, frameOf(JIAN.head, { framing }).u);
      return (sword - edge) * W;
    };
    return CAMERA.debugPresets.every((p) => gap(p.framing) > 0) && gap(preset('hero')) > 6;
  })(), `${(() => {
    let edge = -Infinity;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      edge = Math.max(edge, frameOf([Math.sin(a) * bodyRadius(0.5), 0.5, Math.cos(a) * bodyRadius(0.5)],
        { framing: preset('hero') }).u);
    }
    return ((Math.min(frameOf(JIAN.tip, { framing: preset('hero') }).u,
      frameOf(JIAN.head, { framing: preset('hero') }).u) - edge) * W).toFixed(1);
  })()} px at hero`);

  check('it is a real vertical in the frame, under her crown and inside the picture', (() => {
    const framing = preset('hero');
    const tip = frameOf(JIAN.tip, { framing });
    const head = frameOf(JIAN.head, { framing });
    const crown = frameOf([0, FIGURE.crown, 0], { framing });
    // 80-odd pixels of hard vertical beside a figure who is 91 tall, its head
    // below her crown so it never competes, and clear of the UI bands.
    return (tip.v - head.v) * H > 60 && head.v > crown.v
      && head.u > 0 && head.u < 1 && head.v > CAMERA.safeZone.top
      && tip.v < 1 - CAMERA.safeZone.bottom;
  })());

  check('the tassel hangs free of the sword it hangs from', (() => {
    // Clear of the scabbard by more than its own radius at every strand, and
    // falling well below the pommel — this is the free end stage 8 gets to
    // move, and a free end that is inside the object is not free.
    const axis = [JIAN.head[0] - JIAN.tip[0], JIAN.head[1] - JIAN.tip[1], JIAN.head[2] - JIAN.tip[2]];
    const len = Math.hypot(...axis);
    const dist = (p) => {
      const d = [p[0] - JIAN.tip[0], p[1] - JIAN.tip[1], p[2] - JIAN.tip[2]];
      const t = (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]) / (len * len);
      const on = [JIAN.tip[0] + axis[0] * t, JIAN.tip[1] + axis[1] * t, JIAN.tip[2] + axis[2] * t];
      return Math.hypot(p[0] - on[0], p[1] - on[1], p[2] - on[2]);
    };
    return tasselStrands().every((s) => dist(s.to) > JIAN.scabbard.r[1] + 0.02)
      && tasselStrands().every((s) => JIAN.head[1] - s.to[1] > 0.15)
      && new Set(tasselStrands().map((s) => s.to[1].toFixed(4))).size > 1;
  })());

  check('the sword does not breathe', (() => (
    // It is in `group`, not in `body`: the body carries the breath scale and
    // the pose yaw, and a sword driven into stone does neither.
    /group\.add\(solid\(sword\)\)/.test(avatar) && /group\.add\(solid\(tassel\)\)/.test(avatar)
  ))());
}

section('Camera lock — the harness ships to nobody');
{
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

  check('camera-config.js is in the service worker shell',
    sw.includes("'./js/view3d/camera-config.js'"));

  check('debug.js is not', !sw.includes("'./js/view3d/debug.js'"));

  check('the panel is imported dynamically, and only in a dev build',
    /if \(DEBUG\) \{/.test(main) && /import\('\.\/view3d\/debug\.js'\)/.test(main)
    && !/^import .*debug\.js/m.test(main));

  check('the dev-build predicate is written once', (() => {
    // main.js needs it before the WebGL context exists and debug.js needs it
    // too; two copies would drift, and the day they disagree the capture tool
    // starts returning blank frames in one build and not another.
    const dbg = readFileSync(new URL('../js/view3d/debug.js', import.meta.url), 'utf8');
    return /import \{ debugEnabled \} from '\.\/view3d\/dev-flag\.js'/.test(main)
      && /export \{ debugEnabled \} from '\.\/dev-flag\.js'/.test(dbg)
      && !/localhost/.test(main) && !/localhost/.test(dbg);
  })());

  check('a shipped build pays nothing for the drawing buffer', (() => {
    const src = readFileSync(new URL('../js/view3d/index.js', import.meta.url), 'utf8');
    return /preserveDrawingBuffer: !!debug/.test(src);
  })());

  check('localhost and ?debug turn it on; a real host does not', (() => {
    const on = (search, hostname) => debugEnabled({ search, hostname });
    return on('?debug=1', 'example.com') && on('?x=1&debug', 'example.com')
      && on('', 'localhost') && on('', '127.0.0.1')
      && !on('', 'viothugo.github.io') && !on('?nodebugging=1', 'viothugo.github.io');
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
