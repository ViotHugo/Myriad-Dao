// The HUD.
//
// Stays DOM/CSS over the canvas: text renders better, it is accessible, and it
// costs no draw calls. This module reads the engine's view model and calls
// engine actions; it never touches state, and it never decides a rule.

import * as E from './engine.js';
import * as D from './data.js';
import { fmt, fmtTime, fmtYears, fmtPct } from './format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const TAB_FRAMING = { cultivate: 'world', arts: 'close', alchemy: 'world', journey: 'world', sect: 'sect' };

export function createUI({ game, view, audio, storage, onQuality }) {
  const el = {
    hud: $('#hud'), name: $('#playerName'), realm: $('#realmLine'), rate: $('#qiRate'),
    qibar: $('#qibar'), qiFill: $('#qiFill'), qiText: $('#qiText'), purse: $('#purse'),
    status: $('#statusStrip'), floaters: $('#floaters'),
    sheet: $('#sheet'), sheetBody: $('#sheetBody'),
    pad: $('#cultivatePad'), buffs: $('#buffStrip'), breakBtn: $('#breakBtn'), hint: $('#hint'),
    padLinks: $('#padLinks'),
    tabs: $('#tabs'), overlay: $('#overlay'), modal: $('#modal'), toasts: $('#toasts'),
    boot: $('#boot'),
  };

  let tab = 'cultivate';
  let vm = game.viewModel();
  let duelRun = null;
  let tribRun = null;
  let cinematic = false;

  /**
   * A set piece owns the screen. Without this the forge reveal plays behind its
   * own modal scrim and the duel arena plays behind the Journey sheet — the two
   * moments the game most wants you to look at were the two you could not see.
   */
  function setCinematic(on) {
    cinematic = on;
    el.sheet.hidden = on || tab === 'cultivate';
    el.pad.hidden = on;
    el.tabs.classList.toggle('is-dimmed', on);
    if (!on) renderSheet(true);
  }

  /* ------------------------------------------------------------- helpers */

  function toast(text, kind = '') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    el.toasts.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function floatText(text, gold = false) {
    const p = view.project(view.tapAnchor);
    if (!p.visible) return;
    const node = document.createElement('div');
    node.className = `floater${gold ? ' gold' : ''}`;
    node.textContent = text;
    node.style.left = `${p.x + (Math.random() - 0.5) * 48}px`;
    node.style.top = `${p.y + (Math.random() - 0.5) * 24}px`;
    el.floaters.appendChild(node);
    setTimeout(() => node.remove(), 1200);
  }

  const canAfford = (have, cost) => have >= cost - 1e-9;

  /* -------------------------------------------------------------- header */

  function renderHeader() {
    el.name.textContent = vm.name;
    el.realm.textContent = `${vm.stageName} ${vm.realmName}`;
    el.rate.textContent = `${fmt(vm.qiPerSec)} Qi/s`;
    el.qiFill.style.width = `${Math.min(100, vm.progress * 100)}%`;
    el.qiText.textContent = `${fmt(vm.qi)} / ${fmt(vm.breakthroughCost)}`;
    el.qibar.classList.toggle('is-capped', vm.capped);

    const bits = [];
    if (vm.insight > 0) bits.push(`<b>☸ ${fmt(vm.insight)}</b> Insight`);
    bits.push(`<b>🌿 ${fmt(vm.herbs)}</b>`);
    bits.push(`<b>🪙 ${fmt(vm.stones)}</b>`);
    bits.push(`<b>💠 ${fmt(vm.cores)}</b>`);
    bits.push(`<b>${fmtYears(vm.age)}</b> yrs${vm.lifespan === Infinity ? '' : ` / ${fmtYears(vm.lifespan)}`}`);
    el.purse.innerHTML = bits.join('');

    const chips = [];
    if (vm.capped) chips.push(['warn', 'Qi at the bottleneck — break through']);
    if (vm.withered) chips.push(['bad', 'Withered — Qi/s ×0.35 until a realm breakthrough']);
    else if (vm.lifespan !== Infinity && vm.ageFraction >= 0.8) {
      chips.push(['warn', `Your years grow short (${fmtPct(vm.ageFraction)} spent)`]);
    }
    if (vm.injured) chips.push(['bad', 'Injured — Qi/s ×0.8']);
    if (vm.deviation > 0) chips.push(['bad', `Qi deviation — ${fmtTime(vm.deviation)}`]);
    if (vm.expedition) {
      const e = D.EXPEDITIONS.find((x) => x.id === vm.expedition.id);
      chips.push(['', `${e.name} — ${fmtTime(vm.expedition.remaining)}`]);
    }
    if (vm.jianghu.rank <= D.LADDER_SIZE) chips.push(['good', `Jianghu rank ${vm.jianghu.rank} · +${vm.jianghu.renown}% renown`]);
    el.status.innerHTML = chips.map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join('');
  }

  let lastPadLinks = null;
  let lastBuffs = null;

  function renderPad() {
    const buffs = [];
    if (vm.buffs.qi > 0) buffs.push(`<span class="buff">2× Qi/s · ${fmtTime(vm.buffs.qi)}</span>`);
    if (vm.buffs.tap > 0) buffs.push(`<span class="buff">3× Cultivate · ${fmtTime(vm.buffs.tap)}</span>`);
    if (vm.insightPill) buffs.push('<span class="buff gold">Pill of Insight held</span>');
    if (vm.talismans > 0) buffs.push(`<span class="buff gold">Talisman ×${vm.talismans}</span>`);
    const buffHtml = buffs.join('');
    if (buffHtml !== lastBuffs) { el.buffs.innerHTML = buffHtml; lastBuffs = buffHtml; }

    // A minigame owns the screen and the tap: nothing else may compete for
    // either, or the player breaks through instead of striking.
    const minigameActive = !!tribRun || !!duelRun || cinematic;
    el.pad.hidden = minigameActive;
    const ready = vm.canBreak;
    el.breakBtn.hidden = tab !== 'cultivate' || minigameActive;
    el.breakBtn.disabled = !ready;
    el.breakBtn.classList.toggle('major', vm.major && !vm.atSummit);
    if (vm.atSummit) {
      el.breakBtn.innerHTML = 'The summit<small>Nothing stands above Immortal Ascension. Turn the wheel.</small>';
    } else if (vm.major) {
      const chance = E.tribulationChance(game.state);
      el.breakBtn.innerHTML = `Face the Heavenly Tribulation<small>${fmt(vm.breakthroughCost)} Qi · ${fmtPct(chance)} to endure</small>`;
    } else {
      el.breakBtn.innerHTML = `Break through<small>${fmt(vm.breakthroughCost)} Qi · to ${D.STAGE_NAMES[vm.stage + 1]} ${vm.realmName}</small>`;
    }
    el.hint.hidden = tab !== 'cultivate' || minigameActive;

    el.padLinks.hidden = tab !== 'cultivate' || minigameActive;
    if (!el.padLinks.hidden) {
      // renderPad runs four times a second. Rewriting innerHTML unconditionally
      // would detach whichever button is under the player's thumb.
      const html =
        `<button class="pad-link" data-action="records">☰ Dao Records ${vm.recordCount}/35 · +${vm.recordBonus}%</button>` +
        `<button class="pad-link" data-action="chronicles">Chronicles</button>`;
      if (html !== lastPadLinks) { el.padLinks.innerHTML = html; lastPadLinks = html; }
    }
    el.hint.textContent = vm.atSummit
      ? 'You have gone as far as this life goes.'
      : vm.capped
        ? 'The Qi will hold no more. Something has to give.'
        : 'Tap the mountain to gather Qi.';
  }

  /* ----------------------------------------------------------- tab bodies */

  function techniquesHTML() {
    const rows = D.TECHNIQUES.map((t) => {
      const lvl = vm.techniques[t.id] || 0;
      const locked = vm.realm < t.realm;
      const maxed = lvl >= t.cap;
      const cost = E.techCost(game.state, t.id);
      const effect = t.type === 'qi' ? `+${t.per * 100}% Qi/s`
        : t.type === 'tap' ? `+${t.per * 100}% cultivate power`
          : t.type === 'offline' ? `+${t.per * 100}% closed-door rate`
            : `+${t.per * 100}% breakthrough odds`;
      return `<div class="card${locked ? ' locked' : ''}">
        <div class="card-head">
          <span class="card-title">${esc(t.name)}</span>
          <span class="card-meta">${lvl} / ${t.cap}</span>
        </div>
        <p class="card-desc">${effect} per level.</p>
        <p class="card-flavor">${esc(t.flavor)}</p>
        <div class="bar"><i style="width:${(lvl / t.cap) * 100}%"></i></div>
        <div class="card-actions">
          <button class="act" data-action="tech" data-id="${t.id}"
            data-cost="${cost}" data-cur="qi" data-lock="${locked || maxed ? 1 : 0}"
            ${locked || maxed || !canAfford(vm.qi, cost) ? 'disabled' : ''}>
            ${locked ? `Requires ${D.REALMS[t.realm].name}` : maxed ? 'Mastered' : `Study · ${fmt(cost)} Qi`}
          </button>
        </div>
      </div>`;
    }).join('');

    const cells = D.MERIDIANS.map((name, i) => {
      const open = i < vm.meridians;
      return `<div class="meridian${open ? ' open' : ''}">${esc(name.replace(/^(Hand|Foot) \w+ /, ''))}</div>`;
    }).join('');
    const mCost = E.meridianCost(game.state);
    const mDone = vm.meridians >= D.MERIDIAN_COUNT;

    return `<h2 class="section">Manuals</h2>${rows}
      <h2 class="section">The Twelve Meridians · ${vm.meridians}/12</h2>
      <div class="card">
        <p class="card-desc">Each channel opened multiplies your Qi/s by 1.15, for the rest of this life.</p>
        <div class="grid-12">${cells}</div>
        <div class="card-actions">
          <button class="act" data-action="meridian"
            data-cost="${mCost}" data-cur="qi" data-lock="${mDone || vm.deviation > 0 ? 1 : 0}"
            ${mDone || !canAfford(vm.qi, mCost) || vm.deviation > 0 ? 'disabled' : ''}>
            ${mDone ? 'All twelve stand open' : `Open the ${esc(D.MERIDIANS[vm.meridians])} · ${fmt(mCost)} Qi`}
          </button>
        </div>
      </div>`;
  }

  function alchemyHTML() {
    if (vm.realm < D.FORGE_REALM) {
      return `<p class="empty">The pill furnace is beyond you.<br>Reach <b>${D.REALMS[D.FORGE_REALM].name}</b> to light it.</p>`;
    }
    const rows = D.PILLS.map((p) => {
      const cost = E.pillCost(game.state, p.id);
      const blocked = p.id === 'insight' && vm.insightPill;
      return `<div class="card">
        <div class="card-head">
          <span class="card-title">${esc(p.name)}</span>
          <span class="card-meta">🌿 ${fmt(cost)}</span>
        </div>
        <p class="card-desc">${esc(p.desc)}</p>
        ${p.id === 'nineturn' ? `<p class="card-flavor">${vm.nineTurn} taken in this body · +${vm.nineTurn * 2}% Qi/s</p>` : ''}
        <div class="card-actions">
          <button class="act" data-action="pill" data-id="${p.id}"
            data-cost="${cost}" data-cur="herbs" data-lock="${blocked ? 1 : 0}"
            ${!canAfford(vm.herbs, cost) || blocked ? 'disabled' : ''}>
            ${blocked ? 'One is already held' : 'Refine'}
          </button>
        </div>
      </div>`;
    }).join('');
    return `<h2 class="section">The Pill Furnace</h2>${rows}`;
  }

  function expeditionsHTML() {
    if (vm.realm < D.DUEL_REALM) {
      return `<p class="empty">Reach <b>${D.REALMS[D.DUEL_REALM].name}</b> before you go wandering.</p>`;
    }
    if (vm.expedition) {
      const e = D.EXPEDITIONS.find((x) => x.id === vm.expedition.id);
      const pct = (1 - vm.expedition.remaining / vm.expedition.total) * 100;
      return `<div class="card">
        <div class="card-head"><span class="card-title">${esc(e.name)}</span>
        <span class="card-meta" data-live="expedition">${fmtTime(vm.expedition.remaining)}</span></div>
        <p class="card-desc">The party is out. They will return whether you are watching or not.</p>
        <div class="bar"><i data-live="expedition-bar" style="width:${pct}%"></i></div>
      </div>`;
    }
    return D.EXPEDITIONS.map((e) => {
      const scale = vm.realm + 1;
      return `<div class="card">
        <div class="card-head"><span class="card-title">${esc(e.name)}</span>
        <span class="card-meta">${fmtTime(e.duration)}</span></div>
        <p class="card-desc">🌿 ${e.herbs[0] * scale}–${e.herbs[1] * scale} · 🪙 ${e.stones[0] * scale}–${e.stones[1] * scale}${e.cores[1] ? ` · 💠 ${e.cores[0]}–${e.cores[1]}` : ''}</p>
        <p class="card-flavor">${esc(e.flavor)}</p>
        <div class="card-actions"><button class="act" data-action="expedition" data-id="${e.id}">Send a party</button></div>
      </div>`;
    }).join('');
  }

  function duelHTML() {
    if (vm.realm < D.DUEL_REALM) {
      return `<p class="empty">The jianghu has not heard of you yet.</p>`;
    }
    const t = vm.jianghu.target;
    const ready = vm.jianghu.cooldown <= 0 && t;
    const win = t ? E.duelWindow(vm.jianghu.might, t.might) : 0;
    return `<div class="card">
      <div class="card-head">
        <span class="card-title">${t ? esc(t.name) : 'First under heaven'}</span>
        <span class="card-meta">${t ? `rank ${t.rank}` : '—'}</span>
      </div>
      <p class="card-desc">
        You stand at <b>rank ${vm.jianghu.rank > D.LADDER_SIZE ? 'unranked' : vm.jianghu.rank}</b> ·
        ${vm.jianghu.wins}W / ${vm.jianghu.losses}L · renown +${vm.jianghu.renown}% Qi/s
      </p>
      ${t ? `<p class="card-desc">Your might ${fmt(vm.jianghu.might)} against theirs ${fmt(t.might)} —
        a strike window of <b>${fmtPct(win)}</b>.</p>` : '<p class="card-desc">There is no one above you.</p>'}
      <div class="card-actions">
        <button class="act gold" data-action="duel" data-live="duel" ${ready ? '' : 'disabled'}>${
          !t ? 'Nothing left to prove' : vm.jianghu.cooldown > 0 ? `Word is still spreading · ${fmtTime(vm.jianghu.cooldown)}` : 'Challenge'
        }</button>
      </div>
    </div>`;
  }

  function forgeHTML() {
    if (vm.realm < D.FORGE_REALM) {
      return `<p class="empty">Reach <b>${D.REALMS[D.FORGE_REALM].name}</b> to raise a forge.</p>`;
    }
    const cost = E.forgeCost(game.state);
    const odds = vm.forgeOdds;
    const oddsHTML = D.RARITIES.map((r, i) =>
      `<span class="odd" style="color:${r.color};border-color:${r.color}55">${r.name} ${(odds[i] * 100).toFixed(odds[i] < 0.01 ? 2 : 1)}%</span>`).join('');
    const slots = D.SLOTS.map((s) => {
      const a = vm.artifacts[s.id];
      const rarity = a ? D.RARITIES.find((r) => r.key === a.rarity) : null;
      return `<div class="card">
        <div class="card-head">
          <span class="card-title">${s.icon} ${a ? esc(a.name) : `No ${s.name.toLowerCase()} bound`}</span>
          <span class="card-meta" ${rarity ? `style="color:${rarity.color}"` : ''}>${rarity ? rarity.name : '—'}</span>
        </div>
        <p class="card-desc">${a ? `+${a.power.toFixed(1)}%` : '+0%'} ${esc(s.stat)}</p>
        <div class="card-actions">
          <button class="act" data-action="forge" data-id="${s.id}"
            data-cost="${cost.cores}" data-cur="cores" data-cost2="${cost.stones}" data-cur2="stones"
            data-lock="${vm.pendingForge ? 1 : 0}"
            ${vm.cores < cost.cores || vm.stones < cost.stones || vm.pendingForge ? 'disabled' : ''}>
            Forge · 💠 ${cost.cores} + 🪙 ${fmt(cost.stones)}
          </button>
        </div>
      </div>`;
    }).join('');
    return `<div class="card">
      <div class="card-head"><span class="card-title">Forging luck ${vm.forgeLuck}</span>
      <span class="card-meta">realm + 2 × Forgemaster</span></div>
      <p class="card-desc">Effective odds at your luck:</p>
      <div class="odds">${oddsHTML}</div>
    </div>${slots}`;
  }

  function shopHTML() {
    const items = Object.values(D.SHOP).map((item) => {
      const cost = E.shopCost(game.state, item.id);
      const owned = item.id === 'array' ? vm.arrays : item.id === 'ring' ? vm.rings : vm.talismans;
      return `<div class="card">
        <div class="card-head"><span class="card-title">${esc(item.name)}</span>
        <span class="card-meta">owned ${owned}</span></div>
        <p class="card-desc">${esc(item.desc)}</p>
        <div class="card-actions">
          <button class="act" data-action="shop" data-id="${item.id}"
            data-cost="${cost}" data-cur="stones" ${canAfford(vm.stones, cost) ? '' : 'disabled'}>
            Buy · 🪙 ${fmt(cost)}
          </button>
        </div>
      </div>`;
    }).join('');
    return items;
  }

  function rebirthHTML() {
    if (!vm.canReincarnate) {
      return `<p class="empty">The wheel takes only a nascent soul.<br>Reach <b>${D.REALMS[D.REBIRTH_REALM].name}</b>.</p>`;
    }
    return `<div class="card">
      <div class="card-head"><span class="card-title">The Wheel of Rebirth</span>
      <span class="card-meta">☸ +${fmt(vm.insightGain)}</span></div>
      <p class="card-desc">
        You would carry <b>${fmt(vm.insightGain)} Dao Insight</b> through — each worth +10% Qi/s, forever.
        Your sect, your rank, your Dao Records and any <b>Immortal</b> artifact come with you.
        Everything else begins again at sixteen.
      </p>
      <div class="card-actions">
        <button class="act gold" data-action="rebirth">Step into the wheel</button>
      </div>
    </div>`;
  }

  function sectHTML() {
    if (vm.realm < D.SECT_REALM) {
      return `<p class="empty">A sect needs a formed core.<br>Reach <b>${D.REALMS[D.SECT_REALM].name}</b>.</p>`;
    }
    if (!vm.sect.founded) {
      return `<div class="card">
        <div class="card-head"><span class="card-title">Found a sect</span>
        <span class="card-meta">🪙 ${D.SECT_FOUND_COST}</span></div>
        <p class="card-desc">Name a mountain, and disciples will come to it. A sect survives your death and every rebirth after.</p>
        <div class="card-actions">
          <button class="act" data-action="found" data-cost="${D.SECT_FOUND_COST}" data-cur="stones"
            ${canAfford(vm.stones, D.SECT_FOUND_COST) ? '' : 'disabled'}>Found it</button>
        </div>
      </div>`;
    }
    const inc = vm.sect.income;
    const recruit = E.recruitCost(game.state);
    const full = vm.sect.disciples >= vm.sect.capacity;
    const roster = vm.sect.roster.map((d) =>
      `<span class="disciple t${d.tier}">${esc(d.name)} · ${D.DISCIPLE_TIERS[d.tier].name}</span>`).join('');

    const facilities = D.FACILITIES.map((f) => {
      const lvl = vm.sect.facilities[f.id];
      const cost = E.facilityCost(game.state, f.id);
      return `<div class="card">
        <div class="card-head"><span class="card-title">${esc(f.name)}</span>
        <span class="card-meta">level ${lvl}</span></div>
        <p class="card-desc">${esc(f.desc)}</p>
        <div class="card-actions">
          <button class="act" data-action="facility" data-id="${f.id}"
            data-cost="${cost}" data-cur="stones" ${canAfford(vm.stones, cost) ? '' : 'disabled'}>
            Build · 🪙 ${fmt(cost)}
          </button>
        </div>
      </div>`;
    }).join('');

    return `<div class="card">
      <div class="card-head"><span class="card-title">${esc(vm.sect.name)}</span>
      <span class="card-meta" style="color:var(--gold)">${esc(vm.sect.tierName)}</span></div>
      <div class="stat-row"><span>Disciples</span><span>${vm.sect.disciples} / ${vm.sect.capacity}</span></div>
      <div class="stat-row"><span>Delivering</span><span>🪙 ${fmt(inc.stones * 60)}/min · 🌿 ${fmt(inc.herbs * 60)}/min</span></div>
      ${roster ? `<div class="roster">${roster}</div>` : ''}
      <div class="card-actions">
        <button class="act" data-action="recruit" data-cost="${recruit}" data-cur="stones"
          data-lock="${full ? 1 : 0}" ${full || !canAfford(vm.stones, recruit) ? 'disabled' : ''}>
          ${full ? 'No room — expand the Sect Hall' : `Recruit · 🪙 ${fmt(recruit)}`}
        </button>
      </div>
      <p class="card-flavor">Talent is blind: 65% outer, 30% inner, 5% Heaven's Chosen.</p>
    </div>
    <h2 class="section">Buildings</h2>${facilities}`;
  }

  function chroniclesHTML() {
    return vm.log.slice(0, 40).map((l) =>
      `<div class="log-line ${esc(l.kind)}"><span class="log-age">${l.age}y</span><b>${esc(l.text)}</b></div>`).join('')
      || '<span class="empty">Nothing has happened yet.</span>';
  }

  /**
   * Everything that changes the sheet's *structure*. Live values that tick every
   * frame — timers, cooldowns, currency totals — are deliberately absent: they
   * are patched in place instead. Rebuilding the sheet on a timer detaches the
   * button under the player's thumb and throws away their scroll position.
   */
  function sheetSignature() {
    return [
      tab, vm.realm, vm.stage, vm.meridians, vm.mastered, vm.arrays, vm.rings,
      vm.talismans, vm.nineTurn, vm.insightPill, vm.recordCount, vm.canReincarnate,
      vm.expedition ? vm.expedition.id : '-', vm.deviation > 0, !!vm.pendingForge,
      vm.sect.founded, vm.sect.disciples, vm.sect.tierIndex,
      vm.jianghu.rank, vm.jianghu.wins, vm.jianghu.losses,
      Object.values(vm.techniques).join(','),
      Object.values(vm.sect.facilities).join(','),
      Object.values(vm.artifacts).map((a) => (a ? a.name + a.power : '-')).join(','),
    ].join('|');
  }

  let lastSignature = null;

  function renderSheet(force = false) {
    if (tab === 'cultivate' || cinematic) { el.sheet.hidden = true; lastSignature = null; return; }
    const sig = sheetSignature();
    el.sheet.hidden = false;
    el.sheet.classList.toggle('compact', tab === 'sect');
    if (!force && sig === lastSignature) { patchSheet(); return; }
    lastSignature = sig;

    let html = '';
    if (tab === 'arts') html = techniquesHTML();
    else if (tab === 'alchemy') html = alchemyHTML();
    else if (tab === 'journey') {
      html = `<h2 class="section">Expeditions</h2>${expeditionsHTML()}
        <h2 class="section">The Rivers &amp; Lakes</h2>${duelHTML()}
        <h2 class="section">The Artifact Forge</h2>${forgeHTML()}
        <h2 class="section">Treasure Pavilion</h2>${shopHTML()}
        <h2 class="section">Reincarnation</h2>${rebirthHTML()}`;
    } else if (tab === 'sect') html = sectHTML();
    el.sheetBody.innerHTML = html;
    patchSheet();
  }

  const PURSE = { qi: () => vm.qi, stones: () => vm.stones, herbs: () => vm.herbs, cores: () => vm.cores };

  /** Update only what ticks: timers, progress bars, and affordability. */
  function patchSheet() {
    if (el.sheet.hidden) return;

    const exp = el.sheetBody.querySelector('[data-live="expedition"]');
    if (exp && vm.expedition) {
      exp.textContent = fmtTime(vm.expedition.remaining);
      const bar = el.sheetBody.querySelector('[data-live="expedition-bar"]');
      if (bar) bar.style.width = `${(1 - vm.expedition.remaining / vm.expedition.total) * 100}%`;
    }

    const duel = el.sheetBody.querySelector('[data-live="duel"]');
    if (duel) {
      const t = vm.jianghu.target;
      const ready = vm.jianghu.cooldown <= 0 && !!t;
      duel.disabled = !ready;
      duel.textContent = !t ? 'Nothing left to prove'
        : vm.jianghu.cooldown > 0 ? `Word is still spreading · ${fmtTime(vm.jianghu.cooldown)}`
          : 'Challenge';
    }

    for (const btn of el.sheetBody.querySelectorAll('[data-cost]')) {
      if (btn.dataset.lock === '1') { btn.disabled = true; continue; }
      const have = PURSE[btn.dataset.cur]?.() ?? 0;
      const cost = Number(btn.dataset.cost);
      const extra = btn.dataset.cur2 ? (PURSE[btn.dataset.cur2]?.() ?? 0) >= Number(btn.dataset.cost2) : true;
      btn.disabled = !(canAfford(have, cost) && extra);
    }
  }

  /* --------------------------------------------------------------- modals */

  function closeModal() { el.modal.hidden = true; el.modal.innerHTML = ''; }

  function openModal(html, { dismissable = true, variant = '' } = {}) {
    el.modal.hidden = false;
    el.modal.className = `modal${variant ? ' ' + variant : ''}`;
    el.modal.innerHTML = `<div class="modal-box">${html}</div>`;
    el.modal.dataset.dismissable = dismissable ? '1' : '0';
  }

  function recordsModal() {
    const rows = D.RECORDS.map((r) => {
      const done = !!vm.records[r.id];
      return `<div class="record${done ? ' done' : ''}">
        <span class="r-name">${esc(r.name)}</span>
        <span class="r-bonus">+${r.bonus}%</span>
        <span class="r-hint">${done ? 'Sealed.' : esc(r.hint)}</span>
      </div>`;
    }).join('');
    openModal(`<h2>Dao Records</h2>
      <p class="sub">${vm.recordCount} of 35 sealed · +${vm.recordBonus}% Qi/s, kept across every life.</p>
      <div class="records">${rows}</div>
      <div class="card-actions"><button class="act plain" data-action="close">Close</button></div>`);
  }

  function settingsModal() {
    const s = vm.settings;
    const q = view.quality;
    openModal(`<h2>Settings</h2>
      <p class="sub">Myriad Dao: Ascension · v${E.GAME_VERSION}</p>
      <label for="renameInput">Your name</label>
      <input id="renameInput" type="text" maxlength="28" value="${esc(vm.name)}">
      <div class="card-actions"><button class="act" data-action="rename">Take this name</button></div>

      <h2 class="section">Comfort</h2>
      <div class="toggle-row"><span>Sound effects</span><div class="switch ${s.sfx ? 'on' : ''}" data-action="toggle" data-id="sfx"></div></div>
      <div class="toggle-row"><span>Ambient guqin</span><div class="switch ${s.music ? 'on' : ''}" data-action="toggle" data-id="music"></div></div>
      <div class="toggle-row"><span>Haptics</span><div class="switch ${s.haptics ? 'on' : ''}" data-action="toggle" data-id="haptics"></div></div>
      <div class="toggle-row"><span>Reduced motion</span><div class="switch ${s.reducedMotion ? 'on' : ''}" data-action="toggle" data-id="reducedMotion"></div></div>

      <label>Graphics quality</label>
      <div class="seg">
        ${['auto', 'low', 'medium', 'high'].map((k) =>
          `<button data-action="quality" data-id="${k}" class="${s.quality === k ? 'on' : ''}">${k === 'auto' ? `Auto (${q})` : k}</button>`).join('')}
      </div>

      <h2 class="section">Your save</h2>
      <label for="saveText">Export / import (base64)</label>
      <textarea id="saveText" spellcheck="false"></textarea>
      <div class="card-actions">
        <button class="act plain" data-action="export">Export</button>
        <button class="act plain" data-action="import">Import</button>
      </div>
      <div class="card-actions"><button class="act danger" data-action="reset">Erase everything</button></div>
      <div class="card-actions"><button class="act plain" data-action="close">Close</button></div>`);
  }

  function offlineModal(r) {
    const bits = [];
    if (r.qi > 0) bits.push(`<div class="stat-row"><span>Qi gathered</span><span>${fmt(r.qi)}</span></div>`);
    if (r.stones > 0.5) bits.push(`<div class="stat-row"><span>Sect deliveries</span><span>🪙 ${fmt(r.stones)}</span></div>`);
    if (r.herbs > 0.5) bits.push(`<div class="stat-row"><span>Herb garden</span><span>🌿 ${fmt(r.herbs)}</span></div>`);
    if (r.expedition) bits.push(`<div class="stat-row"><span>${esc(r.expedition.name)}</span><span>returned</span></div>`);
    bits.push(`<div class="stat-row"><span>Years passed</span><span>${r.years.toFixed(1)}</span></div>`);
    openModal(`<h2>You emerge from seclusion</h2>
      <p class="sub">${fmtTime(r.seconds)} in closed-door cultivation at ${fmtPct(r.rate)} of your Qi/s.${
        r.truncated ? ' Your storage rings held no more.' : ''}</p>
      ${bits.join('')}
      <div class="card-actions"><button class="act" data-action="close">Return to the mountain</button></div>`);
  }

  function forgeRevealModal(art) {
    const rarity = D.RARITIES.find((r) => r.key === art.rarity);
    const slot = D.SLOT_BY_ID[art.slot];
    const cur = vm.artifacts[art.slot];
    openModal(`<div class="reveal-art">
        <div class="r-rarity" style="color:${rarity.color}">${rarity.name} grade</div>
        <div class="r-name" style="color:${rarity.color}">${esc(art.name)}</div>
        <div class="r-stat">+${art.power.toFixed(1)}% ${esc(slot.stat)}</div>
      </div>
      ${cur ? `<p class="sub" style="text-align:center">Replacing ${esc(cur.name)} (+${cur.power.toFixed(1)}%) — it will salvage for 💠 2.</p>`
        : '<p class="sub" style="text-align:center">This slot is empty.</p>'}
      <div class="card-actions">
        <button class="act" data-action="bind">Bind it</button>
        <button class="act plain" data-action="salvage">Salvage · 💠 2</button>
      </div>`, { dismissable: false, variant: 'reveal' });
  }

  /* ------------------------------------------------------- the minigames */

  function beginTribulation(info) {
    tribRun = { active: true };
    setCinematic(true);
    view.startTribulation(info.chance, info.speed);
    el.overlay.hidden = false;
    el.overlay.innerHTML = `<div class="overlay-note trib">
      <h3>Heavenly Tribulation</h3>
      <p class="tap-cue">Tap anywhere the instant the mark crosses the gold.</p>
      <p style="margin-top:6px">Window ${fmtPct(info.chance)} · ${D.REALMS[info.realm + 1].name} awaits</p>
    </div>`;
  }

  function strikeTribulation() {
    if (!tribRun) return false;
    const r = view.tribulationTap();
    if (!r) return false;
    tribRun = null;
    el.overlay.hidden = true;
    el.overlay.innerHTML = '';
    setCinematic(false);
    const out = game.resolveTribulation(r.hit);
    if (out.success) {
      audio.ascend();
      toast(`You endure. ${D.REALMS[game.state.realm].name}.`, 'gold');
    } else {
      audio.deviation();
      toast('Qi deviation — the bolt scatters your gathered power.', 'bad');
    }
    refresh();
    return true;
  }

  function beginDuel(info) {
    setCinematic(true);
    view.showDuel(true);
    view.setFraming('duel');
    duelRun = { round: 0, wins: 0, info, waiting: false, timer: 0 };
    nextClash();
  }

  function nextClash() {
    if (!duelRun) return;
    if (duelRun.round >= D.DUEL_CLASHES) return finishDuel();
    const speed = duelRun.info.speeds[duelRun.round];
    view.startClash(duelRun.round, duelRun.info.window, speed);
    duelRun.waiting = true;
    duelRun.timer = 0;
    el.overlay.hidden = false;
    el.overlay.innerHTML = `<div class="overlay-note">
      <h3>Clash ${duelRun.round + 1} of 3</h3>
      <p class="tap-cue">Strike as the ring closes.</p>
      <p style="margin-top:6px">${esc(duelRun.info.rival.name)} · window ${fmtPct(duelRun.info.window)}</p>
    </div>`;
  }

  function strikeClash() {
    if (!duelRun || !duelRun.waiting) return false;
    const r = view.clashTap();
    if (!r) return false;
    duelRun.waiting = false;
    duelRun.round += 1;
    if (r.hit) { duelRun.wins += 1; audio.clashHit(); } else audio.clashMiss();
    setTimeout(nextClash, 520);
    return true;
  }

  function finishDuel() {
    const wins = duelRun.wins;
    duelRun = null;
    view.endClash();
    el.overlay.hidden = true;
    const out = game.resolveDuel(wins);

    // The engine can legitimately refuse: a forced death mid-duel wipes the
    // in-flight duel out of state. Bail cleanly rather than reading a rival
    // that is not there.
    if (!out.ok) {
      view.showDuel(false);
      setCinematic(false);
      view.setFraming(TAB_FRAMING[tab] || 'world');
      refresh();
      return;
    }

    view.knockback(out.won);
    if (out.won) {
      audio.victory();
      toast(`${out.rival.name} yields. Rank ${out.rank}.`, 'jade');
    } else {
      audio.defeat();
      toast(`${out.rival.name} puts you down. Injured for 90s.`, 'bad');
    }
    setTimeout(() => {
      view.showDuel(false);
      setCinematic(false);
      view.setFraming(TAB_FRAMING[tab] || 'world');
    }, 2400);
    refresh();
  }

  /* -------------------------------------------------------------- actions */

  const actions = {
    tech: (id) => {
      const r = game.buyTechnique(id);
      if (r.ok) { audio.purchase(); refresh(); } else toast(r.reason, 'bad');
    },
    meridian: () => {
      const r = game.openMeridian();
      if (r.ok) { audio.meridian(); toast(`The ${r.name} meridian opens.`, 'jade'); refresh(); }
      else toast(r.reason, 'bad');
    },
    pill: (id) => {
      const r = game.brewPill(id);
      if (r.ok) { audio.pill(); refresh(); } else toast(r.reason, 'bad');
    },
    expedition: (id) => {
      const r = game.startExpedition(id);
      if (r.ok) { audio.expedition(); refresh(); } else toast(r.reason, 'bad');
    },
    shop: (id) => {
      const r = game.buyShop(id);
      if (r.ok) { audio.purchase(); refresh(); } else toast(r.reason, 'bad');
    },
    forge: (id) => {
      const r = game.beginForge(id);
      if (!r.ok) return toast(r.reason, 'bad');
      setCinematic(true);
      view.setFraming('forge');
      view.showForge(true);
      view.revealArtifact(r.artifact.rarity);
      audio.forge(D.rarityIndex(r.artifact.rarity));
      // Long enough for the piece to finish rising before the card slides up.
      setTimeout(() => forgeRevealModal(r.artifact), 1250);
      refresh();
    },
    bind: () => finishForge(true),
    salvage: () => finishForge(false),
    duel: () => {
      const r = game.beginDuel();
      if (!r.ok) return toast(r.reason, 'bad');
      beginDuel(r);
    },
    found: () => {
      openModal(`<h2>Name your mountain</h2>
        <p class="sub">This name outlives you. It survives every rebirth.</p>
        <input id="sectNameInput" type="text" maxlength="28" placeholder="Cloudreach Sect" value="Cloudreach Sect">
        <div class="card-actions">
          <button class="act" data-action="foundConfirm">Found it · 🪙 ${D.SECT_FOUND_COST}</button>
          <button class="act plain" data-action="close">Not yet</button>
        </div>`);
    },
    foundConfirm: () => {
      const name = $('#sectNameInput')?.value || 'Cloudreach Sect';
      const r = game.foundSect(name);
      closeModal();
      if (r.ok) { audio.breakthrough(); toast(`${r.name} is founded.`, 'gold'); refresh(); }
      else toast(r.reason, 'bad');
    },
    recruit: () => {
      const r = game.recruitDisciple();
      if (!r.ok) return toast(r.reason, 'bad');
      const tier = D.DISCIPLE_TIERS[r.disciple.tier];
      audio[r.disciple.tier === 2 ? 'record' : 'purchase']();
      toast(`${r.disciple.name} — ${tier.name}`, r.disciple.tier === 2 ? 'gold' : '');
      refresh();
    },
    facility: (id) => {
      const r = game.upgradeFacility(id);
      if (r.ok) { audio.purchase(); refresh(); } else toast(r.reason, 'bad');
    },
    rebirth: () => {
      openModal(`<h2>Step into the wheel?</h2>
        <p class="sub">You will wake at sixteen with ${fmt(vm.insight + vm.insightGain)} Dao Insight,
        your sect, your rank, your records, and any Immortal artifact. Everything else is left behind.</p>
        <div class="card-actions">
          <button class="act gold" data-action="rebirthConfirm">Turn the wheel</button>
          <button class="act plain" data-action="close">Not yet</button>
        </div>`);
    },
    rebirthConfirm: () => {
      closeModal();
      setCinematic(true);
      view.setFraming('rebirth');
      view.inkDissolve(1);
      audio.rebirth();
      // Swap the world only once the ink has fully closed, then open again.
      setTimeout(() => {
        const r = game.reincarnate();
        if (r.ok) toast(`The wheel turns. ☸ +${fmt(r.gained)} Dao Insight.`, 'gold');
        refresh();
        view.sync(game.viewModel());
        view.setFraming('world', true);
        setTimeout(() => view.inkDissolve(-1), 260);
        setTimeout(() => {
          setCinematic(false);
          view.setFraming(TAB_FRAMING[tab] || 'world');
        }, 1500);
      }, 1250);
    },
    records: recordsModal,
    chronicles: () => openModal(`<h2>Chronicles</h2>
      <p class="sub">What has happened to you, in the order it happened.</p>
      <div class="log">${chroniclesHTML()}</div>
      <div class="card-actions"><button class="act plain" data-action="close">Close</button></div>`),
    close: closeModal,
    rename: () => {
      const v = $('#renameInput')?.value;
      game.rename(v);
      toast(`You are ${game.state.name}.`);
      refresh();
    },
    toggle: (id) => {
      const s = game.state.settings;
      s[id] = !s[id];
      if (id === 'reducedMotion') view.setReducedMotion(s[id]);
      else audio.set(id, s[id]);
      refresh();
      settingsModal();
    },
    quality: (id) => {
      game.state.settings.quality = id;
      onQuality?.(id);
      refresh();
      settingsModal();
    },
    export: () => {
      const box = $('#saveText');
      if (box) { box.value = E.exportSave(game.state); box.select(); toast('Copied into the box — save it somewhere.'); }
    },
    import: () => {
      const box = $('#saveText');
      if (!box || !box.value.trim()) return toast('Paste a save into the box first.', 'bad');
      try {
        const next = E.importSave(box.value);
        E.saveState(storage, next);
        toast('Save imported. Reloading…');
        setTimeout(() => location.reload(), 700);
      } catch {
        toast('That is not a Myriad Dao save.', 'bad');
      }
    },
    reset: () => {
      openModal(`<h2>Erase everything?</h2>
        <p class="sub">Every life, every record, the sect, the ladder. There is no wheel back from this one.</p>
        <div class="card-actions">
          <button class="act danger" data-action="resetConfirm">Erase it all</button>
          <button class="act plain" data-action="close">Keep my Dao</button>
        </div>`);
    },
    resetConfirm: () => {
      game.hardReset();
      E.saveState(storage, game.state);
      location.reload();
    },
  };

  function finishForge(bind) {
    const r = game.resolveForge(bind);
    closeModal();
    view.hideReveal();
    view.showForge(false);
    setCinematic(false);
    view.setFraming(TAB_FRAMING[tab] || 'world');
    if (r.ok && r.bound) toast(`${r.artifact.name} bound.`, 'gold');
    else if (r.ok) toast('Salvaged for 💠 2.');
    refresh();
  }

  /* -------------------------------------------------------------- wiring */

  function handleAction(e) {
    const node = e.target.closest('[data-action]');
    if (!node) return;
    const fn = actions[node.dataset.action];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn(node.dataset.id);
  }

  el.sheetBody.addEventListener('click', handleAction);
  el.padLinks.addEventListener('click', handleAction);
  el.modal.addEventListener('click', (e) => {
    if (e.target === el.modal && el.modal.dataset.dismissable === '1') return closeModal();
    handleAction(e);
  });
  el.overlay.addEventListener('click', handleAction);

  el.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    tab = btn.dataset.tab;
    for (const t of el.tabs.querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.tab === tab);
    view.setFraming(TAB_FRAMING[tab] || 'world');
    refresh();
  });

  el.breakBtn.addEventListener('click', () => {
    const r = game.beginBreakthrough();
    if (!r.ok) return toast(r.reason, 'bad');
    if (r.kind === 'minor') {
      audio.breakthrough();
      view.postFlash('#8fd8c0', 0.3);
      toast(`${D.STAGE_NAMES[game.state.stage]} ${D.REALMS[game.state.realm].name}.`, 'jade');
      refresh();
    } else {
      beginTribulation(r);
    }
  });

  $('#openSettings').addEventListener('click', settingsModal);
  $('#who').addEventListener('click', settingsModal);

  /* ---------------------------------------------------------------- API */

  function refresh() {
    vm = game.viewModel();
    renderHeader();
    renderPad();
    renderSheet(true);
    view.sync(vm);
  }

  /** Cheap per-frame refresh: header only, so the sheet does not thrash. */
  function tickHeader() {
    vm = game.viewModel();
    renderHeader();
    renderPad();
    renderSheet(); // signature-gated: patches timers, rebuilds only on real change
    view.sync(vm);
  }

  /** The whole canvas is the cultivate button — unless a minigame owns the tap. */
  function handleWorldTap() {
    if (tribRun) return strikeTribulation();
    if (duelRun && duelRun.waiting) return strikeClash();
    if (!el.modal.hidden) return false;
    const r = game.cultivate();
    audio.tap();
    view.ripple(vm.capped ? '#e8b34b' : null);
    floatText(`+${fmt(r.got)}`, vm.capped);
    if (r.capped) floatText('at the bottleneck', true);
    return true;
  }

  /** Duel clashes time out after two sweeps, so a duel always resolves. */
  function updateMinigames(dt) {
    if (duelRun && duelRun.waiting) {
      duelRun.timer += dt;
      if (view.minigame.kind !== 'clash' || view.minigame.sweeps >= 2) {
        duelRun.waiting = false;
        duelRun.round += 1;
        view.endClash();
        view.clashImpact(false);
        audio.clashMiss();
        setTimeout(nextClash, 420);
      }
    }
  }

  function bootDone() {
    el.hud.hidden = false;
    el.pad.hidden = false;
    el.tabs.hidden = false;
    el.boot.classList.add('gone');
    setTimeout(() => el.boot.remove(), 700);
  }

  return {
    refresh, tickHeader, handleWorldTap, updateMinigames, bootDone,
    toast, floatText, offlineModal, forgeRevealModal, settingsModal,
    get tab() { return tab; },
    resumePendingTribulation() {
      const p = game.state.pendingTrib;
      if (p) beginTribulation(p);
    },
    resumePendingForge() {
      if (game.state.pendingForge) forgeRevealModal(game.state.pendingForge);
    },
  };
}
