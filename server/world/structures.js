// server/world/structures.js
// Fuertes y castillos: puerta destruible, guardias, canalización de captura y bonos de reino.
import { STRUCTURES, structureDoorPos, structureFlagPos } from '../../shared/worldmap.js';
import { CAPTURE_TIME, CAPTURE_RANGE, DOOR_REPAIR_DELAY, REALMS } from '../../shared/constants.js';
import { EV, S2C, ERR } from '../../shared/messages.js';
import { terrainHeight } from '../../shared/terrain.js';
import { dist } from '../../shared/math.js';
import { Door } from './entities.js';
import { log } from '../log.js';

export class StructureManager {
  constructor(world, db) {
    this.world = world;
    this.db = db;
    this.states = new Map(); // id → estado
  }

  init() {
    const owners = Object.fromEntries(this.db.getStructures().map((r) => [r.id, r.owner_realm]));
    for (const def of STRUCTURES) {
      const owner = owners[def.id] || def.realm;
      const dp = structureDoorPos(def);
      const door = new Door(def, owner, dp.x, dp.z);
      this.world.addEntity(door);
      const state = { def, owner, door, guards: [], capture: null };
      // guardias en anillo alrededor de la bandera
      for (let i = 0; i < def.guards; i++) {
        const a = (i / def.guards) * Math.PI * 2;
        const r = def.radius * 0.45;
        const gx = def.x + Math.cos(a) * r, gz = def.z + Math.sin(a) * r;
        state.guards.push(this.world.spawner.spawnGuard(def, owner, gx, gz));
      }
      this.states.set(def.id, state);
    }
    log.info(`Estructuras cargadas: ${this.states.size}`, Object.fromEntries([...this.states].map(([k, v]) => [k, v.owner])));
  }

  get(id) { return this.states.get(id) || null; }

  countOwned(realm) {
    let n = 0;
    for (const s of this.states.values()) if (s.owner === realm) n++;
    return n;
  }

  publicState(s) {
    return {
      id: s.def.id, kind: s.def.kind, name: s.def.name, home: s.def.realm, owner: s.owner,
      x: +s.def.x.toFixed(1), z: +s.def.z.toFixed(1),
      doorId: s.door.id, doorHp: Math.round(s.door.hp), doorMaxHp: s.door.maxHp, doorDestroyed: s.door.dead,
      capture: s.capture ? { playerId: s.capture.playerId, playerName: s.capture.playerName, realm: s.capture.realm, startedAt: s.capture.startedAt, endsAt: s.capture.endsAt } : null,
    };
  }
  publicStates() { return [...this.states.values()].map((s) => this.publicState(s)); }

  broadcastState(s) {
    this.world.broadcastAll({ t: S2C.STRUCTURE, s: this.publicState(s) });
  }

  onDoorDestroyed(door, killer, now) {
    const s = this.states.get(door.structureId);
    if (!s) return;
    door.destroyedAt = now;
    const who = killer && killer.name ? killer.name : 'fuerzas enemigas';
    const realmName = killer && killer.realm ? REALMS[killer.realm].name : 'un reino enemigo';
    this.world.broadcastAll({ t: S2C.EVENT, e: EV.DOOR_DESTROYED, structureId: s.def.id, by: who, realm: killer ? killer.realm : null });
    this.world.systemMessage(`¡La puerta de ${s.def.name} ha caído ante ${realmName} (${who})!`);
    this.broadcastState(s);
  }

  /** Intento de captura por parte de un jugador. Devuelve null si OK o un código de error. */
  startCapture(p, structureId, now) {
    const s = this.states.get(structureId);
    if (!s) return { code: ERR.NOT_FOUND, message: 'Esa estructura no existe.' };
    if (!p.alive) return { code: ERR.DEAD, message: 'Estás muerto.' };
    if (p.casting) return { code: ERR.CASTING, message: 'No puedes capturar mientras lanzas una habilidad.' };
    if (s.owner === p.realm) return { code: ERR.INVALID_TARGET, message: 'Esta estructura ya pertenece a tu reino.' };
    if (!s.door.dead) return { code: ERR.INVALID_TARGET, message: 'La puerta sigue en pie. Derríbala primero.' };
    const f = structureFlagPos(s.def);
    if (dist(p.x, p.z, f.x, f.z) > CAPTURE_RANGE) return { code: ERR.OUT_OF_RANGE, message: 'Acércate a la bandera para capturar.' };
    if (s.capture && s.capture.playerId !== p.id) {
      const other = this.world.players.get(s.capture.playerId);
      if (other && other.alive) return { code: ERR.INVALID_TARGET, message: `${s.capture.playerName} ya está capturando.` };
    }
    if (p.capturing) this.cancelCapture(p, 'nueva captura');
    s.capture = { playerId: p.id, playerName: p.name, realm: p.realm, startedAt: now, endsAt: now + CAPTURE_TIME * 1000, sx: p.x, sz: p.z };
    p.capturing = { structureId, startedAt: now, endsAt: s.capture.endsAt };
    p.autoAttack = false; p.dirtySelf = true;
    this.world.systemMessage(`⚔️ ${p.name} (${REALMS[p.realm].name}) está capturando ${s.def.name}!`);
    this.broadcastState(s);
    return null;
  }

  cancelCapture(p, reason) {
    if (!p.capturing) return;
    const s = this.states.get(p.capturing.structureId);
    p.capturing = null; p.dirtySelf = true;
    if (s && s.capture && s.capture.playerId === p.id) {
      s.capture = null;
      this.world.broadcastAll({ t: S2C.EVENT, e: EV.CAPTURE_CANCEL, structureId: s.def.id, playerId: p.id, reason });
      this.broadcastState(s);
    }
  }

  _completeCapture(s, p, now) {
    const fromRealm = s.owner;
    const toRealm = p.realm;
    try {
      this.db.setStructureOwner(s.def.id, toRealm, { fromRealm, characterId: p.charId, characterName: p.name });
    } catch (err) {
      log.error('Error persistiendo captura', { structure: s.def.id, err: err.message });
      this.cancelCapture(p, 'error interno');
      p.session?.sendError(ERR.SERVER_ERROR, 'No se pudo registrar la captura. Inténtalo de nuevo.');
      return;
    }
    s.owner = toRealm;
    s.capture = null;
    p.capturing = null;
    p.captures++;
    // puerta restaurada para el nuevo dueño
    s.door.realm = toRealm; s.door.dead = false; s.door.hp = s.door.maxHp; s.door.threat.clear();
    this.world.updateGrid(s.door);
    // guardias cambian de bando y reaparecen en sus puestos
    for (const g of s.guards) { g.realm = toRealm; g.reset(); g.respawnAt = 0; this.world.updateGrid(g); }
    // recompensa
    const xp = 400 + p.level * 60;
    const ups = p.addXp(xp);
    p.gold += 200;
    p.dirtySelf = true;
    p.session?.send({ t: S2C.EVENT, e: EV.XP, amt: xp, reason: 'captura' });
    if (ups) this.world.onLevelUp(p, ups, now);
    this.world.broadcastAll({ t: S2C.EVENT, e: EV.STRUCTURE_CAPTURED, structureId: s.def.id, from: fromRealm, to: toRealm, by: p.name });
    this.world.systemMessage(`🏰 ¡${s.def.name} ha sido capturado por ${REALMS[toRealm].name}! (${p.name})`);
    this.broadcastState(s);
    log.info('Estructura capturada', { structure: s.def.id, from: fromRealm, to: toRealm, by: p.name });
  }

  tick(now) {
    for (const s of this.states.values()) {
      // reparación automática de la puerta
      if (s.door.dead && now - s.door.destroyedAt >= DOOR_REPAIR_DELAY * 1000 && !s.capture) {
        s.door.dead = false; s.door.hp = s.door.maxHp; s.door.threat.clear();
        this.world.systemMessage(`🔧 La puerta de ${s.def.name} ha sido reparada.`);
        this.broadcastState(s);
      }
      if (!s.capture) continue;
      const p = this.world.players.get(s.capture.playerId);
      if (!p || !p.alive || !p.capturing || p.capturing.structureId !== s.def.id) {
        const cancelledId = s.capture.playerId;
        s.capture = null;
        if (p) p.capturing = null;
        this.world.broadcastAll({ t: S2C.EVENT, e: EV.CAPTURE_CANCEL, structureId: s.def.id, playerId: cancelledId, reason: 'capturador caído' });
        this.broadcastState(s);
        continue;
      }
      if (dist(p.x, p.z, s.capture.sx, s.capture.sz) > 0.75) { this.cancelCapture(p, 'te has movido'); continue; }
      if (now >= s.capture.endsAt) this._completeCapture(s, p, now);
    }
  }
}
