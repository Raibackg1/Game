// server/world/world.js
// Mundo autoritativo: bucle de simulación, rejilla espacial, reglas de movimiento,
// habilidades, muerte/XP y envío de snapshots por interés.
import {
  INTEREST_RADIUS, TICK_RATE, SNAPSHOT_RATE, PLAYER_SPEED, RESPAWN_DELAY, GLOBAL_COOLDOWN,
  HP_REGEN_PCT, MANA_REGEN_PCT, SKILLS, CLASSES, skillsFor, xpForKill, REALMS, REALM_BONUS_PER_STRUCTURE,
  SAY_RADIUS, WORLD_HALF, MAX_LEVEL,
} from '../../shared/constants.js';
import { REALM_CENTERS, realmZoneAt, isWarZone, insideWorld, SPAWN_PLATEAU_RADIUS } from '../../shared/worldmap.js';
import { terrainHeight } from '../../shared/terrain.js';
import { dist, clamp } from '../../shared/math.js';
import { S2C, EV, ERR } from '../../shared/messages.js';
import { KIND, Player } from './entities.js';
import { MobSpawner } from './mobs.js';
import { StructureManager } from './structures.js';
import { canAttack, isAlly, executeSkill, tickPeriodicEffects, tryAutoAttack } from './combat.js';
import { log } from '../log.js';

const CELL = 64;
const INPUT_TIMEOUT_MS = 600;

export class World {
  /**
   * @param {import('../db.js').GameDB} db
   * @param {{ rng?: () => number }} [opts]
   */
  constructor(db, opts = {}) {
    this.db = db;
    this.rng = opts.rng || Math.random;
    this.entities = new Map();
    this.players = new Map();
    this.mobs = new Map();
    this.doors = new Map();
    this.grid = new Map();      // "cx,cz" → Set<Entity>
    this.cellOf = new Map();    // entityId → "cx,cz"
    this.spawner = new MobSpawner(this);
    this.structures = new StructureManager(this, db);
    this.tickCount = 0;
    this.startedAt = Date.now();
    this._timer = null;
    this._snapTimer = null;
    this._saveTimer = null;
    this.lastTickAt = 0;
    this.stats = { tickMsMax: 0, tickMsAvg: 0 };
  }

  // --- ciclo de vida -----------------------------------------------------------
  init() {
    const n = this.spawner.spawnAll();
    this.structures.init();
    log.info(`Mundo inicializado: ${n} monstruos, ${this.doors.size} puertas, ${this.mobs.size - n} guardias`);
  }
  start(saveIntervalSeconds = 30) {
    this.lastTickAt = Date.now();
    this._timer = setInterval(() => this._safeTick(), 1000 / TICK_RATE);
    this._snapTimer = setInterval(() => this.sendSnapshots(), 1000 / SNAPSHOT_RATE);
    this._saveTimer = setInterval(() => this.saveAll(), saveIntervalSeconds * 1000);
  }
  stop() {
    clearInterval(this._timer); clearInterval(this._snapTimer); clearInterval(this._saveTimer);
    this._timer = this._snapTimer = this._saveTimer = null;
  }
  _safeTick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    const t0 = performance.now();
    try {
      this.tick(dt, now);
    } catch (err) {
      log.error('Error en tick del mundo', { err: err.stack || err.message });
    }
    const ms = performance.now() - t0;
    this.stats.tickMsMax = Math.max(this.stats.tickMsMax, ms);
    this.stats.tickMsAvg = this.stats.tickMsAvg * 0.95 + ms * 0.05;
  }

  // --- rejilla espacial ---------------------------------------------------------
  _key(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }
  addEntity(e) {
    this.entities.set(e.id, e);
    if (e.kind === KIND.PLAYER) this.players.set(e.id, e);
    else if (e.kind === KIND.MOB) this.mobs.set(e.id, e);
    else if (e.kind === KIND.DOOR) this.doors.set(e.id, e);
    this.updateGrid(e);
  }
  removeEntity(e) {
    const k = this.cellOf.get(e.id);
    if (k) { this.grid.get(k)?.delete(e); this.cellOf.delete(e.id); }
    this.entities.delete(e.id); this.players.delete(e.id); this.mobs.delete(e.id); this.doors.delete(e.id);
  }
  updateGrid(e) {
    const k = this._key(e.x, e.z);
    const prev = this.cellOf.get(e.id);
    if (prev === k) return;
    if (prev) this.grid.get(prev)?.delete(e);
    let set = this.grid.get(k);
    if (!set) { set = new Set(); this.grid.set(k, set); }
    set.add(e); this.cellOf.set(e.id, k);
  }
  getEntity(id) { return this.entities.get(id) || null; }
  entitiesWithin(x, z, r) {
    const out = [];
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const set = this.grid.get(`${cx},${cz}`);
      if (!set) continue;
      for (const e of set) {
        const dx = e.x - x, dz = e.z - z;
        if (dx * dx + dz * dz <= r2) out.push(e);
      }
    }
    return out;
  }
  playersWithin(x, z, r) { return this.entitiesWithin(x, z, r).filter((e) => e.kind === KIND.PLAYER); }
  isWarZone = (x, z) => isWarZone(x, z);

  // --- mensajería ----------------------------------------------------------------
  broadcastAll(msg) { for (const p of this.players.values()) p.session?.send(msg); }
  broadcastRealm(realm, msg) { for (const p of this.players.values()) if (p.realm === realm) p.session?.send(msg); }
  broadcastNear(ent, msg, radius = INTEREST_RADIUS) {
    for (const p of this.playersWithin(ent.x, ent.z, radius)) p.session?.send(msg);
  }
  systemMessage(text, realm = null) {
    const msg = { t: S2C.CHAT, ch: 'system', from: null, realm: null, text, ts: Date.now() };
    if (realm) this.broadcastRealm(realm, msg); else this.broadcastAll(msg);
  }

  // --- jugadores -------------------------------------------------------------------
  /** Posición de aparición del reino, con dispersión. */
  spawnPoint(realm) {
    const c = REALM_CENTERS[realm];
    const a = this.rng() * Math.PI * 2, r = 4 + this.rng() * 10;
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
  }
  /** ¿Puede un jugador del reino `realm` estar en (x,z)? (fronteras de reino / invasión) */
  canStandAt(realm, x, z) {
    if (!insideWorld(x, z)) return false;
    const zone = realmZoneAt(x, z);
    if (!zone || zone === realm) return true;
    const castle = this.structures.get(`castle_${zone}`);
    return !!castle && castle.owner === realm; // invasión: solo si tu reino posee su castillo
  }
  addPlayer(row, session) {
    const p = new Player(row, session);
    if (!this.canStandAt(p.realm, p.x, p.z) || Number.isNaN(p.x) || Number.isNaN(p.z)) {
      const sp = this.spawnPoint(p.realm); p.x = sp.x; p.z = sp.z;
    }
    p.y = terrainHeight(p.x, p.z);
    p.input.yaw = p.yaw;
    this.addEntity(p);
    this.broadcastRealm(p.realm, { t: S2C.CHAT, ch: 'system', text: `${p.name} ha entrado en ${REALMS[p.realm].name}.`, ts: Date.now() });
    return p;
  }
  removePlayer(p) {
    if (p.capturing) this.structures.cancelCapture(p, 'desconexión');
    this.savePlayer(p);
    this.removeEntity(p);
    for (const m of this.mobs.values()) { if (m.targetId === p.id) m.targetId = null; m.threat.delete(p.id); }
    for (const o of this.players.values()) if (o.targetId === p.id) o.targetId = null;
  }
  savePlayer(p) {
    try { this.db.saveCharacter(p.toRow()); }
    catch (err) { log.error('Error guardando personaje', { char: p.name, err: err.message }); }
  }
  saveAll() {
    let n = 0;
    for (const p of this.players.values()) { this.savePlayer(p); n++; }
    if (n) log.debug(`Guardados ${n} personajes`);
  }
  welcomePayload(p, now) {
    return {
      t: S2C.WELCOME,
      self: p.packSelf(now),
      structures: this.structures.publicStates(),
      serverTime: now,
      realmBonus: Object.fromEntries(Object.keys(REALMS).map((r) => [r, this.structures.countOwned(r) * REALM_BONUS_PER_STRUCTURE])),
      online: this.players.size,
    };
  }

  // --- entrada ------------------------------------------------------------------------
  setInput(p, mx, mz, yaw, now) {
    let len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; len = 1; }
    p.input.mx = mx; p.input.mz = mz; p.input.yaw = yaw;
    p.lastInputAt = now;
  }
  setTarget(p, id) {
    if (id === null) { p.targetId = null; p.autoAttack = false; p.dirtySelf = true; return null; }
    const e = this.getEntity(id);
    if (!e || dist(p.x, p.z, e.x, e.z) > INTEREST_RADIUS) return ERR.INVALID_TARGET;
    if (p.targetId !== id) { p.targetId = id; p.autoAttack = false; p.dirtySelf = true; }
    return null;
  }
  setAutoAttack(p, on) {
    if (!p.alive) return ERR.DEAD;
    if (on) {
      const t = p.targetId ? this.getEntity(p.targetId) : null;
      if (!t) return ERR.NO_TARGET;
      if (!canAttack(p, t, this.isWarZone)) return ERR.INVALID_TARGET;
    }
    p.autoAttack = !!on; p.dirtySelf = true;
    return null;
  }

  /** Uso de habilidad. Devuelve null si OK o {code,message}. */
  useSkill(p, skillId, targetId, now) {
    const skill = SKILLS[skillId];
    if (!skill) return { code: ERR.UNKNOWN_SKILL, message: 'Habilidad desconocida.' };
    if (!p.alive) return { code: ERR.DEAD, message: 'Estás muerto.' };
    if (p.casting) return { code: ERR.CASTING, message: 'Ya estás lanzando una habilidad.' };
    if (!skillsFor(p.cls, p.level).some((s) => s.id === skillId)) return { code: ERR.UNKNOWN_SKILL, message: 'Tu clase o nivel no permite esa habilidad.' };
    if (now < p.gcdUntil) return { code: ERR.ON_COOLDOWN, message: 'Espera un momento.' };
    const cd = p.cooldowns.get(skillId) || 0;
    if (now < cd) return { code: ERR.ON_COOLDOWN, message: `${skill.name} en enfriamiento (${((cd - now) / 1000).toFixed(1)} s).` };
    if (p.mana < skill.mana) return { code: ERR.NO_MANA, message: 'Maná insuficiente.' };

    // resolver objetivo
    let target;
    if (skill.target === 'self') target = p;
    else {
      const t = targetId != null ? this.getEntity(targetId) : (p.targetId != null ? this.getEntity(p.targetId) : null);
      if (skill.target === 'ally') {
        target = t && t.alive && isAlly(p, t) ? t : p;
      } else {
        if (!t) return { code: ERR.NO_TARGET, message: 'Necesitas un objetivo.' };
        if (!canAttack(p, t, this.isWarZone)) return { code: ERR.INVALID_TARGET, message: 'No puedes atacar a ese objetivo aquí.' };
        target = t;
      }
      if (target !== p && dist(p.x, p.z, target.x, target.z) > skill.range + 1) return { code: ERR.OUT_OF_RANGE, message: 'Objetivo fuera de alcance.' };
    }
    if (p.capturing) this.structures.cancelCapture(p, 'habilidad usada');

    p.mana -= skill.mana;
    p.cooldowns.set(skillId, now + skill.cooldown * 1000);
    p.gcdUntil = now + GLOBAL_COOLDOWN * 1000;
    p.lastCombatAt = skill.target === 'enemy' ? now : p.lastCombatAt;
    p.dirtySelf = true;
    if (skill.target === 'enemy') { p.targetId = target.id; p.autoAttack = true; }

    if (skill.castTime > 0) {
      p.casting = { skillId, targetId: target.id, endsAt: now + skill.castTime * 1000, sx: p.x, sz: p.z };
      this.broadcastNear(p, { t: S2C.EVENT, e: EV.CAST_START, src: p.id, skill: skillId, dst: target.id, endsAt: p.casting.endsAt });
    } else {
      this.broadcastNear(p, { t: S2C.EVENT, e: EV.CAST_END, src: p.id, skill: skillId, dst: target.id });
      executeSkill(this, p, skill, target, now);
    }
    return null;
  }

  interact(p, structureId, now) {
    const r = this.structures.startCapture(p, structureId, now);
    if (r === null) return null;
    return typeof r === 'string' ? { code: r, message: r } : r;
  }

  respawn(p, now) {
    if (!p.dead) return { code: ERR.BAD_REQUEST, message: 'No estás muerto.' };
    if (now < p.diedAt + RESPAWN_DELAY * 1000) return { code: ERR.BAD_REQUEST, message: 'Aún no puedes reaparecer.' };
    const sp = this.spawnPoint(p.realm);
    p.x = sp.x; p.z = sp.z; p.y = terrainHeight(sp.x, sp.z);
    p.dead = false; p.hp = p.maxHp; p.mana = p.maxMana;
    p.buffs = []; p.dots = []; p.shield = 0; p.rootedUntil = 0; p.slow = 1; p.slowUntil = 0;
    p.targetId = null; p.autoAttack = false; p.casting = null; p.threat.clear();
    p.dirtySelf = true;
    this.updateGrid(p);
    this.broadcastNear(p, { t: S2C.EVENT, e: EV.RESPAWN, id: p.id });
    return null;
  }

  chooseSubclass(p, cls) {
    const c = CLASSES[cls];
    if (!c || c.base !== p.cls) return { code: ERR.INVALID_CLASS, message: 'Subclase no válida para tu clase.' };
    if (p.level < 10) return { code: ERR.SUBCLASS_NOT_AVAILABLE, message: 'Necesitas nivel 10.' };
    p.cls = cls; p.recalc(); p.hp = p.maxHp; p.mana = p.maxMana; p.dirtySelf = true;
    this.savePlayer(p);
    this.broadcastRealm(p.realm, { t: S2C.CHAT, ch: 'system', text: `${p.name} se ha convertido en ${c.name}.`, ts: Date.now() });
    return null;
  }

  chat(p, channel, text) {
    const msg = { t: S2C.CHAT, ch: channel, from: p.name, fromId: p.id, realm: p.realm, text, ts: Date.now() };
    if (channel === 'say') this.broadcastNear(p, msg, SAY_RADIUS);
    else if (channel === 'realm') this.broadcastRealm(p.realm, msg);
    else this.broadcastAll(msg);
  }

  // --- muerte / experiencia --------------------------------------------------------------
  onDeath(target, killer, now) {
    target.dead = true; target.hp = 0;
    target.buffs = []; target.dots = []; target.shield = 0;
    this.broadcastNear(target, { t: S2C.EVENT, e: EV.DEATH, id: target.id, killer: killer ? killer.id : null, killerName: killer?.name ?? null });

    if (target.kind === KIND.MOB) {
      target.respawnAt = now + target.respawnSeconds * 1000;
      target.targetId = null;
      this._rewardKill(target, now);
      target.threat.clear();
    } else if (target.kind === KIND.PLAYER) {
      target.diedAt = now; target.deaths++;
      target.casting = null; target.autoAttack = false;
      if (target.capturing) this.structures.cancelCapture(target, 'muerte');
      target.dirtySelf = true;
      for (const m of this.mobs.values()) { if (m.targetId === target.id) m.targetId = null; m.threat.delete(target.id); }
      if (killer && killer.kind === KIND.PLAYER) {
        killer.kills_pvp++;
        const xp = Math.max(10, Math.floor(xpForKill(target.level, killer.level) * 1.5));
        const ups = killer.addXp(xp);
        killer.session?.send({ t: S2C.EVENT, e: EV.XP, amt: xp, reason: 'pvp' });
        if (ups) this.onLevelUp(killer, ups, now);
        this.systemMessage(`⚔️ ${killer.name} (${REALMS[killer.realm].name}) ha derrotado a ${target.name} (${REALMS[target.realm].name}).`);
      }
    } else if (target.kind === KIND.DOOR) {
      this.structures.onDoorDestroyed(target, killer, now);
    }
  }

  _rewardKill(mob, now) {
    let total = 0;
    const contributors = [];
    for (const [id, dmg] of mob.threat) {
      const p = this.players.get(id);
      if (!p || !p.alive || dist(p.x, p.z, mob.x, mob.z) > 120) continue;
      contributors.push([p, dmg]); total += dmg;
    }
    if (!contributors.length || total <= 0) return;
    contributors.sort((a, b) => b[1] - a[1]);
    const guardFactor = mob.type.guard ? 0.25 : 1;
    for (const [p, dmg] of contributors) {
      const share = Math.max(0.35, dmg / total);
      const bonus = 1 + this.structures.countOwned(p.realm) * REALM_BONUS_PER_STRUCTURE;
      const xp = Math.max(1, Math.floor(xpForKill(mob.level, p.level, !!mob.type.elite) * share * guardFactor * bonus));
      const ups = p.addXp(xp);
      p.kills_pve++;
      p.session?.send({ t: S2C.EVENT, e: EV.XP, amt: xp, reason: 'kill', mob: mob.typeId });
      if (ups) this.onLevelUp(p, ups, now);
    }
    const top = contributors[0][0];
    const gold = mob.stats.gold;
    top.gold += gold; top.dirtySelf = true;
    top.session?.send({ t: S2C.EVENT, e: EV.GOLD, amt: gold });
  }

  onLevelUp(p, ups, now) {
    this.broadcastNear(p, { t: S2C.EVENT, e: EV.LEVEL_UP, id: p.id, level: p.level });
    if (p.level >= 10 && CLASSES[p.cls].tier === 0) {
      p.session?.send({ t: S2C.CHAT, ch: 'system', text: '¡Has alcanzado el nivel 10! Elige tu subclase.', ts: now });
    }
    this.savePlayer(p);
  }

  // --- simulación ----------------------------------------------------------------------------
  tick(dt, now) {
    this.tickCount++;
    for (const p of this.players.values()) this._tickPlayer(p, dt, now);
    this.spawner.tick(dt, now);
    for (const d of this.doors.values()) { d.pruneEffects(now); tickPeriodicEffects(this, d, now); }
    this.structures.tick(now);
  }

  _tickPlayer(p, dt, now) {
    p.pruneEffects(now);
    if (p.dead) return;
    tickPeriodicEffects(this, p, now);
    if (!p.alive) return;

    // movimiento
    const active = now - p.lastInputAt < INPUT_TIMEOUT_MS;
    const mx = active ? p.input.mx : 0, mz = active ? p.input.mz : 0;
    p.yaw = p.input.yaw;
    if (mx !== 0 || mz !== 0) {
      const speed = p.moveSpeed(now);
      if (speed > 0) {
        const nx = clamp(p.x + mx * speed * dt, -WORLD_HALF + 5, WORLD_HALF - 5);
        const nz = clamp(p.z + mz * speed * dt, -WORLD_HALF + 5, WORLD_HALF - 5);
        if (this.canStandAt(p.realm, nx, nz)) {
          p.x = nx; p.z = nz; p.y = terrainHeight(nx, nz);
          this.updateGrid(p);
        }
        if (p.casting && dist(p.x, p.z, p.casting.sx, p.casting.sz) > 0.5) {
          this.broadcastNear(p, { t: S2C.EVENT, e: EV.CAST_END, src: p.id, skill: p.casting.skillId, cancelled: true });
          p.casting = null; p.dirtySelf = true;
        }
      }
    }

    // regeneración
    const inCombat = p.inCombat(now);
    if (!inCombat && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * HP_REGEN_PCT * dt); p.dirtySelf = true; }
    if (p.mana < p.maxMana) { p.mana = Math.min(p.maxMana, p.mana + p.maxMana * MANA_REGEN_PCT * (inCombat ? 0.5 : 1) * dt); p.dirtySelf = true; }

    // fin de casteo
    if (p.casting && now >= p.casting.endsAt) {
      const c = p.casting; p.casting = null;
      const skill = SKILLS[c.skillId];
      const target = this.getEntity(c.targetId);
      let ok = !!target && target.alive;
      if (ok && skill.target === 'enemy') ok = canAttack(p, target, this.isWarZone) && dist(p.x, p.z, target.x, target.z) <= skill.range + 2;
      if (ok && skill.target === 'ally') ok = isAlly(p, target) && dist(p.x, p.z, target.x, target.z) <= skill.range + 2;
      this.broadcastNear(p, { t: S2C.EVENT, e: EV.CAST_END, src: p.id, skill: c.skillId, dst: c.targetId, cancelled: !ok });
      if (ok) executeSkill(this, p, skill, target, now);
      else p.session?.sendError(ERR.INVALID_TARGET, 'El objetivo ya no es válido.');
      p.dirtySelf = true;
    }

    // autoataque
    if (p.autoAttack && !p.casting) {
      const t = p.targetId ? this.getEntity(p.targetId) : null;
      if (!t || !t.alive || !canAttack(p, t, this.isWarZone)) { p.autoAttack = false; p.dirtySelf = true; }
      else if (tryAutoAttack(this, p, t, now)) p.dirtySelf = true;
    }
  }

  // --- snapshots ----------------------------------------------------------------------------
  sendSnapshots() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.session) continue;
      const visible = this.entitiesWithin(p.x, p.z, INTEREST_RADIUS);
      const ents = [];
      const seen = new Set();
      for (const e of visible) {
        if (e.kind === KIND.MOB && e.dead) continue; // monstruos muertos desaparecen
        seen.add(e.id);
        ents.push(e.pack(now));
      }
      const gone = [];
      for (const id of p.known) if (!seen.has(id)) gone.push(id);
      p.known = seen;
      p.session.send({ t: S2C.SNAPSHOT, ts: now, ents, gone });
      if (p.dirtySelf || (this.tickCount % 20 === 0)) {
        p.dirtySelf = false;
        p.session.send({ t: S2C.SELF, self: p.packSelf(now) });
      }
    }
  }
}
export { MAX_LEVEL, PLAYER_SPEED, SPAWN_PLATEAU_RADIUS };
