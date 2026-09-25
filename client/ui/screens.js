// client/ui/screens.js
// Pantallas previas al juego: acceso, lista de personajes y creación de personaje.
import { REALMS, REALM_IDS, RACES, RACE_IDS, CLASSES, BASE_CLASS_IDS, derivedStats, USERNAME_RE, CHARNAME_RE, PASSWORD_MIN } from '/shared/constants.js';

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export class Screens {
  /** @param {HTMLElement} root  @param {object} actions {login, register, create, enter, remove, logout} */
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.current = null;
    this.status = '';
  }
  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
  setStatus(text) { this.status = text; const s = this.root.querySelector('.conn-status'); if (s) s.textContent = text; }
  showError(msg) {
    const box = this.root.querySelector('.error-box');
    if (box) { box.textContent = msg; box.classList.remove('hidden'); }
  }
  clearError() { const box = this.root.querySelector('.error-box'); if (box) box.classList.add('hidden'); }
  setBusy(busy) { for (const b of this.root.querySelectorAll('button')) b.disabled = busy; }

  // ------------------------------------------------------------------ acceso
  showLogin(prefillUser = '') {
    this.current = 'login';
    this.show();
    this.root.innerHTML = '';
    const node = el(`
      <div class="screen" style="max-width:520px">
        <h1>Reinos en Guerra <small>MMORPG de guerra entre reinos · Norheim · Pyrrhos · Eldwyn</small></h1>
        <p class="muted">Tres reinos, nueve razas, seis especializaciones. Sube de nivel cazando, y conquista fuertes y castillos en la zona de guerra.</p>
        <div class="error-box hidden"></div>
        <div class="form-row"><label>Usuario (3-16 letras, números o _)</label><input type="text" id="login-user" maxlength="16" autocomplete="username" value="${esc(prefillUser)}"></div>
        <div class="form-row"><label>Contraseña (mínimo ${PASSWORD_MIN} caracteres)</label><input type="password" id="login-pass" maxlength="128" autocomplete="current-password"></div>
        <div class="btn-row">
          <button class="btn primary" id="btn-login">Entrar</button>
          <button class="btn" id="btn-register">Crear cuenta</button>
          <span class="conn-status" style="color:var(--muted);font-size:12px;margin-left:auto">${esc(this.status)}</span>
        </div>
        <p class="muted" style="margin-top:14px;font-size:12px">Servidor autoritativo: todo el combate, movimiento y capturas se validan en el servidor.</p>
      </div>`);
    this.root.appendChild(node);
    const user = node.querySelector('#login-user'), pass = node.querySelector('#login-pass');
    const submit = (register) => {
      this.clearError();
      const u = user.value.trim(), p = pass.value;
      if (!USERNAME_RE.test(u)) { this.showError('Usuario inválido: 3-16 caracteres, letras, números o _.'); return; }
      if (p.length < PASSWORD_MIN) { this.showError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`); return; }
      this.setBusy(true);
      (register ? this.actions.register : this.actions.login)(u, p);
    };
    node.querySelector('#btn-login').onclick = () => submit(false);
    node.querySelector('#btn-register').onclick = () => submit(true);
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(false); });
    user.focus();
  }

  // ------------------------------------------------------------------ lista de personajes
  showCharacters(username, characters) {
    this.current = 'chars';
    this.show();
    this.root.innerHTML = '';
    const node = el(`
      <div class="screen" style="max-width:720px">
        <h1>Tus personajes <small>Cuenta: ${esc(username)}</small></h1>
        <div class="error-box hidden"></div>
        <div class="char-list"></div>
        <div class="btn-row">
          <button class="btn primary" id="btn-new">Crear personaje</button>
          <button class="btn" id="btn-logout">Cerrar sesión</button>
          <span class="conn-status" style="color:var(--muted);font-size:12px;margin-left:auto">${esc(this.status)}</span>
        </div>
      </div>`);
    const list = node.querySelector('.char-list');
    if (!characters.length) list.appendChild(el(`<div class="info-box">Aún no tienes personajes. Crea el primero para entrar en el mundo.</div>`));
    for (const c of characters) {
      const realm = REALMS[c.realm], race = RACES[c.race], cls = CLASSES[c.cls];
      const item = el(`
        <div class="char-item">
          <div class="badge" style="background:${realm?.cssColor ?? '#666'}"></div>
          <div>
            <div class="name">${esc(c.name)} <span class="realm-text-${esc(c.realm)}">· ${esc(realm?.name ?? c.realm)}</span></div>
            <div class="meta">Nivel ${c.level} · ${esc(race?.name ?? c.race)} ${esc(cls?.name ?? c.cls)} · ${c.kills_pve} PvE · ${c.kills_pvp} PvP · ${c.captures} capturas</div>
          </div>
          <div class="spacer"></div>
          <button class="btn primary" data-enter="${c.id}">Entrar al mundo</button>
          <button class="btn danger" data-del="${c.id}" title="Borrar personaje">🗑</button>
        </div>`);
      item.querySelector('[data-enter]').onclick = () => { this.setBusy(true); this.actions.enter(c.id); };
      item.querySelector('[data-del]').onclick = () => {
        if (confirm(`¿Borrar definitivamente a ${c.name}? Esta acción no se puede deshacer.`)) { this.setBusy(true); this.actions.remove(c.id); }
      };
      list.appendChild(item);
    }
    node.querySelector('#btn-new').onclick = () => this.showCreate();
    node.querySelector('#btn-logout').onclick = () => this.actions.logout();
    this.root.appendChild(node);
  }

  // ------------------------------------------------------------------ creación
  showCreate() {
    this.current = 'create';
    this.show();
    this.root.innerHTML = '';
    const sel = { realm: null, race: null, cls: null };
    const node = el(`
      <div class="screen">
        <h1>Nuevo personaje <small>Elige reino, raza y clase. Al nivel 10 elegirás especialización.</small></h1>
        <div class="error-box hidden"></div>
        <h2 class="step-title"><span class="num">1</span> Reino</h2>
        <div class="card-row" id="realm-cards"></div>
        <h2 class="step-title"><span class="num">2</span> Raza</h2>
        <div class="card-row" id="race-cards"><div class="info-box">Elige primero un reino.</div></div>
        <h2 class="step-title"><span class="num">3</span> Clase</h2>
        <div class="card-row" id="class-cards"></div>
        <h2 class="step-title"><span class="num">4</span> Nombre</h2>
        <div class="form-row"><input type="text" id="char-name" maxlength="14" placeholder="3-14 letras, sin espacios ni números"></div>
        <div id="preview" class="info-box hidden"></div>
        <div class="btn-row">
          <button class="btn primary" id="btn-create">Crear personaje</button>
          <button class="btn" id="btn-back">Volver</button>
        </div>
      </div>`);
    const realmCards = node.querySelector('#realm-cards'), raceCards = node.querySelector('#race-cards'), classCards = node.querySelector('#class-cards');
    const preview = node.querySelector('#preview');
    const updatePreview = () => {
      if (!sel.race || !sel.cls) { preview.classList.add('hidden'); return; }
      const d = derivedStats(sel.race, sel.cls, 1);
      preview.classList.remove('hidden');
      preview.innerHTML = `Nivel 1 · <b>${d.maxHp}</b> vida · <b>${d.maxMana}</b> maná · FUE ${d.str} · DES ${d.dex} · INT ${d.int} · CON ${d.con} · armadura ${d.armor} · crítico ${(d.critChance * 100).toFixed(0)}%`;
    };
    const renderRaces = () => {
      raceCards.innerHTML = '';
      for (const id of RACE_IDS.filter((r) => RACES[r].realm === sel.realm)) {
        const r = RACES[id];
        const stats = Object.entries(r.mods).map(([k, v]) => v ? `<span class="stat ${v > 0 ? 'pos' : 'neg'}">${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}</span>` : '').join('');
        const card = el(`<div class="card realm-${sel.realm} ${sel.race === id ? 'selected' : ''}"><h3>${esc(r.name)}</h3><div class="desc">${esc(r.description)}</div><div class="stats">${stats}</div></div>`);
        card.onclick = () => { sel.race = id; renderRaces(); updatePreview(); };
        raceCards.appendChild(card);
      }
    };
    for (const id of REALM_IDS) {
      const r = REALMS[id];
      const card = el(`<div class="card realm-${id}"><div class="swatch"></div><h3>${esc(r.name)}</h3><div class="sub">${esc(r.title)}</div><div class="desc">${esc(r.description)}</div></div>`);
      card.onclick = () => {
        sel.realm = id; sel.race = null;
        for (const c of realmCards.children) c.classList.toggle('selected', c === card);
        renderRaces(); updatePreview();
      };
      realmCards.appendChild(card);
    }
    for (const id of BASE_CLASS_IDS) {
      const c = CLASSES[id];
      const subs = Object.values(CLASSES).filter((s) => s.base === id).map((s) => s.name).join(' / ');
      const card = el(`<div class="card"><h3>${esc(c.name)}</h3><div class="sub">${esc(c.role)} · atributo: ${c.primary.toUpperCase()}</div><div class="desc">${esc(c.description)}</div><div class="sub" style="margin-top:6px">Nivel 10 → ${esc(subs)}</div></div>`);
      card.onclick = () => { sel.cls = id; for (const k of classCards.children) k.classList.toggle('selected', k === card); updatePreview(); };
      classCards.appendChild(card);
    }
    node.querySelector('#btn-back').onclick = () => this.actions.back();
    node.querySelector('#btn-create').onclick = () => {
      this.clearError();
      const name = node.querySelector('#char-name').value.trim();
      if (!sel.realm) return this.showError('Elige un reino.');
      if (!sel.race) return this.showError('Elige una raza.');
      if (!sel.cls) return this.showError('Elige una clase.');
      if (!CHARNAME_RE.test(name)) return this.showError('Nombre inválido: 3-14 letras, sin espacios ni números.');
      this.setBusy(true);
      this.actions.create({ name, realm: sel.realm, race: sel.race, cls: sel.cls });
    };
    this.root.appendChild(node);
  }
}
