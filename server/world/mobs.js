// server/world/mobs.js
// Aparición de monstruos y su IA (agresión, persecución, ataque, evasión, deambular).
import { MOB_TYPES } from '../../shared/constants.js';
import { REALM_IDS } from '../../shared/constants.js';
import { REALM_CENTERS, REALM_SPAWN_RINGS, WAR_SPAWN_RINGS, STRUCTURES, realmZoneAt, isWarZone, insideWorld } from '../../shared/worldmap.js';
import { terrainHeight } from '../../shared/terrain.js';
import { seededRandom, dist } from '../../shared/math.js';
import { Mob, KIND } from './entities.js';
import { tryAutoAttack, tickPeriodicEffects, canAttack } from './combat.js';

const MIN_DIST_TO_STRUCTURE = 55;

export class MobSpawner {
  constructor(world) {
    this.world = world;
    this.placementRng = seededRandom(424242); // posiciones estables entre reinicios
  }

  _randomInRing(cx, cz, rMin, rMax) {
    const r = this.placementRng;
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r() * (rMax * rMax - rMin * rMin) + rMin * rMin);
    return { x: cx + Math.cos(ang) * rad, z: cz + Math.sin(ang) * rad };
  }

  _farFromStructures(x, z) {
    for (const s of STRUCTURES) if (dist(x, z, s.x, s.z) < MIN_DIST_TO_STRUCTURE) return false;
    return true;
  }

  spawnAll() {
    let count = 0;
    for (const realm of REALM_IDS) {
      const c = REALM_CENTERS[realm];
      for (const ring of REALM_SPAWN_RINGS[realm]) {
        for (let i = 0; i < ring.count; i++) {
          let pos = null;
          for (let tries = 0; tries < 30 && !pos; tries++) {
            const p = this._randomInRing(c.x, c.z, ring.rMin, ring.rMax);
            if (realmZoneAt(p.x, p.z) === realm && insideWorld(p.x, p.z) && terrainHeight(p.x, p.z) > 0.3) pos = p;
          }
          if (!pos) throw new Error(`No se pudo ubicar ${ring.typeId} en ${realm}`);
          count += this._spawn(ring.typeId, pos);
        }
      }
    }
    for (const ring of WAR_SPAWN_RINGS) {
      for (let i = 0; i < ring.count; i++) {
        let pos = null;
        for (let tries = 0; tries < 60 && !pos; tries++) {
          const p = ring.rMax <= 1 ? { x: 0, z: 0 } : this._randomInRing(0, 0, ring.rMin, ring.rMax);
          if (isWarZone(p.x, p.z) && insideWorld(p.x, p.z) && this._farFromStructures(p.x, p.z) && terrainHeight(p.x, p.z) > 0.3) pos = p;
        }
        if (!pos) throw new Error(`No se pudo ubicar ${ring.typeId} en zona de guerra`);
        count += this._spawn(ring.typeId, pos);
      }
    }
    return count;
  }

  _spawn(typeId, pos) {
    const t = MOB_TYPES[typeId];
    const level = t.minLevel + Math.floor(this.placementRng() * (t.maxLevel - t.minLevel + 1));
    const mob = new Mob(typeId, level, pos.x, pos.z, {
      spawnRadius: t.elite ? 20 : 12,
      respawnSeconds: t.elite ? 900 : 25 + level,
    });
    mob.yaw = this.placementRng() * Math.PI * 2;
    this.world.addEntity(mob);
    return 1;
  }

  /** Crea un guardia para una estructura (lo llama StructureManager). */
  spawnGuard(structure, ownerRealm, x, z) {
    const mob = new Mob(structure.guardType, structure.guardLevel, x, z, {
      realm: ownerRealm, structureId: structure.id, spawnRadius: 3, respawnSeconds: 90,
    });
    mob.name = `${MOB_TYPES[structure.guardType].name} de ${structure.name}`;
    mob.yaw = Math.atan2(structure.x - x, structure.z - z) + Math.PI;
    this.world.addEntity(mob);
    return mob;
  }

  tick(dt, now) {
    const world = this.world;
    for (const mob of world.mobs.values()) {
      if (mob.dead) {
        if (mob.respawnAt && now >= mob.respawnAt) {
          mob.reset();
          world.updateGrid(mob);
        }
        continue;
      }
      mob.pruneEffects(now);
      tickPeriodicEffects(world, mob, now);
      if (!mob.alive) continue;
      this._ai(mob, dt, now);
    }
  }

  _ai(mob, dt, now) {
    const world = this.world;
    const distToSpawn = dist(mob.x, mob.z, mob.spawnX, mob.spawnZ);

    // Evasión: volver al punto de aparición y curarse
    if (mob.evading) {
      if (distToSpawn < 1.5) {
        mob.evading = false; mob.hp = mob.maxHp; mob.threat.clear(); mob.targetId = null;
      } else {
        this._moveTowards(mob, mob.spawnX, mob.spawnZ, mob.stats.speed * 1.5, dt);
      }
      return;
    }

    // Selección de objetivo
    let target = mob.targetId ? world.getEntity(mob.targetId) : null;
    if (target && (!target.alive || !canAttack(mob, target, world.isWarZone) || dist(mob.x, mob.z, target.x, target.z) > mob.stats.leashRadius * 1.3)) {
      mob.threat.delete(target.id);
      target = null; mob.targetId = null;
    }
    if (mob.tauntedBy && mob.tauntUntil > now) {
      const t = world.getEntity(mob.tauntedBy);
      if (t && t.alive) target = t;
    }
    if (!target) {
      // mayor amenaza viva y cercana
      let best = null, bestThreat = 0;
      for (const [id, th] of mob.threat) {
        const e = world.getEntity(id);
        if (!e || !e.alive || !canAttack(mob, e, world.isWarZone)) { mob.threat.delete(id); continue; }
        if (dist(mob.x, mob.z, e.x, e.z) > mob.stats.leashRadius * 1.3) continue;
        if (th > bestThreat) { best = e; bestThreat = th; }
      }
      target = best;
    }
    if (!target && mob.stats.aggroRadius > 0) {
      // agresión a jugadores cercanos (guardias: solo enemigos del reino)
      const near = world.playersWithin(mob.x, mob.z, mob.stats.aggroRadius);
      let best = null, bestD = Infinity;
      for (const p of near) {
        if (!canAttack(mob, p, world.isWarZone)) continue;
        if (p.level >= mob.level + 10 && !mob.type.guard) continue; // ignora a jugadores muy superiores
        const d = dist(mob.x, mob.z, p.x, p.z);
        if (d < bestD) { best = p; bestD = d; }
      }
      target = best;
    }
    mob.targetId = target ? target.id : null;

    if (target) {
      // ¿Demasiado lejos de casa? → evadir
      if (distToSpawn > mob.stats.leashRadius) {
        mob.targetId = null; mob.evading = true; mob.threat.clear();
        return;
      }
      const d = dist(mob.x, mob.z, target.x, target.z);
      mob.yaw = Math.atan2(target.x - mob.x, target.z - mob.z);
      if (d > mob.stats.attackRange) {
        this._moveTowards(mob, target.x, target.z, mob.moveSpeed(now), dt);
      } else {
        tryAutoAttack(world, mob, target, now);
      }
      return;
    }

    // Deambular
    if (now >= mob.wander.nextAt) {
      const r = world.rng;
      const ang = r() * Math.PI * 2, rad = r() * mob.spawnRadius;
      mob.wander.tx = mob.spawnX + Math.cos(ang) * rad;
      mob.wander.tz = mob.spawnZ + Math.sin(ang) * rad;
      mob.wander.nextAt = now + 4000 + r() * 6000;
    }
    if (dist(mob.x, mob.z, mob.wander.tx, mob.wander.tz) > 0.5) {
      this._moveTowards(mob, mob.wander.tx, mob.wander.tz, mob.stats.speed * 0.4, dt);
    }
  }

  _moveTowards(mob, tx, tz, speed, dt) {
    if (speed <= 0) return;
    const dx = tx - mob.x, dz = tz - mob.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const step = Math.min(d, speed * dt);
    mob.x += dx / d * step; mob.z += dz / d * step;
    mob.yaw = Math.atan2(dx, dz);
    mob.y = terrainHeight(mob.x, mob.z);
    this.world.updateGrid(mob);
  }
}
export { KIND };
