// Myriad Dao — the engine.
//
// Pure state and rules. No DOM, no WebGL, no audio, no timers, no Math.random.
// Everything that varies is injected (`random`, `now`), so tools/balance-sim.js
// and tests/run.js can drive an identical game headlessly in Node.
//
// The renderer and the HUD read this through `viewModel()` and call actions.
// They never reach into `state` to change anything.

import * as D from './data.js';
import { seededRandom, mulberry32, pick, randInt, weightedIndex } from './rng.js';

export const SAVE_KEY = 'myriad-dao-save';
export const SAVE_VERSION = 5; // v0.4 saves carry 4 or lower and are migrated.
export const GAME_VERSION = '0.5.0';

/* ====================================================================== */
/*  default state                                                          */
/* ====================================================================== */

export function defaultState() {
  return {
    version: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    name: 'Nameless Wanderer',

    realm: 0,
    stage: 0,
    qi: 0,
    age: D.START_AGE,
    withered: false,

    techniques: {},          // id -> level
    meridians: 0,

    herbs: 0,
    stones: 0,
    cores: 0,

    arrays: 0,
    rings: 0,
    talismans: 0,

    nineTurn: 0,
    insightPill: false,
    buffs: { qi: 0, tap: 0 },

    insight: 0,              // Dao Insight, carried across lives
    bestRealm: 0,

    expedition: null,        // { id, remaining, total }
    pendingForge: null,      // { slot, rarity, power, name } — survives reload
    pendingTrib: null,       // { chance, speed, cost, realm }
    duel: null,              // { rank, window, speeds } — an in-flight duel

    artifacts: { sword: null, robe: null, ring: null },

    sect: {
      founded: false,
      name: '',
      disciples: [],         // { name, tier }
      facilities: { hall: 0, garden: 0, mine: 0, training: 0, pavilion: 0, forge: 0 },
    },

    jianghu: { rank: D.LADDER_SIZE + 1, wins: 0, losses: 0, cooldown: 0 },

    injury: 0,               // seconds remaining
    deviationCd: 0,          // seconds remaining

    records: {},             // id -> true
    stats: {
      taps: 0, pills: 0, expeditions: 0, forges: 0, salvages: 0,
      duelsWon: 0, allTimeQi: 0, bestRarity: null, witheredCured: 0,
      chosen: 0, rebirths: 0, lifeQi: 0, playTime: 0,
    },

    log: [],
    settings: { sfx: true, music: true, haptics: true, quality: 'auto', reducedMotion: false },
    lastSeen: 0,
    seed: 0,
  };
}

/* ====================================================================== */
/*  derived values — pure functions of state                               */
/* ====================================================================== */

export function realmData(s) { return D.REALMS[s.realm]; }
export function isMajor(s) { return s.stage >= D.STAGE_NAMES.length - 1; }

/**
 * Peak Immortal Ascension is the top of the ladder — there is no ninth realm to
 * break through into. Without this the tribulation happily advances `realm` to
 * 8, every REALMS lookup throws, and the corrupt state is autosaved.
 */
export function isFinalStage(s) {
  return s.realm >= D.REALMS.length - 1 && s.stage >= D.STAGE_NAMES.length - 1;
}

/** Qi needed for the next breakthrough. A major one costs double. */
export function breakthroughCost(s) {
  const r = D.REALMS[s.realm];
  const base = r.base * Math.pow(D.STAGE_COST_GROWTH, s.stage);
  return isMajor(s) ? base * D.MAJOR_COST_MULT : base;
}

/** The bottleneck: qi never exceeds 1.6x the next breakthrough. */
export function qiCap(s) { return breakthroughCost(s) * D.QI_CAP_MULT; }

export function atCap(s) { return s.qi >= qiCap(s) - 1e-9; }

export function techLevel(s, id) { return s.techniques[id] || 0; }

export function techCost(s, id) {
  const t = D.TECHNIQUE_BY_ID[id];
  return t.base * Math.pow(t.growth, techLevel(s, id));
}

export function meridianCost(s) {
  return D.MERIDIAN_BASE * Math.pow(D.MERIDIAN_GROWTH, s.meridians);
}

/** Artifact bonus for a slot, as a percentage (0 when the slot is empty). */
export function artifactPct(s, slot) {
  const a = s.artifacts[slot];
  return a ? a.power : 0;
}

/** Ring artifact scales loot from every source. */
export function lootMult(s) { return 1 + artifactPct(s, 'ring') / 100; }

/** Renown: +1% qi/s per rank climbed, capped at +99%. */
export function renown(s) {
  return Math.max(0, Math.min(D.MAX_RENOWN, D.LADDER_SIZE - s.jianghu.rank));
}

/** Combined Dao Record bonus, as a percentage. */
export function recordBonusPct(s) {
  let sum = 0;
  for (const r of D.RECORDS) if (s.records[r.id]) sum += r.bonus;
  return sum;
}

export function pavilionLevel(s) {
  return s.sect.founded ? s.sect.facilities.pavilion : 0;
}

/**
 * (spec A1) Qi/s = realm x stage x techniques x meridians x arrays x nine-turn
 * x insight x pavilion x robe x renown x records, then buffs and penalties.
 */
export function qiPerSecond(s) {
  let m = D.REALMS[s.realm].mult;
  m *= Math.pow(D.STAGE_BONUS, s.stage);
  for (const t of D.TECHNIQUES) {
    if (t.type === 'qi') m *= 1 + t.per * techLevel(s, t.id);
  }
  m *= Math.pow(D.MERIDIAN_BONUS, s.meridians);
  m *= 1 + D.SHOP.array.per * s.arrays;
  m *= 1 + D.NINE_TURN_BONUS * s.nineTurn;
  m *= 1 + D.INSIGHT_BONUS * s.insight;
  m *= 1 + D.PAVILION_BONUS * pavilionLevel(s);
  m *= 1 + artifactPct(s, 'robe') / 100;
  m *= 1 + renown(s) / 100;
  m *= 1 + recordBonusPct(s) / 100;
  if (s.buffs.qi > 0) m *= D.QI_PILL_MULT;
  if (s.injury > 0) m *= D.INJURY_MULT;
  if (s.withered) m *= D.WITHER_MULT;
  return m;
}

/** (spec A1) A tap is worth 0.4s of qi/s, times tap gear, floored at 1. */
export function tapPower(s) {
  let m = qiPerSecond(s) * D.TAP_SECONDS;
  for (const t of D.TECHNIQUES) {
    if (t.type === 'tap') m *= 1 + t.per * techLevel(s, t.id);
  }
  m *= 1 + artifactPct(s, 'sword') / 100;
  if (s.buffs.tap > 0) m *= D.MARROW_MULT;
  return Math.max(1, m);
}

export function lifespan(s) { return D.REALMS[s.realm].lifespan; }
export function ageFraction(s) {
  const span = lifespan(s);
  return isFinite(span) ? s.age / span : 0;
}

/** (spec A2) Tribulation odds. The golden window's width equals this exactly. */
export function tribulationChance(s, { talisman = s.talismans > 0, insight = s.insightPill } = {}) {
  let c = D.TRIB.baseChance + D.TRIB.perRealm * s.realm;
  if (talisman) c += D.TRIB.talisman;
  if (insight) c += D.TRIB.insightPill;
  c += D.TECHNIQUE_BY_ID.clarity.per * techLevel(s, 'clarity');
  return Math.max(D.TRIB.minChance, Math.min(D.TRIB.maxChance, c));
}

export function tribulationSpeed(s) {
  return D.TRIB.baseSpeed + D.TRIB.speedPerRealm * s.realm;
}

/* ------------------------------------------------------------------ forge */

export function forgeLuck(s) {
  return s.realm + D.FORGE_LUCK_PER_LEVEL * (s.sect.founded ? s.sect.facilities.forge : 0);
}

/** (spec A10) weight_i * (1 + 0.09 * luck)^i — always shown to the player. */
export function rarityWeights(luck) {
  const tilt = 1 + D.LUCK_TILT * luck;
  return D.RARITIES.map((r, i) => r.weight * Math.pow(tilt, i));
}

export function rarityOdds(luck) {
  const w = rarityWeights(luck);
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

export function forgeCost(s) {
  return { cores: D.FORGE_CORE_COST, stones: D.FORGE_STONE_BASE * (s.realm + 1) };
}

/* ------------------------------------------------------------------ duels */

/** The ladder is shared and deterministic: rank 37 is the same person for all. */
export function rival(rank) {
  const rand = seededRandom('myriad-dao/jianghu/v1/' + rank);
  const epithet = pick(rand, D.RIVAL_EPITHETS);
  const family = pick(rand, D.RIVAL_FAMILIES);
  const given = pick(rand, D.RIVAL_GIVEN);
  return {
    rank,
    name: `"${epithet}" ${family} ${given}`,
    epithet, family, given,
    might: D.LADDER_BASE_MIGHT * Math.pow(D.LADDER_GROWTH, D.LADDER_SIZE - rank),
  };
}

export function playerMight(s) {
  return qiPerSecond(s) * (1 + artifactPct(s, 'sword') / 100);
}

/** Strike-window width = your share of combined might, clamped 8-80%. */
export function duelWindow(mine, theirs) {
  const raw = mine / (mine + theirs);
  return Math.max(D.DUEL_MIN_WINDOW, Math.min(D.DUEL_MAX_WINDOW, raw));
}

export function duelTarget(s) {
  const rank = s.jianghu.rank - 1;
  return rank >= 1 ? rival(rank) : null;
}

/* ------------------------------------------------------------------- sect */

export function sectCapacity(s) {
  return D.SECT_BASE_CAPACITY + D.SECT_CAPACITY_PER_LEVEL * s.sect.facilities.hall;
}

export function recruitCost(s) {
  return D.RECRUIT_BASE * Math.pow(D.RECRUIT_GROWTH, s.sect.disciples.length);
}

export function facilityCost(s, id) {
  const f = D.FACILITY_BY_ID[id];
  return f.base * Math.pow(f.growth, s.sect.facilities[id]);
}

export function sectTier(s) {
  const i = D.sectTierIndex(s);
  return i < 0 ? null : D.SECT_TIERS[i];
}

/** Passive sect yield, per second, scaled by realm and the ring artifact. */
export function sectIncome(s) {
  if (!s.sect.founded) return { stones: 0, herbs: 0 };
  const f = s.sect.facilities;
  const scale = (s.realm + 1) * lootMult(s);
  const training = 1 + D.TRAINING_BONUS * f.training;
  let discipleRate = 0;
  for (const d of s.sect.disciples) discipleRate += D.DISCIPLE_TIERS[d.tier].rate;
  const stones = ((discipleRate * training + f.mine * D.MINE_STONES_PER_MIN) / 60) * scale;
  const herbs = ((f.garden * D.GARDEN_HERBS_PER_MIN) / 60) * scale;
  return { stones, herbs };
}

/* ------------------------------------------------------------------ shop */

export function shopCost(s, id) {
  const item = D.SHOP[id];
  const owned = id === 'array' ? s.arrays : id === 'ring' ? s.rings : 0;
  return item.base * Math.pow(item.growth, owned);
}

export function pillCost(s, id) {
  const p = D.PILL_BY_ID[id];
  if (p.growth) return p.herbs * Math.pow(p.growth, s.nineTurn);
  return p.herbs;
}

/* ---------------------------------------------------------------- offline */

export function offlineRate(s) {
  return Math.min(
    D.OFFLINE_MAX_RATE,
    D.OFFLINE_BASE_RATE + D.OFFLINE_RATE_PER_TURTLE * techLevel(s, 'turtle'),
  );
}

export function offlineCap(s) {
  return D.OFFLINE_BASE_CAP + D.OFFLINE_CAP_PER_RING * s.rings;
}

/* ------------------------------------------------------------ reincarnation */

/** (spec A13) (realm - 3) * 6 + floor((lifetime qi / 1e9) ^ 0.32). */
export function insightGain(s) {
  const fromRealm = Math.max(0, (s.realm - D.INSIGHT_REALM_FLOOR) * D.INSIGHT_REALM_BONUS);
  const fromQi = Math.floor(Math.pow(Math.max(0, s.stats.lifeQi) / D.INSIGHT_QI_DIVISOR, D.INSIGHT_QI_EXP));
  return fromRealm + (isFinite(fromQi) ? fromQi : 0);
}

export function canReincarnate(s) { return s.realm >= D.REBIRTH_REALM; }

/* ====================================================================== */
/*  the game object                                                        */
/* ====================================================================== */

export function createGame(options = {}) {
  const random = options.random || Math.random;
  const state = options.state ? migrate(options.state) : defaultState();
  const listeners = new Set();

  if (!state.seed) state.seed = Math.floor(random() * 0xffffffff) >>> 0;
  let nameRand = mulberry32(state.seed);

  function emit(type, payload = {}) {
    const ev = { type, ...payload };
    for (const fn of listeners) fn(ev);
    return ev;
  }

  function chronicle(text, kind = 'plain') {
    state.log.unshift({ text, kind, age: Math.floor(state.age) });
    if (state.log.length > 60) state.log.length = 60;
    emit('log', { text, kind });
  }

  /* ------------------------------------------------------- qi accounting */

  function addQi(amount) {
    if (amount <= 0) return 0;
    const cap = qiCap(state);
    const room = Math.max(0, cap - state.qi);
    const gained = Math.min(amount, room);
    state.qi += gained;
    state.stats.lifeQi += gained;
    state.stats.allTimeQi += gained;
    return gained;
  }

  function spendQi(amount) {
    if (state.qi < amount) return false;
    state.qi -= amount;
    return true;
  }

  /* ---------------------------------------------------------- dao records */

  function checkRecords() {
    let earned = null;
    for (const r of D.RECORDS) {
      if (state.records[r.id]) continue;
      let ok = false;
      try { ok = r.check(state); } catch { ok = false; }
      if (ok) {
        state.records[r.id] = true;
        earned = r;
        chronicle(`Dao Record sealed — ${r.name} (+${r.bonus}% Qi/s, forever).`, 'record');
        emit('record', { record: r });
      }
    }
    return earned;
  }

  /* ------------------------------------------------------------ lifespan */

  function checkMortality() {
    const span = lifespan(state);
    if (!isFinite(span) || state.age <= span) return;
    if (state.realm >= D.NASCENT_SOUL_REALM) {
      // The shell fails; the nascent soul leaves and is reborn.
      chronicle('The flesh gives out. Your nascent soul tears free and seeks a new dawn.', 'death');
      emit('death', { forced: true });
      doReincarnate(true);
    } else if (!state.withered) {
      state.withered = true;
      chronicle('Your allotted years are spent. The body withers — Qi gathers at a third its pace.', 'wither');
      emit('wither', {});
    }
  }

  /* ------------------------------------------------------------ main tick */

  function tick(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 3600); // a single tick never swallows more than an hour
    state.stats.playTime += dt;
    state.age += dt / D.YEAR_SECONDS;

    addQi(qiPerSecond(state) * dt);

    if (state.buffs.qi > 0) state.buffs.qi = Math.max(0, state.buffs.qi - dt);
    if (state.buffs.tap > 0) state.buffs.tap = Math.max(0, state.buffs.tap - dt);
    if (state.injury > 0) state.injury = Math.max(0, state.injury - dt);
    if (state.deviationCd > 0) state.deviationCd = Math.max(0, state.deviationCd - dt);
    if (state.jianghu.cooldown > 0) state.jianghu.cooldown = Math.max(0, state.jianghu.cooldown - dt);

    const inc = sectIncome(state);
    state.stones += inc.stones * dt;
    state.herbs += inc.herbs * dt;

    if (state.expedition) {
      state.expedition.remaining -= dt;
      if (state.expedition.remaining <= 0) completeExpedition();
    }

    checkMortality();
    checkRecords();
  }

  /* --------------------------------------------------------------- offline */

  /** (spec A14) Closed-door cultivation. Returns a report for the modal. */
  function applyOffline(elapsedSeconds) {
    const capped = Math.min(Math.max(0, elapsedSeconds), offlineCap(state));
    if (capped <= 0) return null;

    const rate = offlineRate(state);
    const before = { stones: state.stones, herbs: state.herbs };
    const qi = addQi(qiPerSecond(state) * rate * capped);

    const inc = sectIncome(state);
    state.stones += inc.stones * capped;
    state.herbs += inc.herbs * capped;

    state.age += capped / D.YEAR_SECONDS;
    if (state.buffs.qi > 0) state.buffs.qi = Math.max(0, state.buffs.qi - capped);
    if (state.buffs.tap > 0) state.buffs.tap = Math.max(0, state.buffs.tap - capped);
    if (state.injury > 0) state.injury = Math.max(0, state.injury - capped);
    if (state.deviationCd > 0) state.deviationCd = Math.max(0, state.deviationCd - capped);
    if (state.jianghu.cooldown > 0) state.jianghu.cooldown = Math.max(0, state.jianghu.cooldown - capped);

    let expedition = null;
    if (state.expedition && state.expedition.remaining <= capped) {
      expedition = completeExpedition();
    } else if (state.expedition) {
      state.expedition.remaining -= capped;
    }

    checkMortality();
    checkRecords();

    return {
      seconds: capped,
      truncated: elapsedSeconds > capped,
      qi,
      rate,
      stones: state.stones - before.stones,
      herbs: state.herbs - before.herbs,
      years: capped / D.YEAR_SECONDS,
      expedition,
    };
  }

  /* ------------------------------------------------------------ cultivate */

  function cultivate() {
    const gain = tapPower(state);
    const got = addQi(gain);
    state.stats.taps += 1;
    checkRecords();
    return { gain, got, capped: got < gain - 1e-9 };
  }

  /* --------------------------------------------------------- breakthrough */

  function beginBreakthrough() {
    const cost = breakthroughCost(state);
    if (state.deviationCd > 0) {
      return { ok: false, reason: 'Your meridians are still in disarray.' };
    }
    if (isFinalStage(state)) {
      return { ok: false, reason: 'There is nothing above Immortal Ascension. Only the wheel remains.' };
    }
    if (state.qi < cost) return { ok: false, reason: 'Not enough Qi.' };
    if (state.pendingTrib) return { ok: false, reason: 'A tribulation is already upon you.' };

    if (!isMajor(state)) {
      spendQi(cost);
      state.stage += 1;
      chronicle(`Breakthrough — ${D.STAGE_NAMES[state.stage]} ${D.REALMS[state.realm].name}.`, 'break');
      emit('breakthrough', { kind: 'minor', realm: state.realm, stage: state.stage });
      checkRecords();
      return { ok: true, kind: 'minor', realm: state.realm, stage: state.stage };
    }

    // Major: the heavens take notice. Consumables burn whether you live or not.
    const usedTalisman = state.talismans > 0;
    const usedInsight = state.insightPill;
    const chance = tribulationChance(state, { talisman: usedTalisman, insight: usedInsight });
    if (usedTalisman) state.talismans -= 1;
    if (usedInsight) state.insightPill = false;

    state.pendingTrib = {
      chance,
      speed: tribulationSpeed(state),
      cost,
      realm: state.realm,
      usedTalisman,
      usedInsight,
    };
    chronicle('The sky darkens. Heavenly Tribulation gathers above you.', 'trib');
    emit('tribulation:begin', { ...state.pendingTrib });
    return { ok: true, kind: 'tribulation', ...state.pendingTrib };
  }

  /**
   * The view decides whether the tap landed inside the golden window and
   * reports it here; the headless sim rolls `random() < chance` instead.
   * Either way the engine owns every consequence.
   */
  function resolveTribulation(success) {
    const t = state.pendingTrib;
    if (!t) return { ok: false, reason: 'No tribulation is active.' };
    state.pendingTrib = null;

    if (!success) {
      const lost = state.qi * D.TRIB.failQiLoss;
      state.qi -= lost;
      state.deviationCd = D.TRIB.failCooldown;
      chronicle('The bolt lands wrong. Qi deviation — your gathered power scatters.', 'fail');
      emit('tribulation:end', { success: false, lost });
      return { ok: true, success: false, lost };
    }

    spendQi(t.cost);
    const wasWithered = state.withered;
    // Belt and braces: a pendingTrib restored from an older save could still be
    // sitting at the summit. Never index past the end of the realm table.
    state.realm = Math.min(state.realm + 1, D.REALMS.length - 1);
    state.stage = 0;
    state.withered = false;
    if (wasWithered) state.stats.witheredCured += 1;
    state.bestRealm = Math.max(state.bestRealm, state.realm);

    const name = D.REALMS[state.realm].name;
    chronicle(`You endure. ${name} — the world is wider than it was.`, 'ascend');
    if (wasWithered) chronicle('Vitality floods back into a body that had already given up.', 'ascend');
    emit('tribulation:end', { success: true, realm: state.realm, cured: wasWithered });
    checkRecords();
    return { ok: true, success: true, realm: state.realm, cured: wasWithered };
  }

  /* ------------------------------------------------------- techniques etc. */

  function buyTechnique(id) {
    const t = D.TECHNIQUE_BY_ID[id];
    if (!t) return { ok: false, reason: 'No such manual.' };
    if (state.realm < t.realm) return { ok: false, reason: 'Your realm is too shallow to read it.' };
    const lvl = techLevel(state, id);
    if (lvl >= t.cap) return { ok: false, reason: 'Already mastered.' };
    const cost = techCost(state, id);
    if (!spendQi(cost)) return { ok: false, reason: 'Not enough Qi.' };
    state.techniques[id] = lvl + 1;
    emit('purchase', { what: 'technique', id, level: lvl + 1 });
    if (lvl + 1 === t.cap) {
      chronicle(`${t.name} — mastered.`, 'master');
      emit('mastery', { id });
    }
    checkRecords();
    return { ok: true, level: lvl + 1, cost };
  }

  function openMeridian() {
    if (state.meridians >= D.MERIDIAN_COUNT) return { ok: false, reason: 'All twelve stand open.' };
    if (state.deviationCd > 0) return { ok: false, reason: 'Your meridians are still in disarray.' };
    const cost = meridianCost(state);
    if (!spendQi(cost)) return { ok: false, reason: 'Not enough Qi.' };
    const name = D.MERIDIANS[state.meridians];
    state.meridians += 1;
    chronicle(`The ${name} meridian opens.`, 'meridian');
    emit('purchase', { what: 'meridian', index: state.meridians, name });
    checkRecords();
    return { ok: true, index: state.meridians, name, cost };
  }

  /* ------------------------------------------------------------ expeditions */

  function startExpedition(id) {
    if (state.realm < D.DUEL_REALM) return { ok: false, reason: 'Not yet. Learn to hold your Qi first.' };
    if (state.expedition) return { ok: false, reason: 'A party is already out.' };
    const e = D.EXPEDITIONS.find((x) => x.id === id);
    if (!e) return { ok: false, reason: 'No such expedition.' };
    state.expedition = { id, remaining: e.duration, total: e.duration };
    emit('expedition:start', { id, duration: e.duration });
    return { ok: true, duration: e.duration };
  }

  function completeExpedition() {
    const cur = state.expedition;
    if (!cur) return null;
    const e = D.EXPEDITIONS.find((x) => x.id === cur.id);
    state.expedition = null;

    const scale = (state.realm + 1) * lootMult(state);
    const herbs = randInt(random, e.herbs[0], e.herbs[1]) * scale;
    const stones = randInt(random, e.stones[0], e.stones[1]) * scale;
    const cores = e.cores[1] > 0 ? Math.round(randInt(random, e.cores[0], e.cores[1]) * lootMult(state)) : 0;

    state.herbs += herbs;
    state.stones += stones;
    state.cores += cores;
    state.stats.expeditions += 1;

    const haul = { id: cur.id, name: e.name, herbs, stones, cores };
    chronicle(`The party returns from ${e.name}.`, 'expedition');
    emit('expedition:done', haul);
    checkRecords();
    return haul;
  }

  /* ---------------------------------------------------------------- pills */

  function brewPill(id) {
    if (state.realm < D.FORGE_REALM) return { ok: false, reason: 'You have no furnace yet.' };
    const p = D.PILL_BY_ID[id];
    if (!p) return { ok: false, reason: 'No such recipe.' };
    if (id === 'insight' && state.insightPill) {
      return { ok: false, reason: 'You already hold one. It will keep.' };
    }
    const cost = pillCost(state, id);
    if (state.herbs < cost) return { ok: false, reason: 'Not enough spirit herbs.' };
    state.herbs -= cost;
    state.stats.pills += 1;

    if (p.effect === 'qi') {
      state.buffs.qi = Math.min(D.BUFF_STACK_CAP, state.buffs.qi + p.duration);
    } else if (p.effect === 'tap') {
      state.buffs.tap = Math.min(D.BUFF_STACK_CAP, state.buffs.tap + p.duration);
    } else if (p.effect === 'insight') {
      state.insightPill = true;
    } else if (p.effect === 'permanent') {
      state.nineTurn += 1;
      chronicle(`Nine-Turn Immortal Pill refined — ${state.nineTurn} taken in this body.`, 'pill');
    }
    emit('pill', { id, cost });
    checkRecords();
    return { ok: true, cost };
  }

  /* ----------------------------------------------------- treasure pavilion */

  function buyShop(id) {
    const item = D.SHOP[id];
    if (!item) return { ok: false, reason: 'Not for sale.' };
    const cost = shopCost(state, id);
    if (state.stones < cost) return { ok: false, reason: 'Not enough spirit stones.' };
    state.stones -= cost;
    if (id === 'array') state.arrays += 1;
    else if (id === 'ring') state.rings += 1;
    else if (id === 'talisman') state.talismans += 1;
    emit('purchase', { what: 'shop', id, cost });
    checkRecords();
    return { ok: true, cost };
  }

  /* ---------------------------------------------------------------- sect */

  function foundSect(name) {
    if (state.sect.founded) return { ok: false, reason: 'You already have a sect.' };
    if (state.realm < D.SECT_REALM) return { ok: false, reason: 'Form your core first.' };
    if (state.stones < D.SECT_FOUND_COST) return { ok: false, reason: 'Not enough spirit stones.' };
    state.stones -= D.SECT_FOUND_COST;
    state.sect.founded = true;
    state.sect.name = (name || 'Cloudreach Sect').slice(0, 28);
    chronicle(`${state.sect.name} is founded. The valley has a name now.`, 'sect');
    emit('sect:found', { name: state.sect.name });
    checkRecords();
    return { ok: true, name: state.sect.name };
  }

  function discipleName() {
    return `${pick(nameRand, D.DISCIPLE_FAMILIES)} ${pick(nameRand, D.DISCIPLE_GIVEN)}`;
  }

  function recruitDisciple() {
    if (!state.sect.founded) return { ok: false, reason: 'Found a sect first.' };
    if (state.sect.disciples.length >= sectCapacity(state)) {
      return { ok: false, reason: 'No room. Expand the Sect Hall.' };
    }
    const cost = recruitCost(state);
    if (state.stones < cost) return { ok: false, reason: 'Not enough spirit stones.' };
    state.stones -= cost;

    // Blind talent roll: you pay before you know what you got.
    const roll = random();
    let tier = 0, acc = 0;
    for (let i = 0; i < D.DISCIPLE_TIERS.length; i++) {
      acc += D.DISCIPLE_TIERS[i].chance;
      if (roll < acc) { tier = i; break; }
      tier = i;
    }
    const d = { name: discipleName(), tier };
    state.sect.disciples.push(d);
    if (tier === 2) {
      state.stats.chosen += 1;
      chronicle(`${d.name} kneels at the gate. Heaven's Chosen — the elders are speechless.`, 'chosen');
    } else {
      chronicle(`${d.name} joins as an ${D.DISCIPLE_TIERS[tier].name}.`, 'sect');
    }
    emit('sect:recruit', { disciple: d, cost });
    checkRecords();
    return { ok: true, disciple: d, cost };
  }

  function upgradeFacility(id) {
    if (!state.sect.founded) return { ok: false, reason: 'Found a sect first.' };
    const f = D.FACILITY_BY_ID[id];
    if (!f) return { ok: false, reason: 'No such building.' };
    const cost = facilityCost(state, id);
    if (state.stones < cost) return { ok: false, reason: 'Not enough spirit stones.' };
    const beforeTier = D.sectTierIndex(state);
    state.stones -= cost;
    state.sect.facilities[id] += 1;
    const afterTier = D.sectTierIndex(state);
    if (afterTier > beforeTier) {
      chronicle(`The sect rises to ${D.SECT_TIERS[afterTier].name}.`, 'sect');
      emit('sect:tier', { tier: afterTier });
    }
    emit('purchase', { what: 'facility', id, level: state.sect.facilities[id], cost });
    checkRecords();
    return { ok: true, level: state.sect.facilities[id], cost };
  }

  /* --------------------------------------------------------------- forge */

  function artifactName(rarityKey, slotId, rand) {
    const r = D.RARITIES.find((x) => x.key === rarityKey);
    const slot = D.SLOT_BY_ID[slotId];
    return `${pick(rand, r.prefixes)} ${pick(rand, slot.nouns)}`;
  }

  function beginForge(slotId) {
    if (state.realm < D.FORGE_REALM) return { ok: false, reason: 'The forge is beyond you yet.' };
    if (state.pendingForge) return { ok: false, reason: 'Something already glows on the anvil.' };
    const slot = D.SLOT_BY_ID[slotId];
    if (!slot) return { ok: false, reason: 'No such slot.' };
    const cost = forgeCost(state);
    if (state.cores < cost.cores) return { ok: false, reason: 'Not enough beast cores.' };
    if (state.stones < cost.stones) return { ok: false, reason: 'Not enough spirit stones.' };

    state.cores -= cost.cores;
    state.stones -= cost.stones;

    const luck = forgeLuck(state);
    const idx = weightedIndex(random, rarityWeights(luck));
    const rarity = D.RARITIES[idx];
    const power = slot.base * rarity.mult * (1 + D.FORGE_REALM_SCALE * state.realm);

    state.pendingForge = {
      slot: slotId,
      rarity: rarity.key,
      power,
      name: artifactName(rarity.key, slotId, nameRand),
      forgedAt: state.realm,
    };
    state.stats.forges += 1;
    if (D.rarityIndex(rarity.key) > D.rarityIndex(state.stats.bestRarity)) {
      state.stats.bestRarity = rarity.key;
    }
    emit('forge:reveal', { ...state.pendingForge, cost });
    checkRecords();
    return { ok: true, artifact: { ...state.pendingForge }, cost };
  }

  function resolveForge(bind) {
    const p = state.pendingForge;
    if (!p) return { ok: false, reason: 'The anvil is cold.' };
    state.pendingForge = null;

    if (!bind) {
      state.cores += D.SALVAGE_CORES;
      state.stats.salvages += 1;
      emit('forge:salvage', { artifact: p });
      checkRecords();
      return { ok: true, bound: false, salvaged: p };
    }

    const replaced = state.artifacts[p.slot];
    state.artifacts[p.slot] = p;
    if (replaced) {
      state.cores += D.SALVAGE_CORES;
      state.stats.salvages += 1;
    }
    const r = D.RARITIES.find((x) => x.key === p.rarity);
    chronicle(`${p.name} bound — ${r.name} grade.`, p.rarity === 'immortal' ? 'immortal' : 'forge');
    emit('forge:bind', { artifact: p, replaced });
    checkRecords();
    return { ok: true, bound: true, artifact: p, replaced };
  }

  /* --------------------------------------------------------------- duels */

  function beginDuel() {
    if (state.realm < D.DUEL_REALM) return { ok: false, reason: 'The jianghu has not heard of you.' };
    if (state.jianghu.cooldown > 0) return { ok: false, reason: 'Word of your last duel is still spreading.' };
    if (state.duel) return { ok: false, reason: 'A duel is already underway.' };
    const target = duelTarget(state);
    if (!target) return { ok: false, reason: 'There is no one above you.' };

    const mine = playerMight(state);
    const win = duelWindow(mine, target.might);
    state.duel = { rank: target.rank, window: win, speeds: D.DUEL_SPEEDS.slice(), mine, theirs: target.might };
    emit('duel:begin', { rival: target, window: win, mine, theirs: target.might });
    return { ok: true, rival: target, window: win, speeds: D.DUEL_SPEEDS.slice(), mine, theirs: target.might };
  }

  /** `clashWins` is how many of the three clashes the player struck true. */
  function resolveDuel(clashWins) {
    const d = state.duel;
    if (!d) return { ok: false, reason: 'No duel is underway.' };
    state.duel = null;
    state.jianghu.cooldown = D.DUEL_COOLDOWN;
    const target = rival(d.rank);
    const won = clashWins >= Math.ceil(D.DUEL_CLASHES / 2);

    if (!won) {
      state.jianghu.losses += 1;
      state.injury = D.INJURY_DURATION;
      chronicle(`${target.name} puts you on one knee. You will remember the angle of it.`, 'defeat');
      emit('duel:end', { won: false, rival: target });
      checkRecords();
      return { ok: true, won: false, rival: target };
    }

    const climbed = state.jianghu.rank - d.rank;
    state.jianghu.rank = d.rank;
    state.jianghu.wins += 1;
    state.stats.duelsWon += 1;

    const stones = randInt(random, D.DUEL_SPOILS[0], D.DUEL_SPOILS[1]) * (state.realm + 1) * lootMult(state);
    const cores = Math.round(D.DUEL_SPOIL_CORES * lootMult(state));
    state.stones += stones;
    state.cores += cores;

    chronicle(`${target.name} yields. You stand at rank ${d.rank}.`, 'victory');
    emit('duel:end', { won: true, rival: target, stones, cores, rank: d.rank, climbed });
    checkRecords();
    return { ok: true, won: true, rival: target, stones, cores, rank: d.rank, climbed };
  }

  /* --------------------------------------------------------- reincarnation */

  function doReincarnate(forced) {
    const gained = insightGain(state);
    const keptArtifacts = { sword: null, robe: null, ring: null };
    for (const k of Object.keys(state.artifacts)) {
      const a = state.artifacts[k];
      if (a && a.rarity === 'immortal') keptArtifacts[k] = a; // (spec) the soul remembers
    }

    const fresh = defaultState();

    // Carried across lives: insight, sect, jianghu, records, stats, settings,
    // name, best realm, Immortal artifacts, seed.
    fresh.insight = state.insight + gained;
    fresh.sect = state.sect;
    fresh.jianghu = { ...state.jianghu };
    fresh.records = state.records;
    fresh.settings = state.settings;
    fresh.name = state.name;
    fresh.bestRealm = Math.max(state.bestRealm, state.realm);
    fresh.artifacts = keptArtifacts;
    fresh.seed = state.seed;
    fresh.log = state.log;
    fresh.lastSeen = state.lastSeen;
    fresh.stats = { ...state.stats, lifeQi: 0, rebirths: state.stats.rebirths + 1 };

    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);

    chronicle(
      forced
        ? `Rebirth, unasked for. ${gained} Dao Insight carries through the wheel.`
        : `You step into the wheel willingly. ${gained} Dao Insight carries through.`,
      'rebirth',
    );
    emit('rebirth', { gained, forced });
    checkRecords();
    return { ok: true, gained, forced };
  }

  function reincarnate() {
    if (!canReincarnate(state)) {
      return { ok: false, reason: 'Only a nascent soul survives the wheel intact.' };
    }
    return doReincarnate(false);
  }

  /* --------------------------------------------------------------- misc */

  function rename(name) {
    state.name = String(name || '').trim().slice(0, 28) || 'Nameless Wanderer';
    emit('rename', { name: state.name });
    return state.name;
  }

  function hardReset() {
    const fresh = defaultState();
    fresh.seed = Math.floor(random() * 0xffffffff) >>> 0;
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    nameRand = mulberry32(state.seed);
    emit('reset', {});
  }

  return {
    state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
    chronicle,
    tick,
    applyOffline,
    cultivate,
    beginBreakthrough,
    resolveTribulation,
    buyTechnique,
    openMeridian,
    startExpedition,
    completeExpedition,
    brewPill,
    buyShop,
    foundSect,
    recruitDisciple,
    upgradeFacility,
    beginForge,
    resolveForge,
    beginDuel,
    resolveDuel,
    reincarnate,
    rename,
    hardReset,
    viewModel: () => viewModel(state),
  };
}

/* ====================================================================== */
/*  view model — the only thing the renderer and HUD are allowed to read   */
/* ====================================================================== */

export function viewModel(s) {
  const cost = breakthroughCost(s);
  const cap = qiCap(s);
  const tier = D.sectTierIndex(s);
  return {
    name: s.name,
    realm: s.realm,
    realmName: D.REALMS[s.realm].name,
    stage: s.stage,
    stageName: D.STAGE_NAMES[s.stage],
    major: isMajor(s),

    qi: s.qi,
    qiCap: cap,
    qiPerSec: qiPerSecond(s),
    tapPower: tapPower(s),
    breakthroughCost: cost,
    progress: Math.min(1, s.qi / cost),
    capped: atCap(s),
    canBreak: s.qi >= cost && s.deviationCd <= 0 && !isFinalStage(s),
    atSummit: isFinalStage(s),

    age: s.age,
    lifespan: lifespan(s),
    ageFraction: ageFraction(s),
    withered: s.withered,
    injured: s.injury > 0,
    deviation: s.deviationCd,

    herbs: s.herbs, stones: s.stones, cores: s.cores, insight: s.insight,
    arrays: s.arrays, rings: s.rings, talismans: s.talismans, nineTurn: s.nineTurn,
    insightPill: s.insightPill,
    buffs: { qi: s.buffs.qi, tap: s.buffs.tap },

    meridians: s.meridians,
    techniques: Object.fromEntries(D.TECHNIQUES.map((t) => [t.id, techLevel(s, t.id)])),
    mastered: D.masteredCount(s),

    artifacts: s.artifacts,
    expedition: s.expedition ? { ...s.expedition } : null,
    pendingForge: s.pendingForge ? { ...s.pendingForge } : null,
    pendingTrib: s.pendingTrib ? { ...s.pendingTrib } : null,
    duel: s.duel ? { ...s.duel } : null,

    sect: {
      founded: s.sect.founded,
      name: s.sect.name,
      disciples: s.sect.disciples.length,
      capacity: sectCapacity(s),
      roster: s.sect.disciples,
      facilities: { ...s.sect.facilities },
      tierIndex: tier,
      tierName: tier >= 0 ? D.SECT_TIERS[tier].name : null,
      income: sectIncome(s),
    },

    jianghu: {
      rank: s.jianghu.rank,
      wins: s.jianghu.wins,
      losses: s.jianghu.losses,
      cooldown: s.jianghu.cooldown,
      renown: renown(s),
      might: playerMight(s),
      target: duelTarget(s),
    },

    records: s.records,
    recordCount: Object.keys(s.records).length,
    recordBonus: recordBonusPct(s),
    stats: s.stats,
    log: s.log,
    settings: s.settings,

    canReincarnate: canReincarnate(s),
    insightGain: insightGain(s),
    forgeLuck: forgeLuck(s),
    forgeOdds: rarityOdds(forgeLuck(s)),
    offlineRate: offlineRate(s),
    offlineCap: offlineCap(s),
  };
}

/* ====================================================================== */
/*  persistence                                                            */
/* ====================================================================== */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `src` over `base`, keeping `base`'s shape. Arrays are replaced. */
function mergeOver(base, src) {
  if (!isPlainObject(src)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(src)) {
    if (isPlainObject(base[k]) && isPlainObject(src[k])) out[k] = mergeOver(base[k], src[k]);
    else if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/**
 * Read any save this game has ever written — including v0.4 — and return a
 * current-shape state. Unknown fields are dropped; missing fields take defaults.
 */
export function migrate(raw) {
  if (!isPlainObject(raw)) return defaultState();
  const v = Number(raw.version) || 0;
  const src = { ...raw };

  if (v < 5) {
    // v0.4 kept the jianghu ladder flat on the root and used `dao` for insight.
    if (src.dao !== undefined && src.insight === undefined) src.insight = src.dao;
    if (src.rank !== undefined && !isPlainObject(src.jianghu)) {
      src.jianghu = { rank: src.rank, wins: src.wins || 0, losses: src.losses || 0, cooldown: 0 };
    }
    if (src.spiritStones !== undefined && src.stones === undefined) src.stones = src.spiritStones;
    if (src.beastCores !== undefined && src.cores === undefined) src.cores = src.beastCores;
    if (src.achievements !== undefined && src.records === undefined) src.records = src.achievements;
    if (Array.isArray(src.meridians)) src.meridians = src.meridians.filter(Boolean).length;
  }

  const merged = mergeOver(defaultState(), src);
  merged.version = SAVE_VERSION;
  merged.gameVersion = GAME_VERSION;

  // Repair anything a bad save could have poisoned.
  merged.realm = Math.max(0, Math.min(D.REALMS.length - 1, Math.floor(merged.realm) || 0));
  merged.stage = Math.max(0, Math.min(D.STAGE_NAMES.length - 1, Math.floor(merged.stage) || 0));
  merged.meridians = Math.max(0, Math.min(D.MERIDIAN_COUNT, Math.floor(merged.meridians) || 0));
  merged.qi = Number.isFinite(merged.qi) ? Math.max(0, merged.qi) : 0;
  merged.age = Number.isFinite(merged.age) ? Math.max(0, merged.age) : D.START_AGE;
  merged.bestRealm = Math.max(merged.bestRealm || 0, merged.realm);
  merged.jianghu.rank = Math.max(1, Math.min(D.LADDER_SIZE + 1, Math.floor(merged.jianghu.rank) || D.LADDER_SIZE + 1));
  if (!Array.isArray(merged.sect.disciples)) merged.sect.disciples = [];
  if (!Array.isArray(merged.log)) merged.log = [];
  for (const t of D.TECHNIQUES) {
    const lvl = Math.floor(merged.techniques[t.id] || 0);
    if (lvl > 0) merged.techniques[t.id] = Math.min(t.cap, lvl);
    else delete merged.techniques[t.id];
  }
  merged.qi = Math.min(merged.qi, qiCap(merged));
  return merged;
}

/* -------------------------------------------------- base64, both runtimes */

function utf8ToBase64(str) {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  return Buffer.from(str, 'utf8').toString('base64');
}

function base64ToUtf8(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function exportSave(state) {
  return utf8ToBase64(JSON.stringify(state));
}

export function importSave(text) {
  const json = JSON.parse(base64ToUtf8(String(text).trim()));
  return migrate(json);
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export { D as data };
