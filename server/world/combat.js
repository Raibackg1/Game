// server/world/combat.js
// Fórmulas de daño, aplicación de efectos de habilidades, DoT/HoT y buffs.
import { armorMitigation, SKILLS, REALM_BONUS_PER_STRUCTURE } from '../../shared/constants.js';
import { KIND } from './entities.js';
import { EV } from '../../shared/messages.js';
import { dist } from '../../shared/math.js';

let nextEffectId = 1;

/**
 * ¿Puede `a` atacar a `b`?  Reglas:
 *  - nadie ataca a muertos ni a sí mismo
 *  - jugador vs jugador: solo reinos distintos y solo en zona de guerra (ambos)
 *  - jugador vs monstruo: siempre, salvo guardias del propio reino
 *  - puertas: solo enemigos del reino dueño
 */
export function canAttack(a, b, isWarZoneFn) {
  if (!a || !b || a === b || !b.alive || !a.alive) return false;
  if (a.kind === KIND.PLAYER && b.kind === KIND.PLAYER) {
    if (a.realm === b.realm) return false;
    return isWarZoneFn(a.x, a.z) && isWarZoneFn(b.x, b.z);
  }
  if (b.kind === KIND.DOOR || (b.kind === KIND.MOB && b.realm)) {
    return a.realm !== b.realm;
  }
  if (a.kind === KIND.MOB && b.kind === KIND.MOB) return false;
  if (a.kind === KIND.MOB && a.realm && b.kind === KIND.PLAYER) return a.realm !== b.realm; // guardias no atacan a su reino
  if (a.kind === KIND.DOOR) return false;
  return true;
}

export function isAlly(a, b) {
  if (a === b) return true;
  return !!a.realm && a.realm === b.realm && a.kind === KIND.PLAYER && b.kind === KIND.PLAYER;
}

/** Bono de reino: +2% daño por estructura poseída. */
export function realmDamageBonus(world, realm) {
  if (!realm) return 1;
  return 1 + world.structures.countOwned(realm) * REALM_BONUS_PER_STRUCTURE;
}

/**
 * Calcula el daño final de `attacker` sobre `target`.
 * @returns {{ amount:number, crit:boolean }}
 */
export function computeDamage(world, attacker, target, { power, mult = 1, flat = 0, armorPen = 0, guaranteedCrit = false }, now) {
  let base;
  if (attacker.kind === KIND.PLAYER) {
    base = attacker.power(power) * mult + flat;
  } else {
    base = attacker.damage * mult + flat;
  }
  // varianza ±10%
  base *= 0.9 + world.rng() * 0.2;
  // buffs del atacante y bono de reino
  base *= attacker.statMult('damageMult', now) * realmDamageBonus(world, attacker.realm);
  // crítico
  let crit = guaranteedCrit;
  if (!crit && attacker.kind === KIND.PLAYER && world.rng() < attacker.stats.critChance) crit = true;
  if (!crit && attacker.kind === KIND.MOB && world.rng() < 0.05) crit = true;
  if (crit) base *= 1.6;
  // mitigación
  const armor = (target.armor || 0) * (1 - armorPen);
  base *= 1 - armorMitigation(armor, attacker.level);
  base *= target.statMult('damageTakenMult', now);
  // escudo absorbente
  if (target.shield > 0 && target.shieldUntil > now) {
    const absorbed = Math.min(target.shield, base);
    target.shield -= absorbed; base -= absorbed;
  }
  return { amount: Math.max(0, Math.round(base)), crit };
}

/** Aplica daño ya calculado. Devuelve true si el objetivo murió. */
export function applyDamage(world, attacker, target, amount, { crit = false, skillId = null, tag = null } = {}, now) {
  if (!target.alive) return false;
  target.hp -= amount;
  target.lastCombatAt = now;
  if (attacker) {
    attacker.lastCombatAt = now;
    target.threat.set(attacker.id, (target.threat.get(attacker.id) || 0) + amount);
    // interrumpir captura si el objetivo estaba capturando
    if (target.kind === KIND.PLAYER && target.capturing) world.structures.cancelCapture(target, 'daño recibido');
  }
  world.broadcastNear(target, {
    t: 'ev', e: EV.DAMAGE, src: attacker ? attacker.id : null, dst: target.id, amt: amount, crit, skill: skillId, tag,
  });
  if (target.kind === KIND.PLAYER) target.dirtySelf = true;
  if (target.hp <= 0) {
    target.hp = 0;
    world.onDeath(target, attacker, now);
    return true;
  }
  return false;
}

export function applyHeal(world, source, target, amount, { skillId = null, tag = null } = {}, now) {
  if (!target.alive) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = Math.round(target.hp - before);
  if (target.kind === KIND.PLAYER) target.dirtySelf = true;
  world.broadcastNear(target, { t: 'ev', e: EV.HEAL, src: source ? source.id : null, dst: target.id, amt: healed, skill: skillId, tag });
  return healed;
}

function healAmount(caster, eff) {
  return Math.round(caster.power('spell') * eff.mult + eff.flat);
}

/**
 * Ejecuta los efectos de una habilidad ya validada (rango, maná, cooldown comprobados).
 * `primary` es el objetivo principal (puede ser el propio lanzador).
 */
export function executeSkill(world, caster, skill, primary, now) {
  const isWar = (x, z) => world.isWarZone(x, z);
  for (const eff of skill.effects) {
    switch (eff.kind) {
      case 'damage': {
        const targets = eff.aoe
          ? world.entitiesWithin(primary.x, primary.z, eff.aoe).filter((e) => canAttack(caster, e, isWar))
          : [primary];
        for (const tgt of targets) {
          const { amount, crit } = computeDamage(world, caster, tgt, { power: skill.power, mult: eff.mult, flat: eff.flat, armorPen: eff.armorPen || 0, guaranteedCrit: !!eff.guaranteedCrit }, now);
          applyDamage(world, caster, tgt, amount, { crit, skillId: skill.id }, now);
        }
        break;
      }
      case 'drain': {
        const { amount, crit } = computeDamage(world, caster, primary, { power: skill.power, mult: eff.mult, flat: eff.flat }, now);
        applyDamage(world, caster, primary, amount, { crit, skillId: skill.id }, now);
        applyHeal(world, caster, caster, Math.round(amount * eff.healPct), { skillId: skill.id }, now);
        break;
      }
      case 'heal': {
        applyHeal(world, caster, primary, healAmount(caster, eff), { skillId: skill.id }, now);
        break;
      }
      case 'hot': {
        const targets = eff.aoeAllies
          ? world.entitiesWithin(caster.x, caster.z, eff.aoeAllies).filter((e) => isAlly(caster, e) && e.alive)
          : [primary];
        for (const tgt of targets) {
          tgt.dots.push({
            id: nextEffectId++, skillId: skill.id, heal: true, sourceId: caster.id,
            perTick: Math.max(1, Math.round(healAmount(caster, eff) / 1)),
            ticksLeft: eff.ticks, interval: eff.interval * 1000, nextAt: now + eff.interval * 1000,
          });
        }
        break;
      }
      case 'dot': {
        const perTick = Math.max(1, Math.round(caster.power(skill.power) * eff.mult + eff.flat));
        primary.dots.push({
          id: nextEffectId++, skillId: skill.id, heal: false, sourceId: caster.id, source: caster,
          perTick, ticksLeft: eff.ticks, interval: eff.interval * 1000, nextAt: now + eff.interval * 1000,
        });
        primary.lastCombatAt = now;
        break;
      }
      case 'buff': {
        // refresca si ya existe el mismo buff de la misma habilidad
        primary.buffs = primary.buffs.filter((b) => !(b.id === skill.id && b.stat === eff.stat));
        primary.buffs.push({ id: skill.id, stat: eff.stat, value: eff.value, until: now + eff.duration * 1000, source: caster.id });
        if (primary.kind === KIND.PLAYER) primary.dirtySelf = true;
        world.broadcastNear(primary, { t: 'ev', e: EV.BUFF, dst: primary.id, skill: skill.id, stat: eff.stat, value: eff.value, until: now + eff.duration * 1000 });
        break;
      }
      case 'shield': {
        primary.shield = Math.round(caster.power('spell') * eff.mult + eff.flat);
        primary.shieldUntil = now + eff.duration * 1000;
        if (primary.kind === KIND.PLAYER) primary.dirtySelf = true;
        world.broadcastNear(primary, { t: 'ev', e: EV.BUFF, dst: primary.id, skill: skill.id, stat: 'shield', value: primary.shield, until: primary.shieldUntil });
        break;
      }
      case 'root': {
        primary.rootedUntil = now + eff.duration * 1000;
        if (primary.kind === KIND.PLAYER && primary.capturing) world.structures.cancelCapture(primary, 'inmovilizado');
        world.broadcastNear(primary, { t: 'ev', e: EV.BUFF, dst: primary.id, skill: skill.id, stat: 'root', value: 1, until: primary.rootedUntil });
        break;
      }
      case 'slow': {
        primary.slow = eff.value; primary.slowUntil = now + eff.duration * 1000;
        world.broadcastNear(primary, { t: 'ev', e: EV.BUFF, dst: primary.id, skill: skill.id, stat: 'slow', value: eff.value, until: primary.slowUntil });
        break;
      }
      case 'taunt': {
        if (primary.kind === KIND.MOB) {
          primary.tauntedBy = caster.id; primary.tauntUntil = now + eff.duration * 1000;
          primary.targetId = caster.id;
          primary.threat.set(caster.id, (primary.threat.get(caster.id) || 0) + 500);
        }
        break;
      }
      default:
        throw new Error(`Efecto de habilidad desconocido: ${eff.kind} en ${skill.id}`);
    }
  }
}

/** Procesa DoT/HoT pendientes de una entidad. */
export function tickPeriodicEffects(world, ent, now) {
  if (!ent.dots.length) return;
  const keep = [];
  for (const d of ent.dots) {
    if (!ent.alive) continue;
    if (now >= d.nextAt) {
      if (d.heal) {
        applyHeal(world, world.getEntity(d.sourceId), ent, d.perTick, { skillId: d.skillId, tag: 'hot' }, now);
      } else {
        const src = world.getEntity(d.sourceId);
        const died = applyDamage(world, src && src.alive ? src : null, ent, d.perTick, { skillId: d.skillId, tag: 'dot' }, now);
        if (died) continue;
      }
      d.ticksLeft--; d.nextAt += d.interval;
    }
    if (d.ticksLeft > 0) keep.push(d);
  }
  ent.dots = keep;
}

/** Autoataque básico. Devuelve true si atacó. */
export function tryAutoAttack(world, attacker, target, now) {
  if (now < attacker.nextAttackAt) return false;
  const range = attacker.kind === KIND.PLAYER ? attacker.stats.attackRange : attacker.stats.attackRange;
  const d = dist(attacker.x, attacker.z, target.x, target.z);
  if (d > range + 0.8) return false;
  const speed = attacker.kind === KIND.PLAYER ? attacker.stats.attackSpeed : attacker.stats.attackSpeed;
  attacker.nextAttackAt = now + speed * 1000;
  const power = attacker.kind === KIND.PLAYER ? attacker.attackPowerKind() : 'melee';
  const { amount, crit } = computeDamage(world, attacker, target, { power, mult: 1, flat: 2 }, now);
  applyDamage(world, attacker, target, amount, { crit, skillId: null, tag: 'auto' }, now);
  return true;
}
export { SKILLS };
