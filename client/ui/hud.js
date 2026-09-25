// client/ui/hud.js
// HUD: marcos de unidad, barra de acciones, XP, buffs, barra de casteo, panel de guerra, avisos y modales.
import { REALMS, REALM_IDS, CLASSES, SKILLS, skillsFor, subclassesOf, RESPAWN_DELAY, REALM_BONUS_PER_STRUCTURE } from '/shared/constants.js';
import { STRUCTURE_BY_ID } from '/shared/worldmap.js';

const CLASS_ICON = { guerrero: '⚔️', caballero: '🛡️', barbaro: '🪓', arquero: '🏹', cazador: '🐺', tirador: '🎯', mago: '🔮', conjurador: '💚', brujo: '🕯️' };
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(actions) {
    this.actions = actions;   // { cast(skillId), toggleAttack(), respawn(), chooseSubclass(cls), leave() }
    this.root = $('hud');
    this.skillSlots = [];
    this.lastSelf = null;
    this.structures = new Map();
    this.myRealm = null;
    this.serverNow = () => Date.now();
    $('respawn-btn').onclick = () => this.actions.respawn();
    $('leave-btn').onclick = () => this.actions.leave();
    this.tooltip = $('skill-tooltip');
    this._buildActionBar();
  }
  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); this.hideOverlays(); }
  hideOverlays() { for (const id of ['death-overlay', 'subclass-overlay', 'world-map-overlay', 'help-overlay']) $(id).classList.add('hidden'); }
  toggleOverlay(id) { const o = $(id); o.classList.toggle('hidden'); return !o.classList.contains('hidden'); }
  isOverlayOpen(id) { return !$(id).classList.contains('hidden'); }

  // ------------------------------------------------------------ marcos
  updateSelf(self) {
    this.lastSelf = self;
    this.myRealm = self.realm;
    $('player-name').textContent = self.name;
    $('player-name').style.color = REALMS[self.realm]?.cssColor ?? '#fff';
    $('player-level').textContent = `Nv ${self.level} · ${CLASSES[self.cls]?.name ?? self.cls}`;
    $('player-portrait').textContent = CLASS_ICON[self.cls] ?? '⚔️';
    this._bar('player-hp', self.hp, self.maxHp);
    this._bar('player-mp', self.mana, self.maxMana);
    const pct = Number.isFinite(self.xpNext) ? self.xp / self.xpNext : 1;
    $('xp-fill').style.width = (pct * 100).toFixed(1) + '%';
    $('xp-text').textContent = Number.isFinite(self.xpNext) ? `Nivel ${self.level} · ${self.xp} / ${self.xpNext} XP (${(pct * 100).toFixed(1)}%) · ${self.gold} oro` : `Nivel máximo · ${self.gold} oro`;
    this._rebuildSkills(self);
    this._updateBuffs(self);
    // muerte
    const death = $('death-overlay');
    if (self.dead) {
      death.classList.remove('hidden');
      const btn = $('respawn-btn');
      const wait = Math.max(0, (self.canRespawnAt || 0) - this.serverNow());
      btn.disabled = wait > 0;
      btn.textContent = wait > 0 ? `Reaparecer (${Math.ceil(wait / 1000)} s)` : 'Reaparecer (R)';
    } else death.classList.add('hidden');
    // subclase
    if (self.needsSubclass) this._showSubclass(self); else $('subclass-overlay').classList.add('hidden');
  }
  _bar(prefix, v, max) {
    $(prefix + '-fill').style.width = (max > 0 ? Math.max(0, Math.min(1, v / max)) * 100 : 0).toFixed(1) + '%';
    $(prefix + '-text').textContent = `${Math.round(v)} / ${Math.round(max)}`;
  }
  updateTarget(view, isHostile) {
    const f = $('target-frame');
    if (!view) { f.classList.add('hidden'); return; }
    const d = view.data;
    f.classList.remove('hidden');
    f.classList.toggle('hostile', isHostile); f.classList.toggle('friendly', !isHostile);
    $('target-name').textContent = view.nameEl.textContent;
    $('target-level').textContent = d.k === 'd' ? '' : `Nv ${d.lv}`;
    $('target-portrait').textContent = d.k === 'p' ? (CLASS_ICON[d.c] ?? '👤') : d.k === 'd' ? '🚪' : '👹';
    this._bar('target-hp', d.hp, d.mhp);
    $('target-sub').textContent = view.titleEl.textContent + (d.d ? ' · muerto' : '');
  }

  // ------------------------------------------------------------ habilidades
  _buildActionBar() {
    const bar = $('action-bar');
    bar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('div');
      b.className = 'skill-btn empty';
      b.innerHTML = `<span class="key">${i + 1}</span><span class="icon"></span><div class="cd hidden"></div>`;
      b.onclick = () => { const s = this.skillSlots[i]; if (s) this.actions.cast(s.id); };
      b.onmouseenter = () => this._tooltip(i, b);
      b.onmouseleave = () => this.tooltip.classList.add('hidden');
      bar.appendChild(b);
    }
    // botón de autoataque
    const atk = document.createElement('div');
    atk.className = 'skill-btn'; atk.id = 'attack-btn'; atk.title = 'Atacar / parar (T)';
    atk.innerHTML = `<span class="key">T</span><span class="icon">🗡️</span>`;
    atk.onclick = () => this.actions.toggleAttack();
    bar.appendChild(atk);
  }
  _rebuildSkills(self) {
    const skills = skillsFor(self.cls, self.level);
    const changed = skills.length !== this.skillSlots.length || skills.some((s, i) => this.skillSlots[i]?.id !== s.id);
    if (changed) {
      this.skillSlots = skills.slice(0, 9);
      const btns = $('action-bar').querySelectorAll('.skill-btn:not(#attack-btn)');
      btns.forEach((b, i) => {
        const s = this.skillSlots[i];
        b.classList.toggle('empty', !s);
        b.querySelector('.icon').textContent = s ? s.icon : '';
        b.title = s ? s.name : '';
      });
    }
    $('attack-btn').classList.toggle('active-attack', !!self.autoAttack);
  }
  /** Llamar cada frame: enfriamientos y maná. */
  tick(now) {
    const self = this.lastSelf; if (!self) return;
    const btns = $('action-bar').querySelectorAll('.skill-btn:not(#attack-btn)');
    btns.forEach((b, i) => {
      const s = this.skillSlots[i]; if (!s) return;
      const cd = Math.max(self.cooldowns?.[s.id] || 0, self.gcdUntil || 0);
      const left = cd - now;
      const cdEl = b.querySelector('.cd');
      if (left > 0) { cdEl.classList.remove('hidden'); cdEl.textContent = left > 1000 ? Math.ceil(left / 1000) : (left / 1000).toFixed(1); }
      else cdEl.classList.add('hidden');
      b.classList.toggle('nomana', self.mana < s.mana);
    });
    if (self.dead) {
      const btn = $('respawn-btn');
      const wait = Math.max(0, (self.canRespawnAt || 0) - now);
      btn.disabled = wait > 0;
      btn.textContent = wait > 0 ? `Reaparecer (${Math.ceil(wait / 1000)} s)` : 'Reaparecer (R)';
    }
    // buffs: tiempos
    for (const el of $('buffs').children) {
      const until = Number(el.dataset.until);
      const t = el.querySelector('.time');
      if (t) t.textContent = Math.max(0, Math.ceil((until - now) / 1000)) + 's';
    }
  }
  _tooltip(i, btn) {
    const s = this.skillSlots[i]; if (!s) return;
    const eff = s.effects.map((e) => e.kind).join(', ');
    this.tooltip.innerHTML = `<b>${s.icon} ${s.name}</b><div class="row">${s.mana} maná · ${s.cooldown}s enfriamiento · alcance ${s.range || 'propio'}${s.castTime ? ` · ${s.castTime}s de canalización` : ' · instantáneo'}</div><div>${s.description}</div><div class="row">Objetivo: ${s.target === 'enemy' ? 'enemigo' : s.target === 'ally' ? 'aliado' : 'uno mismo'} · ${eff}</div>`;
    const r = btn.getBoundingClientRect();
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = Math.max(8, r.left - 60) + 'px';
    this.tooltip.style.top = (r.top - this.tooltip.offsetHeight - 10) + 'px';
  }
  _updateBuffs(self) {
    const box = $('buffs');
    box.innerHTML = '';
    for (const b of self.buffs || []) {
      const s = SKILLS[b.id];
      const el = document.createElement('div');
      const debuff = (b.stat === 'damageTakenMult' && b.value > 1) || (b.stat === 'damageMult' && b.value < 1);
      el.className = 'buff' + (debuff ? ' debuff' : '');
      el.dataset.until = b.until;
      const label = b.stat === 'damageMult' ? `${b.value > 1 ? '+' : ''}${Math.round((b.value - 1) * 100)}% daño` : b.stat === 'damageTakenMult' ? `${Math.round((b.value - 1) * 100)}% daño recibido` : b.stat === 'speedMult' ? `+${Math.round((b.value - 1) * 100)}% velocidad` : b.stat;
      el.innerHTML = `<span>${s?.icon ?? '✨'}</span><span>${s?.name ?? b.id} (${label})</span><span class="time"></span>`;
      box.appendChild(el);
    }
  }
  showCast(skillId, endsAt, now) {
    const s = SKILLS[skillId];
    const bar = $('cast-bar');
    if (!s || !endsAt) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const total = s.castTime * 1000;
    const p = 1 - Math.max(0, endsAt - now) / total;
    $('cast-fill').style.width = (Math.min(1, Math.max(0, p)) * 100).toFixed(1) + '%';
    $('cast-text').textContent = `${s.icon} ${s.name} · ${(Math.max(0, endsAt - now) / 1000).toFixed(1)}s`;
    if (p >= 1) setTimeout(() => bar.classList.add('hidden'), 150);
  }
  hideCast() { $('cast-bar').classList.add('hidden'); }

  // ------------------------------------------------------------ guerra
  setStructures(list) { for (const s of list) this.structures.set(s.id, s); this._renderWar(); }
  updateStructure(s) { this.structures.set(s.id, s); this._renderWar(); }
  _renderWar() {
    const owned = Object.fromEntries(REALM_IDS.map((r) => [r, 0]));
    for (const s of this.structures.values()) owned[s.owner] = (owned[s.owner] || 0) + 1;
    $('realm-bonus').innerHTML = REALM_IDS.map((r) => `<span style="color:${REALMS[r].cssColor}" title="${REALMS[r].name}: ${owned[r]} estructuras">${REALMS[r].name.slice(0, 3)} ${owned[r]} · +${Math.round(owned[r] * REALM_BONUS_PER_STRUCTURE * 100)}%</span>`).join('');
    const list = $('structure-list');
    list.innerHTML = '';
    const order = [...this.structures.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'castle' ? -1 : 1));
    for (const s of order) {
      const row = document.createElement('div');
      row.className = 'struct-row';
      const doorPct = Math.round(s.doorHp / s.doorMaxHp * 100);
      row.innerHTML = `<span class="dot" style="background:${REALMS[s.owner]?.cssColor ?? '#fff'}"></span><span class="sname" title="${s.name}">${s.kind === 'castle' ? '🏰' : '⛺'} ${s.name}</span><span class="door ${s.doorDestroyed ? 'broken' : ''}">${s.doorDestroyed ? '💥 abierta' : '🚪 ' + doorPct + '%'}</span>`;
      list.appendChild(row);
      if (s.capture) {
        const cap = document.createElement('div');
        cap.className = 'struct-cap';
        cap.dataset.start = s.capture.startedAt; cap.dataset.end = s.capture.endsAt;
        cap.innerHTML = `<div class="fill" style="width:0%"></div>`;
        cap.title = `${s.capture.playerName} (${REALMS[s.capture.realm]?.name}) capturando`;
        list.appendChild(cap);
      }
    }
  }
  tickCaptures(now) {
    for (const el of $('structure-list').querySelectorAll('.struct-cap')) {
      const s = Number(el.dataset.start), e = Number(el.dataset.end);
      el.firstElementChild.style.width = (Math.min(1, Math.max(0, (now - s) / (e - s))) * 100).toFixed(0) + '%';
    }
  }

  // ------------------------------------------------------------ avisos
  setZone(text, war) { $('zone-name').textContent = text; $('zone-name').style.color = war ? '#ff8a80' : '#a5d6a7'; }
  setStats(text) { $('server-stats').textContent = text; }
  center(text, cls = '') {
    const box = $('center-messages');
    const el = document.createElement('div');
    el.className = 'center-msg ' + cls; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 3300);
  }
  toast(text, cls = '') {
    const box = $('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + cls; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 4100);
  }
  setInteract(text) {
    const p = $('interact-prompt');
    if (!text) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden'); p.innerHTML = text;
  }
  setDeathText(text) { $('death-text').textContent = text; }

  _showSubclass(self) {
    const o = $('subclass-overlay');
    if (!o.classList.contains('hidden') && o.dataset.cls === self.cls) return;
    o.dataset.cls = self.cls;
    const box = $('subclass-options');
    box.innerHTML = '';
    for (const id of subclassesOf(self.cls)) {
      const c = CLASSES[id];
      const skills = Object.values(SKILLS).filter((s) => s.cls === id).map((s) => `${s.icon} ${s.name} (nv ${s.level})`).join('<br>');
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h3>${CLASS_ICON[id]} ${c.name}</h3><div class="sub">${c.role}</div><div class="desc">${c.description}</div><div class="desc" style="margin-top:8px;color:var(--muted)">${skills}</div>`;
      card.onclick = () => { if (confirm(`¿Convertirte en ${c.name}? No se puede cambiar después.`)) this.actions.chooseSubclass(id); };
      box.appendChild(card);
    }
    o.classList.remove('hidden');
  }
}
export { STRUCTURE_BY_ID, RESPAWN_DELAY };
