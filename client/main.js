// client/main.js
// Orquestador del cliente: conexión, pantallas, bucle de juego, entrada y HUD.
import { Net } from './net.js';
import { Input } from './input.js';
import { Screens } from './ui/screens.js';
import { HUD } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { Minimap } from './ui/minimap.js';
import { GameScene } from './render/scene.js';
import { ThirdPersonCamera } from './render/camera.js';
import { EntityManager } from './render/entities.js';
import { StructureViews } from './render/structures.js';
import { REALMS, SKILLS, PLAYER_SPEED, CAPTURE_RANGE, skillsFor, MOB_TYPES } from '/shared/constants.js';
import { realmZoneAt, STRUCTURE_BY_ID } from '/shared/worldmap.js';
import { terrainHeight } from '/shared/terrain.js';

const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const TOKEN_KEY = 'reinos.token';
const USER_KEY = 'reinos.user';

const state = {
  username: null,
  characters: [],
  inWorld: false,
  self: null,
  structures: new Map(),
  pendingEnter: null,
};

const net = new Net(WS_URL);
const screens = new Screens(document.getElementById('screens'), {
  login: (u, p) => { state.pendingUser = u; net.send({ t: 'login', username: u, password: p }); },
  register: (u, p) => { state.pendingUser = u; net.send({ t: 'register', username: u, password: p }); },
  create: (data) => net.send({ t: 'create_char', ...data }),
  enter: (charId) => net.send({ t: 'enter', charId }),
  remove: (charId) => net.send({ t: 'delete_char', id: charId }),
  logout: () => { net.send({ t: 'logout' }); localStorage.removeItem(TOKEN_KEY); },
  back: () => screens.showCharacters(state.username, state.characters),
});

let game = null; // instancia activa de Game

function showBanner(text) { const b = document.getElementById('connection-banner'); if (text) { b.textContent = text; b.classList.remove('hidden'); } else b.classList.add('hidden'); }

// ------------------------------------------------------------------ manejadores de red
net.on('_open', () => {
  showBanner(null);
  screens.setStatus('Conectado');
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !state.username) net.send({ t: 'resume', token });
  else if (state.username && token) net.send({ t: 'resume', token }); // reconexión tras caída
});
net.on('_close', ({ wasConnected }) => {
  screens.setStatus('Desconectado');
  if (game) { game.destroy(); game = null; state.inWorld = false; }
  if (wasConnected) showBanner('Conexión perdida. Reconectando…');
  if (!screens.current || screens.current === 'login') screens.showLogin(state.pendingUser || localStorage.getItem(USER_KEY) || '');
  else screens.showLogin(state.username || '');
  screens.showError('Se perdió la conexión con el servidor. Reconectando…');
});
net.on('_reconnecting', ({ delay }) => showBanner(`Sin conexión. Reintentando en ${Math.round(delay / 1000)} s…`));
net.on('auth', (m) => {
  if (m.loggedOut) { state.username = null; state.characters = []; screens.showLogin(''); return; }
  if (!m.ok) { screens.setBusy(false); screens.showError('Autenticación rechazada.'); return; }
  state.username = m.username; state.characters = m.characters;
  localStorage.setItem(TOKEN_KEY, m.token); localStorage.setItem(USER_KEY, m.username);
  if (!state.inWorld) screens.showCharacters(m.username, m.characters);
});
net.on('chars', (m) => {
  state.characters = m.characters;
  screens.showCharacters(state.username, m.characters);
  if (m.created) { const c = m.characters.find((x) => x.id === m.created); if (c) screens.setStatus(`Personaje ${c.name} creado`); }
});
net.on('left', (m) => {
  state.inWorld = false; state.characters = m.characters;
  if (game) { game.destroy(); game = null; }
  screens.showCharacters(state.username, m.characters);
});
net.on('welcome', (m) => {
  state.inWorld = true; state.self = m.self;
  state.structures = new Map(m.structures.map((s) => [s.id, s]));
  screens.hide();
  if (game) game.destroy();
  game = new Game(m);
});
net.on('error', (m) => {
  if (m.code === 'session_expired') {
    localStorage.removeItem(TOKEN_KEY);
    if (state.inWorld && game) { game.destroy(); game = null; state.inWorld = false; }
    state.username = null;
    screens.showLogin(localStorage.getItem(USER_KEY) || '');
    screens.showError(m.message);
    return;
  }
  if (!state.inWorld) { screens.setBusy(false); screens.showError(m.message || m.code); return; }
  if (game) game.onServerError(m);
});
for (const t of ['snap', 'self', 'ev', 'chat', 'struct']) net.on(t, (m) => { if (game) game.onMessage(m); });

// ------------------------------------------------------------------ juego
class Game {
  constructor(welcome) {
    this.self = welcome.self;
    this.selfId = welcome.self.id;
    this.container = document.getElementById('viewport');
    this.scene = new GameScene(this.container);
    this.cam = new ThirdPersonCamera(this.scene.camera);
    this.cam.yaw = (welcome.self.yaw || 0);
    this.entities = new EntityManager(this.scene.scene);
    this.entities.setSelf(this.selfId, this.self.realm, this.self.level);
    this.structures = new StructureViews(this.scene.scene);
    this.structures.build(welcome.structures);
    this.input = new Input(this.container);
    this.hud = new HUD({
      cast: (id) => this.cast(id),
      toggleAttack: () => this.toggleAttack(),
      respawn: () => net.send({ t: 'respawn' }),
      chooseSubclass: (cls) => net.send({ t: 'choose_subclass', cls }),
      leave: () => net.send({ t: 'leave' }),
    });
    this.hud.serverNow = () => net.serverNow();
    this.hud.show();
    this.hud.setStructures(welcome.structures);
    this.hud.updateSelf(this.self);
    this.chat = new Chat(document.getElementById('chat'), (ch, text) => net.send({ t: 'chat', ch, text }));
    this.minimap = new Minimap(document.getElementById('minimap'), document.getElementById('world-map'));
    this.lastInputSent = 0; this.lastInputVec = { mx: 0, mz: 0 };
    this.running = true;
    this.clock = 0; this.lastFrame = performance.now();
    this.currentZone = undefined;
    this.chat.add({ ch: 'system', text: `Bienvenido a ${REALMS[this.self.realm].name}, ${this.self.name}. Pulsa H para ver los controles.`, ts: Date.now() });
    this.chat.add({ ch: 'system', text: `Jugadores conectados: ${welcome.online}.`, ts: Date.now() });
    this._bindInput();
    this._lastTargetRefresh = 0;
    this._interactStruct = null;
    requestAnimationFrame((t) => this.frame(t));
  }

  destroy() {
    this.running = false;
    this.hud.hide();
    this.hud.hideCast();
    this.entities.clear();
    this.scene.dispose();
    for (const off of this._offs || []) off();
  }

  // ---------------------------------------------------------------- entrada
  _bindInput() {
    this._offs = [];
    this._offs.push(this.input.onKey((e, first) => {
      if (!first) return;
      const code = e.code;
      if (code === 'Enter') { e.preventDefault(); this.chat.focus(); return; }
      if (code === 'Escape') {
        if (this.hud.isOverlayOpen('world-map-overlay') || this.hud.isOverlayOpen('help-overlay')) { this.hud.hideOverlays(); if (this.self.dead) this.hud.updateSelf(this.self); return; }
        this.setTarget(null); return;
      }
      if (code === 'Tab') { e.preventDefault(); this.tabTarget(); return; }
      if (code === 'KeyT') { this.toggleAttack(); return; }
      if (code === 'KeyF') { this.interact(); return; }
      if (code === 'KeyR') { if (this.self.dead) net.send({ t: 'respawn' }); return; }
      if (code === 'KeyM') { const open = this.hud.toggleOverlay('world-map-overlay'); if (open) this.minimap.drawWorld(this.selfPos(), state.structures, this.entities.views); return; }
      if (code === 'KeyH') { this.hud.toggleOverlay('help-overlay'); return; }
      if (/^Digit[1-9]$/.test(code)) { const idx = Number(code.slice(5)) - 1; const s = this.hud.skillSlots[idx]; if (s) this.cast(s.id); return; }
    }));
    this._offs.push(this.input.onClick((x, y, button) => {
      if (button !== 0) return;
      const r = this.scene.renderer.domElement.getBoundingClientRect();
      const nx = ((x - r.left) / r.width) * 2 - 1, ny = -((y - r.top) / r.height) * 2 + 1;
      const id = this.entities.pick(nx, ny, this.scene.camera);
      this.setTarget(id);
    }));
  }

  selfPos() {
    const v = this.entities.get(this.selfId);
    return v ? { id: this.selfId, x: v.pos.x, z: v.pos.z, yaw: v.yaw } : { id: this.selfId, x: this.self.x, z: this.self.z, yaw: this.self.yaw };
  }

  setTarget(id) {
    if (id === this.selfId) id = null;
    this.entities.setTarget(id);
    net.send({ t: 'target', id });
    this.self.targetId = id;
    this._refreshTargetFrame();
  }
  tabTarget() {
    const list = this.entities.hostilesSorted(60);
    if (!list.length) { this.hud.center('No hay enemigos cerca', 'error'); return; }
    const cur = list.findIndex((v) => v.id === this.entities.targetId);
    const next = list[(cur + 1) % list.length];
    this.setTarget(next.id);
  }
  toggleAttack() {
    if (this.self.dead) return;
    if (!this.self.autoAttack && this.entities.targetId == null) { this.hud.center('Selecciona un objetivo (clic o Tab)', 'error'); return; }
    net.send({ t: 'attack', on: !this.self.autoAttack });
  }
  cast(skillId) {
    if (this.self.dead) return;
    const s = SKILLS[skillId]; if (!s) return;
    if (s.target === 'enemy' && this.entities.targetId == null) {
      // auto-selección del enemigo más cercano
      const list = this.entities.hostilesSorted(s.range + 1);
      if (list.length) this.setTarget(list[0].id);
      else { this.hud.center('Necesitas un objetivo', 'error'); return; }
    }
    net.send({ t: 'cast', skill: skillId, target: this.entities.targetId });
  }
  interact() {
    if (this.self.dead) return;
    const p = this.selfPos();
    const s = this.structures.nearest(p.x, p.z, CAPTURE_RANGE + 1);
    if (!s) { this.hud.center('No hay ninguna bandera cerca', 'error'); return; }
    net.send({ t: 'interact', id: s.id });
  }

  // ---------------------------------------------------------------- mensajes
  onMessage(m) {
    switch (m.t) {
      case 'snap': this.entities.applySnapshot(m); break;
      case 'self': {
        const prev = this.self;
        this.self = m.self;
        this.entities.myLevel = m.self.level;
        this.entities.setTarget(m.self.targetId ?? null);
        this.hud.updateSelf(m.self);
        if (prev && m.self.gold > prev.gold) this.hud.toast(`+${m.self.gold - prev.gold} oro`, 'gold');
        if (prev && !prev.dead && m.self.dead) this.hud.setDeathText('Has caído en combate.');
        break;
      }
      case 'ev': this.onEvent(m); break;
      case 'chat': this.chat.add(m, m.realm ? REALMS[m.realm]?.cssColor : null); if (m.ch === 'system' && /captur|caído|reparad/.test(m.text)) this.hud.center(m.text, 'war'); break;
      case 'struct': state.structures.set(m.s.id, m.s); this.structures.update(m.s); this.hud.updateStructure(m.s); break;
      default: break;
    }
  }
  onEvent(ev) {
    this.entities.onEvent(ev, this.clock);
    switch (ev.e) {
      case 'damage': {
        if (ev.src === this.selfId || ev.dst === this.selfId) {
          const src = this.entities.get(ev.src), dst = this.entities.get(ev.dst);
          const sn = ev.src === this.selfId ? 'Tú' : (src?.nameEl.textContent ?? '?');
          const dn = ev.dst === this.selfId ? 'ti' : (dst?.nameEl.textContent ?? '?');
          const skill = ev.skill ? SKILLS[ev.skill]?.name : ev.tag === 'dot' ? 'daño periódico' : 'ataque';
          this.chat.add({ ch: 'combat', text: `${sn} → ${dn}: ${ev.amt}${ev.crit ? ' (crítico)' : ''} [${skill}]`, ts: Date.now() });
        }
        break;
      }
      case 'xp': this.hud.toast(`+${ev.amt} XP${ev.reason === 'pvp' ? ' (PvP)' : ev.reason === 'captura' ? ' (captura)' : ''}`, 'ok'); this.entities.floatText(this.selfId, `+${ev.amt} XP`, 'xp', 0.5); break;
      case 'level_up': if (ev.id === this.selfId) { this.hud.center(`¡Has subido al nivel ${ev.level}!`, 'levelup'); } break;
      case 'death': if (ev.id === this.selfId) { this.hud.setDeathText(ev.killerName ? `${ev.killerName} te ha derrotado.` : 'Has caído en combate.'); } else if (ev.killer === this.selfId) { const v = this.entities.get(ev.id); this.chat.add({ ch: 'combat', text: `Has derrotado a ${v?.nameEl.textContent ?? 'un enemigo'}.`, ts: Date.now() }); } break;
      case 'cast_start': if (ev.src === this.selfId) this._castEnd = ev.endsAt, this._castSkill = ev.skill; break;
      case 'cast_end': if (ev.src === this.selfId) { this._castEnd = 0; this.hud.hideCast(); if (ev.cancelled) this.hud.center('Canalización interrumpida', 'error'); } break;
      case 'capture_progress': break;
      case 'capture_cancel': if (ev.playerId === this.selfId) this.hud.center(`Captura cancelada: ${ev.reason}`, 'error'); break;
      case 'structure_captured': this.hud.center(`${STRUCTURE_BY_ID[ev.structureId]?.name ?? ev.structureId} capturado por ${REALMS[ev.to]?.name}`, 'war'); break;
      case 'door_destroyed': this.hud.center(`¡Puerta de ${STRUCTURE_BY_ID[ev.structureId]?.name ?? '?'} destruida!`, 'war'); break;
      default: break;
    }
  }
  onServerError(m) {
    const quiet = ['on_cooldown', 'rate_limit'];
    if (!quiet.includes(m.code)) this.hud.center(m.message || m.code, 'error');
    else if (m.code === 'on_cooldown' && m.skill) this.hud.center(m.message, 'error');
    this.chat.add({ ch: 'error', text: m.message || m.code, ts: Date.now() });
  }
  _refreshTargetFrame() {
    const v = this.entities.targetId != null ? this.entities.get(this.entities.targetId) : null;
    this.hud.updateTarget(v, v ? this.entities.isHostile(v.data) : false);
  }

  // ---------------------------------------------------------------- bucle
  frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t; this.clock += dt;
    const serverNow = net.serverNow();

    // cámara
    const drag = this.input.consumeDrag();
    if (this.input.mouse.dragging || Math.abs(drag.dx) + Math.abs(drag.dy) > 0) this.cam.rotate(drag.dx, drag.dy);
    const wheel = this.input.consumeWheel();
    if (wheel) this.cam.zoom(wheel);

    // movimiento
    const axes = this.chat.isFocused() || this.self.dead ? { f: 0, r: 0 } : this.input.moveAxes();
    let mx = 0, mz = 0;
    if (axes.f || axes.r) {
      const f = this.cam.forward(), r = this.cam.right();
      mx = f.x * axes.f + r.x * axes.r; mz = f.z * axes.f + r.z * axes.r;
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    }
    const meView = this.entities.get(this.selfId);
    let yaw = meView ? meView.yaw : this.self.yaw;
    if (mx || mz) yaw = Math.atan2(mx, mz);
    const moving = mx !== 0 || mz !== 0;
    const wasMoving = this.lastInputVec.mx !== 0 || this.lastInputVec.mz !== 0;
    if (moving || wasMoving) {
      if (t - this.lastInputSent > 50 || (!moving && wasMoving)) {
        net.send({ t: 'input', mx, mz, yaw });
        this.lastInputSent = t; this.lastInputVec = { mx, mz };
      }
    }
    // predicción local
    if (meView && !this.self.dead) {
      const speedMult = (this.self.buffs || []).filter((b) => b.stat === 'speedMult' && b.until > serverNow).reduce((a, b) => a * b.value, 1);
      const rooted = meView.data.rt;
      this.entities.predictSelf(mx, mz, rooted ? 0 : PLAYER_SPEED * speedMult, dt);
      if (moving) meView.yaw = yaw, meView.next && (meView.next.yaw = yaw), meView.prev && (meView.prev.yaw = yaw);
    }

    this.entities.update(dt, serverNow, this.clock);
    this.structures.animate(this.clock, serverNow);

    const p = this.selfPos();
    const py = terrainHeight(p.x, p.z);
    this.cam.update(p.x, py, p.z, dt);
    this.scene.follow(p.x, p.z, dt);
    this.scene.render();

    // HUD periódico
    this.hud.tick(serverNow);
    this.hud.tickCaptures(serverNow);
    if (this._castEnd) this.hud.showCast(this._castSkill, this._castEnd, serverNow);
    if (t - this._lastTargetRefresh > 100) {
      this._lastTargetRefresh = t;
      this._refreshTargetFrame();
      this.minimap.drawLocal(p, this.entities.views, state.structures, this.cam.yaw);
      document.getElementById('minimap-coords').textContent = `${p.x.toFixed(0)}, ${p.z.toFixed(0)}`;
      const zone = realmZoneAt(p.x, p.z);
      if (zone !== this.currentZone) {
        this.currentZone = zone;
        if (zone) this.hud.setZone(`${REALMS[zone].name} — ${zone === this.self.realm ? 'zona segura' : '¡territorio enemigo (invasión)!'}`, zone !== this.self.realm);
        else this.hud.setZone('Zona de guerra ⚔️ (PvP activo)', true);
      }
      this.hud.setStats(`${net.latency} ms · ${net.online} en línea`);
      // interacción con banderas
      const s = this.structures.nearest(p.x, p.z, CAPTURE_RANGE + 1);
      if (s) {
        const st = state.structures.get(s.id);
        if (st.owner === this.self.realm) this.hud.setInteract(`${st.name} pertenece a tu reino`);
        else if (!st.doorDestroyed) this.hud.setInteract(`Derriba la puerta de ${st.name} antes de capturar`);
        else if (this.self.capturing || st.capture?.playerId === this.selfId) this.hud.setInteract(`Capturando ${st.name}… no te muevas`);
        else this.hud.setInteract(`<b>[F]</b> Capturar ${st.name}`);
      } else this.hud.setInteract(null);
      if (this.hud.isOverlayOpen('world-map-overlay')) this.minimap.drawWorld(p, state.structures, this.entities.views);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}

// ------------------------------------------------------------------ arranque
screens.showLogin(localStorage.getItem(USER_KEY) || '');
screens.setStatus('Conectando…');
showBanner('Conectando con el servidor…');
net.connect().catch((err) => {
  showBanner('No se pudo conectar: ' + err.message);
  screens.showError('No se pudo conectar con el servidor. Reintentando automáticamente…');
});
window.__game = { state, net, get game() { return game; } }; // depuración y pruebas automatizadas
