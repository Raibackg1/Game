// server/world/entities.js
// Estado en memoria de las entidades del mundo: jugadores, monstruos y puertas.
import {
  CLASSES, RACES, MOB_TYPES, derivedStats, mobStats, xpForNextLevel, MAX_LEVEL, PLAYER_SPEED,
} from '../../shared/constants.js';
import { terrainHeight } from '../../shared/terrain.js';

let nextEntityId = 1;
export function allocId() { return nextEntityId++; }

export const KIND = Object.freeze({ PLAYER: 'p', MOB: 'm', DOOR: 'd' });

/** Base común: posición, vida, buffs, combate. */
export class Entity {
  constructor(kind, x, z) {
    this.id = allocId();
    this.kind = kind;
    this.x = x; this.z = z; this.yaw = 0;
    this.y = terrainHeight(x, z);
    this.hp = 1; this.maxHp = 1;
    this.level = 1;
    this.realm = null;           // null = neutral
    this.dead = false;
    this.buffs = [];             // { id, stat, value, until, source }
    this.dots = [];              // { id, dmgPerTick, ticksLeft, interval, nextAt, sourceId, heal }
    this.shield = 0; this.shieldUntil = 0;
    this.rootedUntil = 0;
    this.slow = 1; this.slowUntil = 0;
    this.tauntedBy = null; this.tauntUntil = 0;
    this.lastCombatAt = 0;
    this.threat = new Map();     // entityId → daño acumulado (para IA y reparto de XP)
  }
  get alive() { return !this.dead && this.hp > 0; }
  statMult(stat, now) {
    let m = 1;
    for (const b of this.buffs) if (b.stat === stat && b.until > now) m *= b.value;
    return m;
  }
  pruneEffects(now) {
    if (this.buffs.length) this.buffs = this.buffs.filter((b) => b.until > now);
    if (this.shieldUntil && this.shieldUntil <= now) { this.shield = 0; this.shieldUntil = 0; }
    if (this.slowUntil && this.slowUntil <= now) { this.slow = 1; this.slowUntil = 0; }
    if (this.tauntUntil && this.tauntUntil <= now) { this.tauntedBy = null; this.tauntUntil = 0; }
  }
  isRooted(now) { return this.rootedUntil > now; }
  inCombat(now) { return now - this.lastCombatAt < 6000; }
  moveSpeed(now) { return 0; }
  /** Resumen compacto para snapshots. */
  pack(now) {
    return {
      id: this.id, k: this.kind,
      x: +this.x.toFixed(2), z: +this.z.toFixed(2), yaw: +this.yaw.toFixed(2),
      hp: Math.round(this.hp), mhp: this.maxHp, lv: this.level,
      r: this.realm, d: this.dead ? 1 : 0,
    };
  }
}

export class Player extends Entity {
  /** @param {object} row fila de la tabla characters */
  constructor(row, session) {
    super(KIND.PLAYER, row.x, row.z);
    this.charId = row.id;
    this.accountId = row.account_id;
    this.session = session;
    this.name = row.name;
    this.realm = row.realm;
    this.race = row.race;
    this.cls = row.cls;
    this.level = row.level;
    this.xp = row.xp;
    this.gold = row.gold;
    this.yaw = row.yaw;
    this.kills_pve = row.kills_pve; this.kills_pvp = row.kills_pvp;
    this.deaths = row.deaths; this.captures = row.captures;
    this.playtime_seconds = row.playtime_seconds;
    this.enteredAt = Date.now();
    this.recalc();
    this.hp = Math.min(row.hp > 0 ? row.hp : this.maxHp, this.maxHp);
    this.mana = Math.min(row.mana >= 0 ? row.mana : this.maxMana, this.maxMana);
    if (this.hp <= 0) this.hp = this.maxHp;
    // entrada
    this.input = { mx: 0, mz: 0, yaw: row.yaw, seq: 0 };
    this.lastInputAt = 0;
    // combate
    this.targetId = null;
    this.autoAttack = false;
    this.nextAttackAt = 0;
    this.gcdUntil = 0;
    this.cooldowns = new Map();  // skillId → timestamp fin
    this.casting = null;         // { skillId, targetId, endsAt, startX, startZ }
    this.capturing = null;       // { structureId, startedAt, endsAt }
    this.diedAt = 0;
    this.dirtySelf = true;       // hay cambios propios por enviar
    this.known = new Set();      // ids de entidades ya enviadas (para snapshots delta)
    this.lastSnapshotIds = new Set();
  }
  recalc() {
    const d = derivedStats(this.race, this.cls, this.level);
    this.stats = d;
    this.maxHp = d.maxHp; this.maxMana = d.maxMana;
    this.armor = d.armor;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.mana > this.maxMana) this.mana = this.maxMana;
  }
  power(kind) {
    return kind === 'melee' ? this.stats.meleePower : kind === 'ranged' ? this.stats.rangedPower : this.stats.spellPower;
  }
  attackPowerKind() {
    const w = CLASSES[this.cls].weapon;
    return w === 'arco' ? 'ranged' : w === 'baston' ? 'spell' : 'melee';
  }
  moveSpeed(now) {
    if (this.isRooted(now)) return 0;
    return PLAYER_SPEED * this.statMult('speedMult', now) * (this.slowUntil > now ? this.slow : 1);
  }
  /** Añade XP; devuelve número de niveles subidos. */
  addXp(amount) {
    if (this.level >= MAX_LEVEL) return 0;
    this.xp += amount;
    let ups = 0;
    while (this.level < MAX_LEVEL && this.xp >= xpForNextLevel(this.level)) {
      this.xp -= xpForNextLevel(this.level);
      this.level++; ups++;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    if (ups) { this.recalc(); this.hp = this.maxHp; this.mana = this.maxMana; }
    this.dirtySelf = true;
    return ups;
  }
  toRow() {
    return {
      id: this.charId, cls: this.cls, level: this.level, xp: this.xp, gold: this.gold,
      x: this.x, z: this.z, yaw: this.yaw, hp: this.hp, mana: this.mana,
      kills_pve: this.kills_pve, kills_pvp: this.kills_pvp, deaths: this.deaths, captures: this.captures,
      playtime_seconds: this.playtime_seconds + (Date.now() - this.enteredAt) / 1000,
    };
  }
  pack(now) {
    const p = super.pack(now);
    p.n = this.name; p.c = this.cls; p.ra = this.race;
    p.mp = Math.round(this.mana); p.mmp = this.maxMana;
    p.tg = this.targetId;
    if (this.casting) p.cast = { s: this.casting.skillId, e: this.casting.endsAt };
    if (this.capturing) p.cap = { s: this.capturing.structureId, e: this.capturing.endsAt };
    const bf = this.buffs.filter((b) => b.until > now).map((b) => ({ id: b.id, u: b.until }));
    if (bf.length) p.bf = bf;
    if (this.shield > 0 && this.shieldUntil > now) p.sh = Math.round(this.shield);
    if (this.rootedUntil > now) p.rt = 1;
    return p;
  }
  /** Estado privado completo (solo para el propio jugador). */
  packSelf(now) {
    return {
      id: this.id, charId: this.charId, name: this.name, realm: this.realm, race: this.race, cls: this.cls,
      level: this.level, xp: this.xp, xpNext: xpForNextLevel(this.level), gold: this.gold,
      hp: Math.round(this.hp), maxHp: this.maxHp, mana: Math.round(this.mana), maxMana: this.maxMana,
      stats: this.stats, x: +this.x.toFixed(2), z: +this.z.toFixed(2), yaw: this.yaw,
      dead: this.dead, canRespawnAt: this.dead ? this.diedAt + 8000 : 0,
      cooldowns: Object.fromEntries([...this.cooldowns].filter(([, t]) => t > now)),
      gcdUntil: this.gcdUntil,
      buffs: this.buffs.filter((b) => b.until > now).map((b) => ({ id: b.id, stat: b.stat, value: b.value, until: b.until })),
      kills_pve: this.kills_pve, kills_pvp: this.kills_pvp, deaths: this.deaths, captures: this.captures,
      autoAttack: this.autoAttack, targetId: this.targetId,
      needsSubclass: this.level >= 10 && CLASSES[this.cls].tier === 0,
    };
  }
}

export class Mob extends Entity {
  constructor(typeId, level, x, z, opts = {}) {
    super(KIND.MOB, x, z);
    this.typeId = typeId;
    this.type = MOB_TYPES[typeId];
    this.name = this.type.name;
    this.level = level;
    this.realm = opts.realm ?? null;           // guardias pertenecen a un reino
    this.structureId = opts.structureId ?? null;
    this.spawnX = x; this.spawnZ = z;
    this.spawnRadius = opts.spawnRadius ?? 10;
    this.respawnSeconds = opts.respawnSeconds ?? 30;
    const s = mobStats(typeId, level);
    this.stats = s;
    this.maxHp = s.maxHp; this.hp = s.maxHp;
    this.armor = s.armor;
    this.damage = s.damage;
    this.targetId = null;
    this.nextAttackAt = 0;
    this.respawnAt = 0;
    this.wander = { nextAt: 0, tx: x, tz: z };
    this.evading = false;
  }
  moveSpeed(now) {
    if (this.isRooted(now)) return 0;
    return this.stats.speed * (this.slowUntil > now ? this.slow : 1);
  }
  reset() {
    this.hp = this.maxHp; this.dead = false; this.targetId = null; this.threat.clear();
    this.buffs = []; this.dots = []; this.shield = 0; this.rootedUntil = 0; this.slow = 1; this.slowUntil = 0;
    this.tauntedBy = null; this.evading = false;
    this.x = this.spawnX; this.z = this.spawnZ; this.y = terrainHeight(this.x, this.z);
  }
  pack(now) {
    const p = super.pack(now);
    p.t = this.typeId; p.tg = this.targetId;
    if (this.rootedUntil > now) p.rt = 1;
    return p;
  }
}

/** Puerta de un fuerte/castillo: entidad atacable e inmóvil. */
export class Door extends Entity {
  constructor(structure, ownerRealm, x, z) {
    super(KIND.DOOR, x, z);
    this.structureId = structure.id;
    this.name = `Puerta de ${structure.name}`;
    this.level = structure.kind === 'castle' ? 45 : 35;
    this.maxHp = structure.doorHp; this.hp = structure.doorHp;
    this.armor = 40;
    this.realm = ownerRealm;
    this.yaw = structure.doorAngle;
    this.destroyedAt = 0;
  }
  pack(now) {
    const p = super.pack(now);
    p.s = this.structureId;
    return p;
  }
}
