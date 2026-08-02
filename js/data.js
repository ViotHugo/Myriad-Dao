// Myriad Dao — balance tables.
//
// Every number the designer tuned lives here. The engine reads this module and
// nothing else; the renderer never touches it. Values marked (spec) come
// verbatim from the v0.4 feature inventory and must not drift without re-running
// tools/balance-sim.js.

/* ------------------------------------------------------------------ realms */

export const STAGE_NAMES = ['Early', 'Mid', 'Late', 'Peak'];

// (spec) A2 — eight realms x four stages.
export const REALMS = [
  { key: 'body',        name: 'Body Tempering',           mult: 1,      base: 50,     lifespan: 100 },
  { key: 'condense',    name: 'Qi Condensation',          mult: 7,      base: 4e3,    lifespan: 200 },
  { key: 'foundation',  name: 'Foundation Establishment', mult: 50,     base: 4e5,    lifespan: 400 },
  { key: 'core',        name: 'Core Formation',           mult: 400,    base: 6e7,    lifespan: 800 },
  { key: 'nascent',     name: 'Nascent Soul',             mult: 3200,   base: 1.5e10, lifespan: 1600 },
  { key: 'severing',    name: 'Spirit Severing',          mult: 2.6e4,  base: 6e12,   lifespan: 3200 },
  { key: 'daoseek',     name: 'Dao Seeking',              mult: 2.1e5,  base: 8e15,   lifespan: 6400 },
  { key: 'immortal',    name: 'Immortal Ascension',       mult: 1.7e6,  base: 1.6e19, lifespan: Infinity },
];

export const STAGE_COST_GROWTH = 2.8;   // (spec) stage costs x2.8
export const MAJOR_COST_MULT   = 2;     // (spec) a realm breakthrough costs double
export const STAGE_BONUS       = 1.25;  // (spec) 1.25^stage qi/s
export const QI_CAP_MULT       = 1.6;   // (spec) qi hard-capped at 1.6x next cost
export const TAP_SECONDS       = 0.4;   // (spec) a tap grants 0.4s of qi/s
export const MERIDIAN_BONUS    = 1.15;  // (spec) +15% qi/s each
export const MERIDIAN_BASE     = 500;   // (spec) cost 500 * 7^n
export const MERIDIAN_GROWTH   = 7;
export const MERIDIAN_COUNT    = 12;

/* ------------------------------------------------------- heavenly tribulation */

export const TRIB = {
  baseChance: 0.92,       // (spec) 92% - 6%/realm
  perRealm: -0.06,
  talisman: 0.10,         // (spec) +10% talisman
  insightPill: 0.15,      // (spec) +15% Pill of Insight
  minChance: 0.15,
  maxChance: 0.95,
  baseSpeed: 3.2,         // (spec) 3.2 + 0.35*realm rad/s
  speedPerRealm: 0.35,
  failQiLoss: 0.15,       // (spec) lose 15% of current qi
  failCooldown: 10,       // (spec) 10s meridian cooldown
};

/* -------------------------------------------------------------- techniques */

// (spec) A3 — ten manuals, capped. Base costs are ours (the inventory fixes only
// growth 1.9-2.6, the per-level effect, the realm gate and the cap); they are
// tuned against tools/balance-sim.js to hit the A18 pacing table.
export const TECHNIQUES = [
  { id: 'azure',    name: 'Azure Breath Method',          type: 'qi',      per: 0.25, realm: 0, cap: 12, base: 60,     growth: 2.00,
    flavor: 'Draw the dawn air through a hollow chest.' },
  { id: 'iron',     name: 'Iron Body Manual',             type: 'tap',     per: 0.30, realm: 0, cap: 6,  base: 150,     growth: 2.20,
    flavor: 'Strike the body until the body strikes back.' },
  { id: 'river',    name: 'Flowing River Qi Art',         type: 'qi',      per: 0.40, realm: 1, cap: 10, base: 1.8e4,  growth: 2.10,
    flavor: 'Water yields, and so wears the mountain down.' },
  { id: 'jade',     name: 'Jade Bone Tempering',          type: 'tap',     per: 0.60, realm: 1, cap: 6,  base: 3e4,  growth: 2.30,
    flavor: 'Marrow to jade, jade to something colder.' },
  { id: 'leaves',   name: 'Thousand Leaves Sword Intent', type: 'qi',      per: 0.60, realm: 2, cap: 10, base: 2.2e6,  growth: 2.30,
    flavor: 'One leaf falls. A thousand follow the same line.' },
  { id: 'turtle',   name: 'Turtle Breath Sutra',          type: 'offline', per: 0.10, realm: 2, cap: 5,  base: 2.4e6,  growth: 2.60,
    flavor: 'Breathe once a season and outlive the season.' },
  { id: 'golden',   name: 'Golden Core Resonance',        type: 'qi',      per: 0.80, realm: 3, cap: 10, base: 6e8,    growth: 2.40,
    flavor: 'The core hums. The world hums back.' },
  { id: 'soul',     name: 'Soul Whisper Art',             type: 'qi',      per: 1.00, realm: 4, cap: 10, base: 3e11,   growth: 2.45,
    flavor: 'Speak without a mouth; be heard without an ear.' },
  { id: 'severing', name: 'Heaven Severing Blade',        type: 'qi',      per: 1.20, realm: 5, cap: 10, base: 1.5e14,   growth: 2.60,
    flavor: 'Cut the tie between yourself and the sky.' },
  { id: 'clarity',  name: 'Dao Heart Clarity',            type: 'break',   per: 0.02, realm: 6, cap: 10, base: 3.5e16, growth: 2.50,
    flavor: 'A still heart does not flinch at thunder.' },
];

export const TECHNIQUE_BY_ID = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));

/* --------------------------------------------------------------- meridians */

// (spec) A4 — the twelve classical meridians.
export const MERIDIANS = [
  'Hand Taiyin Lung', 'Hand Yangming Large Intestine', 'Foot Yangming Stomach',
  'Foot Taiyin Spleen', 'Hand Shaoyin Heart', 'Hand Taiyang Small Intestine',
  'Foot Taiyang Bladder', 'Foot Shaoyin Kidney', 'Hand Jueyin Pericardium',
  'Hand Shaoyang Triple Burner', 'Foot Shaoyang Gallbladder', 'Foot Jueyin Liver',
];

/* -------------------------------------------------------------- expeditions */

// (spec) A5 — herb/stone yields scale x(realm+1); core drops do not.
export const EXPEDITIONS = [
  { id: 'herbs',  name: 'Gather Spirit Herbs',  duration: 60,   herbs: [3, 6],   stones: [3, 6],     cores: [0, 0],
    flavor: 'The near slopes, at first light.' },
  { id: 'beasts', name: 'Hunt Demonic Beasts',  duration: 600,  herbs: [8, 15],  stones: [30, 55],   cores: [2, 4],
    flavor: 'Something in the pine forest is still hungry.' },
  { id: 'ruins',  name: 'Explore Ancient Ruins', duration: 3600, herbs: [45, 80], stones: [300, 520], cores: [14, 22],
    flavor: 'A sect died here. Its storehouse did not.' },
];

/* ------------------------------------------------------------------ alchemy */

// (spec) A6 — buffs stack up to 30 minutes.
export const BUFF_STACK_CAP = 1800;

export const PILLS = [
  { id: 'qi',      name: 'Qi Gathering Pill',     herbs: 5,   effect: 'qi',
    desc: '2× Qi/s for 10 minutes.', duration: 600 },
  { id: 'marrow',  name: 'Marrow Cleansing Pill', herbs: 12,  effect: 'tap',
    desc: '3× cultivate power for 10 minutes.', duration: 600 },
  { id: 'insight', name: 'Pill of Insight',       herbs: 30,  effect: 'insight',
    desc: '+15% on your next breakthrough. Only one may be held.' },
  { id: 'nineturn', name: 'Nine-Turn Immortal Pill', herbs: 120, growth: 1.5, effect: 'permanent',
    desc: '+2% Qi/s, permanently. Cost rises ×1.5 each.' },
];

export const PILL_BY_ID = Object.fromEntries(PILLS.map((p) => [p.id, p]));
export const QI_PILL_MULT = 2;      // (spec)
export const MARROW_MULT = 3;       // (spec)
export const NINE_TURN_BONUS = 0.02; // (spec)

/* --------------------------------------------------------- treasure pavilion */

// (spec) A7
export const SHOP = {
  array:    { id: 'array',    name: 'Spirit Gathering Array', base: 50,  growth: 4, per: 0.5,
    desc: '+50% Qi/s per tier. Stones set into the earth, drinking the ley line.' },
  ring:     { id: 'ring',     name: 'Storage Ring',           base: 100, growth: 3, per: 4,
    desc: '+4h of closed-door cultivation per ring.' },
  talisman: { id: 'talisman', name: 'Breakthrough Talisman',  base: 75,  growth: 1, per: 0.10,
    desc: '+10% success on one tribulation. Consumed on use.' },
};

/* ------------------------------------------------------------- age & death */

export const YEAR_SECONDS = 1800;   // (spec) 1 year per 30 real minutes
export const START_AGE = 16;        // (spec)
export const AGE_WARN = 0.8;        // (spec) warning at 80% of lifespan
export const WITHER_MULT = 0.35;    // (spec) qi/s x0.35 while withered
export const NASCENT_SOUL_REALM = 4; // (spec) at or above this, death forces rebirth

/* ------------------------------------------------------------------- sect */

export const SECT_REALM = 3;        // (spec) unlock: Core Formation
export const SECT_FOUND_COST = 200; // (spec) 200 spirit stones

// (spec) A9 — blind talent roll.
export const DISCIPLE_TIERS = [
  { key: 'outer',  name: 'Outer Disciple',  chance: 0.65, rate: 0.5 },
  { key: 'inner',  name: 'Inner Disciple',  chance: 0.30, rate: 2.0 },
  { key: 'chosen', name: "Heaven's Chosen", chance: 0.05, rate: 8.0 },
];

export const RECRUIT_BASE = 100;
export const RECRUIT_GROWTH = 1.5;
export const SECT_BASE_CAPACITY = 2;   // (spec) capacity 2 + 2/Sect Hall level
export const SECT_CAPACITY_PER_LEVEL = 2;

export const FACILITIES = [
  { id: 'hall',     name: 'Sect Hall',          base: 150, growth: 1.75,
    desc: '+2 disciple capacity per level.' },
  { id: 'garden',   name: 'Herb Garden',        base: 120, growth: 1.75,
    desc: 'Passive spirit herbs, delivered day and night.' },
  { id: 'mine',     name: 'Spirit Stone Mine',  base: 120, growth: 1.75,
    desc: 'Passive spirit stones from the deep seam.' },
  { id: 'training', name: 'Training Grounds',   base: 200, growth: 1.75,
    desc: '+25% disciple output per level.' },
  { id: 'pavilion', name: 'Scripture Pavilion', base: 300, growth: 1.75,
    desc: '+10% Qi/s per level.' },
  { id: 'forge',    name: "Forgemaster's Hall", base: 250, growth: 1.75,
    desc: '+2 forging luck per level.' },
];

export const FACILITY_BY_ID = Object.fromEntries(FACILITIES.map((f) => [f.id, f]));

export const GARDEN_HERBS_PER_MIN = 0.5;  // per level, before scaling
export const MINE_STONES_PER_MIN = 1.0;   // per level, before scaling
export const TRAINING_BONUS = 0.25;       // (spec) +25% disciple output/level
export const PAVILION_BONUS = 0.10;       // (spec) +10% qi/s per level
export const FORGE_LUCK_PER_LEVEL = 2;    // (spec) +2 forging luck/level

// (spec) five tiers by total facility levels 0/6/12/20/30.
export const SECT_TIERS = [
  { min: 0,  name: 'Humble Courtyard' },
  { min: 6,  name: 'Rising Sect' },
  { min: 12, name: 'Renowned Sect' },
  { min: 20, name: 'Grand Sect' },
  { min: 30, name: 'Immortal Orthodoxy' },
];

/* ------------------------------------------------------------------- forge */

export const FORGE_REALM = 2;          // (spec) unlock: Foundation Establishment
export const FORGE_CORE_COST = 6;      // (spec) 6 beast cores
export const FORGE_STONE_BASE = 120;   // (spec) 120 * (realm+1) spirit stones
export const SALVAGE_CORES = 2;        // (spec) replaced piece salvages for 2 cores

export const SLOTS = [
  { id: 'sword', name: 'Sword', icon: '🗡', base: 12, stat: 'cultivate power',
    nouns: ['Edge', 'Blade', 'Sabre', 'Longsword', 'Fang', 'Sliver'] },
  { id: 'robe',  name: 'Robe',  icon: '🥋', base: 8,  stat: 'Qi/s',
    nouns: ['Vestment', 'Robe', 'Mantle', 'Silks', 'Raiment', 'Shroud'] },
  { id: 'ring',  name: 'Ring',  icon: '💍', base: 10, stat: 'loot from every source',
    nouns: ['Ring', 'Band', 'Circlet', 'Loop', 'Seal', 'Coil'] },
];

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

// (spec) A10 — weights are the luck-0 percentages.
export const RARITIES = [
  { key: 'mortal',   name: 'Mortal',   weight: 50, mult: 1,    color: '#8e9099',
    prefixes: ['Iron', 'Ash', 'Plain', 'Weathered', 'Coarse', 'Riverstone'] },
  { key: 'spirit',   name: 'Spirit',   weight: 30, mult: 2.2,  color: '#35c98e',
    prefixes: ['Cloud-Threaded', 'Jade', 'Whispering', 'Moonlit', 'Verdant', 'Mistborn'] },
  { key: 'earth',    name: 'Earth',    weight: 14, mult: 4.5,  color: '#4aa3e0',
    prefixes: ['Stone-Rooted', 'Thunder-Veined', 'Abyssal', 'Mountain-Bound', 'Emberheart', 'Deepvein'] },
  { key: 'heaven',   name: 'Heaven',   weight: 5,  mult: 9,    color: '#b07ae8',
    prefixes: ['Star-Fallen', 'Void-Touched', 'Phoenix', 'Dragonbone', 'Silver-Sky', 'Stormcalling'] },
  { key: 'immortal', name: 'Immortal', weight: 1,  mult: 18,   color: '#e8b34b',
    prefixes: ['Sun-Devouring', 'Dao-Severing', 'Eternal', 'Heaven-Defying', 'Origin', 'World-Ending'] },
];

export const LUCK_TILT = 0.09;        // (spec) weight * (1 + 0.09*luck)^tier
export const FORGE_REALM_SCALE = 0.35; // (spec) power * (1 + 0.35 * forge realm)

/* ---------------------------------------------------- rivers & lakes (duels) */

export const DUEL_REALM = 1;          // (spec) unlock: Qi Condensation
export const LADDER_SIZE = 100;       // (spec) 100 rivals
export const LADDER_BASE_MIGHT = 25;  // (spec) 25 * 1.37^(100-rank)
export const LADDER_GROWTH = 1.37;
export const DUEL_COOLDOWN = 600;     // (spec) every 10 minutes
export const DUEL_CLASHES = 3;        // (spec) best-of-three
export const DUEL_SPEEDS = [3.6, 4.2, 4.8]; // (spec) clash speed rises each round
export const DUEL_MIN_WINDOW = 0.08;  // (spec) clamped 8-80%
export const DUEL_MAX_WINDOW = 0.80;
export const DUEL_SPOILS = [60, 110]; // (spec) 60-110 * (realm+1) stones
export const DUEL_SPOIL_CORES = 2;
export const INJURY_DURATION = 90;    // (spec) -20% qi/s for 90s
export const INJURY_MULT = 0.8;
export const MAX_RENOWN = 99;         // (spec) up to +99%

export const RIVAL_EPITHETS = [
  'Sleeping Dragon', 'Iron Crane', 'Blood Lotus', 'Silent Thunder', 'White Fox',
  'Cloud Piercer', 'Broken Sabre', 'Laughing Ghost', 'Frost Willow', 'Nine-Tailed',
  'Ash Wanderer', 'Golden Roc', 'Bitter Rain', 'Stone Monk', 'Crimson Moth',
  'Half-Blind', 'Wine Immortal', 'Thousand Hands', 'Green Serpent', 'Falling Star',
  'Bone Flute', 'Shadow Heron', 'Twin Sabres', 'Cold Peak', 'Hungry Tiger',
];
export const RIVAL_FAMILIES = [
  'Bai', 'Li', 'Chen', 'Xu', 'Wei', 'Han', 'Mo', 'Lin', 'Yun', 'Feng',
  'Su', 'Gu', 'Jiang', 'Shen', 'Tang', 'Qin', 'Zhao', 'Yan', 'Duan', 'Xiao',
];
export const RIVAL_GIVEN = [
  'Ruo', 'Wuji', 'Qingyan', 'Shuang', 'Yinghao', 'Lanting', 'Zhen', 'Muyan',
  'Xuefeng', 'Jinghong', 'Anran', 'Chenxi', 'Liuyun', 'Zishu', 'Hanyu',
  'Yuwen', 'Beichen', 'Sanniang', 'Qiyue', 'Wangchuan',
];

export const DISCIPLE_FAMILIES = RIVAL_FAMILIES;
export const DISCIPLE_GIVEN = [
  'Xiaoyu', 'Anlin', 'Shitou', 'Wenqing', 'Erniu', 'Yaya', 'Changqing', 'Ping',
  'Jinlan', 'Xiaobei', 'Tiezhu', 'Ruyi', 'Hexuan', 'Dabao', 'Qingqing',
  'Youliang', 'Meixue', 'Zhuang', 'Lianhua', 'Shanshan',
];

/* --------------------------------------------------------- reincarnation */

export const REBIRTH_REALM = 4;      // (spec) unlock: Nascent Soul
export const INSIGHT_REALM_BONUS = 6; // (spec) (realm - 3) * 6
export const INSIGHT_REALM_FLOOR = 3;
export const INSIGHT_QI_DIVISOR = 1e9; // (spec) floor((lifetime qi / 1e9)^0.32)
export const INSIGHT_QI_EXP = 0.32;
export const INSIGHT_BONUS = 0.10;    // (spec) each insight = +10% qi/s

/* ------------------------------------------------------------------ offline */

export const OFFLINE_BASE_RATE = 0.5;  // (spec) 50% of qi/s
export const OFFLINE_RATE_PER_TURTLE = 0.10;
export const OFFLINE_MAX_RATE = 1.0;
export const OFFLINE_BASE_CAP = 8 * 3600; // (spec) up to 8h
export const OFFLINE_CAP_PER_RING = 4 * 3600;

/* -------------------------------------------------------------- dao records */

// (spec) A12 — 35 achievements, +2..6% qi/s each, summing to exactly +100%.
export const RECORDS = [
  // reaching each of the 7 realms
  { id: 'realm1', name: 'Qi Condensation',   bonus: 2, hint: 'Reach Qi Condensation.',          check: (s) => s.bestRealm >= 1 },
  { id: 'realm2', name: 'Foundation Laid',   bonus: 2, hint: 'Reach Foundation Establishment.', check: (s) => s.bestRealm >= 2 },
  { id: 'realm3', name: 'Core Formed',       bonus: 2, hint: 'Reach Core Formation.',           check: (s) => s.bestRealm >= 3 },
  { id: 'realm4', name: 'Soul Born',         bonus: 3, hint: 'Reach Nascent Soul.',             check: (s) => s.bestRealm >= 4 },
  { id: 'realm5', name: 'Spirit Severed',    bonus: 4, hint: 'Reach Spirit Severing.',          check: (s) => s.bestRealm >= 5 },
  { id: 'realm6', name: 'Seeker of the Dao', bonus: 5, hint: 'Reach Dao Seeking.',              check: (s) => s.bestRealm >= 6 },
  { id: 'realm7', name: 'Immortal Ascension', bonus: 6, hint: 'Reach Immortal Ascension.',      check: (s) => s.bestRealm >= 7 },
  // tapping
  { id: 'tap1k',  name: 'Diligent Hand',     bonus: 2, hint: 'Cultivate 1,000 times.',   check: (s) => s.stats.taps >= 1000 },
  { id: 'tap25k', name: 'Ten Thousand Days', bonus: 2, hint: 'Cultivate 25,000 times.',  check: (s) => s.stats.taps >= 25000 },
  // meridians
  { id: 'mer6',   name: 'Six Gates Open',    bonus: 2, hint: 'Open 6 meridians.',        check: (s) => s.meridians >= 6 },
  { id: 'mer12',  name: 'Twelve Gates Open', bonus: 3, hint: 'Open all 12 meridians.',   check: (s) => s.meridians >= 12 },
  // technique mastery
  { id: 'mast1',  name: 'First Mastery',     bonus: 2, hint: 'Master 1 technique to its cap.',  check: (s) => masteredCount(s) >= 1 },
  { id: 'mast5',  name: 'Five Manuals',      bonus: 2, hint: 'Master 5 techniques.',            check: (s) => masteredCount(s) >= 5 },
  { id: 'mast10', name: 'The Whole Library', bonus: 4, hint: 'Master all 10 techniques.',       check: (s) => masteredCount(s) >= 10 },
  // pills
  { id: 'pill10',  name: 'Apprentice Alchemist', bonus: 2, hint: 'Refine 10 pills.',   check: (s) => s.stats.pills >= 10 },
  { id: 'pill100', name: 'Master of the Furnace', bonus: 2, hint: 'Refine 100 pills.', check: (s) => s.stats.pills >= 100 },
  // expeditions
  { id: 'exp10',  name: 'Well-Travelled',    bonus: 2, hint: 'Complete 10 expeditions.',  check: (s) => s.stats.expeditions >= 10 },
  { id: 'exp100', name: 'Ten Thousand Li',   bonus: 2, hint: 'Complete 100 expeditions.', check: (s) => s.stats.expeditions >= 100 },
  // forging
  { id: 'forge1',   name: 'First Flame',      bonus: 2, hint: 'Forge your first artifact.',      check: (s) => s.stats.forges >= 1 },
  { id: 'forgeHv',  name: 'Heaven in Hand',   bonus: 3, hint: 'Forge a Heaven-grade artifact.',  check: (s) => rarityIndex(s.stats.bestRarity) >= 3 },
  { id: 'forgeImm', name: 'Immortal Work',    bonus: 4, hint: 'Forge an Immortal-grade artifact.', check: (s) => rarityIndex(s.stats.bestRarity) >= 4 },
  { id: 'salv10',   name: 'Nothing Wasted',   bonus: 2, hint: 'Salvage 10 artifacts.',           check: (s) => s.stats.salvages >= 10 },
  // sect
  { id: 'sect1',    name: 'A Roof and a Name', bonus: 2, hint: 'Found a sect.',                  check: (s) => s.sect.founded },
  { id: 'sect10',   name: 'Ten Disciples',     bonus: 2, hint: 'Gather 10 disciples.',           check: (s) => s.sect.disciples.length >= 10 },
  { id: 'sectChosen', name: "Heaven's Chosen", bonus: 4, hint: "Recruit a Heaven's Chosen.",     check: (s) => s.stats.chosen >= 1 },
  { id: 'sectRenown', name: 'Renowned Sect',   bonus: 3, hint: 'Raise the sect to Renowned.',    check: (s) => sectTierIndex(s) >= 2 },
  // duels
  { id: 'duel1',   name: 'First Blood',       bonus: 2, hint: 'Win a duel.',            check: (s) => s.stats.duelsWon >= 1 },
  { id: 'rank50',  name: 'Named in Taverns',  bonus: 3, hint: 'Reach rank 50.',         check: (s) => s.jianghu.rank <= 50 },
  { id: 'rank10',  name: 'Feared on the Road', bonus: 4, hint: 'Reach rank 10.',        check: (s) => s.jianghu.rank <= 10 },
  { id: 'rank1',   name: 'First Under Heaven', bonus: 5, hint: 'Take rank 1.',          check: (s) => s.jianghu.rank <= 1 },
  // rebirths
  { id: 'reb1',   name: 'The Wheel Turns',   bonus: 2, hint: 'Reincarnate once.',       check: (s) => s.stats.rebirths >= 1 },
  { id: 'reb5',   name: 'Five Lives Deep',   bonus: 3, hint: 'Reincarnate five times.', check: (s) => s.stats.rebirths >= 5 },
  // lifetime qi
  { id: 'qi1e12', name: 'A Sea of Qi',       bonus: 2, hint: 'Gather 1T qi in total.',   check: (s) => s.stats.allTimeQi >= 1e12 },
  { id: 'qi1e15', name: 'An Ocean of Qi',    bonus: 4, hint: 'Gather 1Qa qi in total.',  check: (s) => s.stats.allTimeQi >= 1e15 },
  // the special one
  { id: 'withered', name: "Spat in Death's Eye", bonus: 4, hint: 'Break through while withered.', check: (s) => s.stats.witheredCured >= 1 },
];

export const RECORD_BY_ID = Object.fromEntries(RECORDS.map((r) => [r.id, r]));

/** How many manuals stand at their mastery cap. Derived, never stored. */
export function masteredCount(s) {
  let n = 0;
  for (const t of TECHNIQUES) if ((s.techniques[t.id] || 0) >= t.cap) n++;
  return n;
}

export function rarityIndex(key) {
  const i = RARITIES.findIndex((r) => r.key === key);
  return i;
}

export function sectTierIndex(s) {
  if (!s.sect.founded) return -1;
  const total = FACILITIES.reduce((n, f) => n + (s.sect.facilities[f.id] || 0), 0);
  let idx = 0;
  for (let i = 0; i < SECT_TIERS.length; i++) if (total >= SECT_TIERS[i].min) idx = i;
  return idx;
}

/* --------------------------------------------------------------- chronicles */

export const OPENING_LINES = [
  'You wake on a cold mountain with nothing but a name.',
  'The air here is thin, and something in it is worth breathing.',
];
