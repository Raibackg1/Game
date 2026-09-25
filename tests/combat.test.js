// tests/combat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameDB } from '../server/db.js';
import { World } from '../server/world/world.js';
import { Mob } from '../server/world/entities.js';
import { canAttack, computeDamage, applyDamage } from '../server/world/combat.js';
import { REALM_CENTERS } from '../shared/worldmap.js';
import { derivedStats } from '../shared/constants.js';

function fakeSession() { const out = []; return { out, send: (m) => out.push(m), sendError: (c, m) => out.push({ t: 'error', code: c, message: m }) }; }
function makeWorld(rng = () => 0.5) {
  const db = new GameDB(':memory:');
  const w = new World(db, { rng });
  w.init();
  return { w, db };
}
function makePlayer(w, db, { name, realm, race, cls, level = 1, x, z }) {
  const d = derivedStats(race, cls, level);
  const accId = db.createAccount(name.toLowerCase(), 'h', 's');
  const cid = db.createCharacter({ accountId: accId, name, realm, race, cls, x, z, yaw: 0, hp: d.maxHp, mana: d.maxMana });
  const row = db.getCharacter(cid);
  row.level = level;
  const s = fakeSession();
  const p = w.addPlayer(row, s);
  p.level = level; p.recalc(); p.hp = p.maxHp; p.mana = p.maxMana;
  return { p, s };
}

test('reglas de ataque: mismo reino nunca, PvP solo en zona de guerra, guardias solo enemigos', () => {
  const { w, db } = makeWorld();
  const cN = REALM_CENTERS.norheim;
  const { p: a } = makePlayer(w, db, { name: 'Aa', realm: 'norheim', race: 'nordo', cls: 'guerrero', x: cN.x + 5, z: cN.z });
  const { p: b } = makePlayer(w, db, { name: 'Bb', realm: 'norheim', race: 'enano', cls: 'mago', x: cN.x - 5, z: cN.z });
  const { p: c } = makePlayer(w, db, { name: 'Cc', realm: 'pyrrhos', race: 'ignar', cls: 'arquero', x: 10, z: 10 });
  assert.ok(!canAttack(a, b, w.isWarZone), 'mismo reino');
  assert.ok(!canAttack(a, c, w.isWarZone), 'a está en zona segura');
  a.x = 0; a.z = 0; w.updateGrid(a);
  assert.ok(canAttack(a, c, w.isWarZone), 'ambos en zona de guerra');
  const guardN = [...w.mobs.values()].find((m) => m.type.guard && m.realm === 'norheim');
  assert.ok(!canAttack(a, guardN, w.isWarZone), 'guardia propio');
  assert.ok(canAttack(c, guardN, w.isWarZone), 'guardia enemigo');
  assert.ok(!canAttack(guardN, a, w.isWarZone));
  assert.ok(canAttack(guardN, c, w.isWarZone));
});

test('daño: escala con poder, se mitiga por armadura y respeta el escudo', () => {
  const { w, db } = makeWorld(() => 0.99); // sin críticos (crit < chance) y varianza alta
  const { p } = makePlayer(w, db, { name: 'Dd', realm: 'eldwyn', race: 'elfo', cls: 'mago', level: 20, x: 0, z: 0 });
  const mob = new Mob('ogro', 30, 5, 5);
  const weak = new Mob('lobo_hielo', 1, 5, 5);
  const dStrong = computeDamage(w, p, mob, { power: 'spell', mult: 1, flat: 0 }, Date.now()).amount;
  const dWeak = computeDamage(w, p, weak, { power: 'spell', mult: 1, flat: 0 }, Date.now()).amount;
  assert.ok(dWeak > dStrong, 'más armadura → menos daño');
  weak.shield = 1e6; weak.shieldUntil = Date.now() + 10000;
  assert.equal(computeDamage(w, p, weak, { power: 'spell', mult: 1, flat: 0 }, Date.now()).amount, 0, 'escudo absorbe todo');
});

test('matar un monstruo otorga XP, oro y contador; el monstruo reaparece', () => {
  const { w, db } = makeWorld(() => 0.5);
  const cE = REALM_CENTERS.eldwyn;
  const { p, s } = makePlayer(w, db, { name: 'Ee', realm: 'eldwyn', race: 'elfo', cls: 'arquero', level: 5, x: cE.x, z: cE.z });
  const mob = [...w.mobs.values()].find((m) => m.typeId === 'jabali');
  p.x = mob.x + 2; p.z = mob.z; w.updateGrid(p);
  const now = Date.now();
  assert.equal(w.setTarget(p, mob.id), null);
  assert.equal(w.setAutoAttack(p, true), null);
  let t = now;
  for (let i = 0; i < 400 && mob.alive; i++) { t += 50; w.tick(0.05, t); }
  assert.ok(mob.dead, 'el jabalí debería morir');
  assert.ok(p.xp > 0 || p.level > 5, 'XP otorgada');
  assert.ok(p.gold > 0, 'oro otorgado');
  assert.equal(p.kills_pve, 1);
  assert.ok(s.out.some((m) => m.t === 'ev' && m.e === 'xp'));
  assert.ok(s.out.some((m) => m.t === 'ev' && m.e === 'death' && m.id === mob.id));
  w.tick(0.05, mob.respawnAt + 100);
  assert.ok(mob.alive && mob.hp === mob.maxHp, 'reaparece con vida completa');
});

test('habilidades: validación de maná, enfriamiento, rango y objetivo; subir a nivel 10 exige subclase', () => {
  const { w, db } = makeWorld(() => 0.5);
  const { p } = makePlayer(w, db, { name: 'Ff', realm: 'norheim', race: 'utgard', cls: 'guerrero', level: 9, x: 0, z: 0 });
  const mob = new Mob('ogro', 26, 40, 0); w.addEntity(mob);
  const now = Date.now();
  assert.equal(w.useSkill(p, 'golpe_brutal', mob.id, now).code, 'out_of_range');
  mob.x = 2; w.updateGrid(mob);
  assert.equal(w.useSkill(p, 'meteoro', mob.id, now).code, 'unknown_skill', 'habilidad de otra clase');
  assert.equal(w.useSkill(p, 'golpe_brutal', mob.id, now), null);
  assert.equal(w.useSkill(p, 'golpe_brutal', mob.id, now + 1100).code, 'on_cooldown');
  assert.equal(w.useSkill(p, 'grito_guerra', null, now + 500).code, 'on_cooldown', 'GCD activo');
  assert.equal(w.useSkill(p, 'grito_guerra', null, now + 1100), null);
  assert.ok(p.buffs.some((b) => b.id === 'grito_guerra'));
  p.mana = 0;
  assert.equal(w.useSkill(p, 'barrido', mob.id, now + 6000).code, 'no_mana');
  // nivel 10 → necesita subclase
  p.addXp(1e6);
  assert.ok(p.level >= 10);
  assert.ok(p.packSelf(now).needsSubclass);
  assert.equal(w.chooseSubclass(p, 'brujo').code, 'invalid_class');
  assert.equal(w.chooseSubclass(p, 'barbaro'), null);
  assert.equal(p.cls, 'barbaro');
  assert.ok(!p.packSelf(now).needsSubclass);
});

test('casteo: se interrumpe al moverse y se completa si no', () => {
  const { w, db } = makeWorld(() => 0.5);
  const cE = REALM_CENTERS.eldwyn; // lejos del Dragón del Cráter (nivel 60, en el origen)
  const { p, s } = makePlayer(w, db, { name: 'Gg', realm: 'eldwyn', race: 'silvano', cls: 'mago', level: 5, x: cE.x, z: cE.z });
  const mob = new Mob('ogro', 26, cE.x + 5, cE.z); w.addEntity(mob);
  mob.damage = 0; mob.stats.aggroRadius = 0; // el ogro no debe matar al mago durante la prueba
  const now = Date.now();
  assert.equal(w.useSkill(p, 'descarga_arcana', mob.id, now), null);
  assert.ok(p.casting);
  p.autoAttack = false; // aislar el efecto del casteo (una habilidad ofensiva activa el autoataque por diseño)
  w.setInput(p, 1, 0, 0, now + 100);
  w.tick(0.05, now + 150);
  w.tick(0.05, now + 200);
  assert.equal(p.casting, null, 'moverse cancela');
  assert.equal(mob.hp, mob.maxHp);
  w.setInput(p, 0, 0, 0, now + 1200);
  assert.equal(w.useSkill(p, 'descarga_arcana', mob.id, now + 4000), null);
  p.autoAttack = false;
  w.tick(0.05, now + 5100);
  assert.equal(p.casting, null);
  assert.ok(mob.hp < mob.maxHp, 'daño aplicado al terminar el casteo');
  assert.ok(s.out.some((m) => m.t === 'ev' && m.e === 'cast_end' && !m.cancelled));
});

test('fronteras: no se puede entrar en la zona de un reino enemigo salvo poseyendo su castillo', () => {
  const { w } = makeWorld(() => 0.5);
  const cP = REALM_CENTERS.pyrrhos;
  assert.ok(!w.canStandAt('norheim', cP.x, cP.z));
  assert.ok(w.canStandAt('pyrrhos', cP.x, cP.z));
  assert.ok(w.canStandAt('norheim', 0, 0));
  w.structures.get('castle_pyrrhos').owner = 'norheim';
  assert.ok(w.canStandAt('norheim', cP.x, cP.z), 'invasión permitida con el castillo');
});

test('captura: requiere puerta destruida, canaliza 30 s, cambia dueño y bonifica al reino', () => {
  const { w, db } = makeWorld(() => 0.5);
  const st = w.structures.get('fort_norheim');
  const { p, s } = makePlayer(w, db, { name: 'Hh', realm: 'pyrrhos', race: 'beliak', cls: 'guerrero', level: 30, x: st.def.x, z: st.def.z });
  const now = Date.now();
  const r = w.interact(p, 'fort_norheim', now);
  assert.equal(r.code, 'invalid_target', 'puerta en pie');
  st.door.hp = 1;
  applyDamage(w, p, st.door, 5, {}, now);
  assert.ok(st.door.dead);
  assert.ok(s.out.some((m) => m.t === 'ev' && m.e === 'door_destroyed'));
  assert.equal(w.interact(p, 'fort_norheim', now + 100), null);
  assert.ok(p.capturing);
  w.structures.tick(now + 10000);
  assert.ok(p.capturing, 'sigue capturando a los 10 s');
  w.structures.tick(now + 31000);
  assert.equal(p.capturing, null);
  assert.equal(st.owner, 'pyrrhos');
  assert.equal(p.captures, 1);
  assert.ok(!st.door.dead && st.door.hp === st.door.maxHp, 'puerta restaurada');
  assert.ok(st.guards.every((g) => g.realm === 'pyrrhos' && g.alive), 'guardias cambian de bando');
  assert.equal(w.structures.countOwned('pyrrhos'), 3);
  assert.equal(db.getStructures().find((x) => x.id === 'fort_norheim').owner_realm, 'pyrrhos', 'persistido');
  assert.ok(s.out.some((m) => m.t === 'ev' && m.e === 'structure_captured'));
});

test('captura se cancela al recibir daño', () => {
  const { w, db } = makeWorld(() => 0.5);
  const st = w.structures.get('fort_eldwyn');
  const { p } = makePlayer(w, db, { name: 'Ii', realm: 'norheim', race: 'nordo', cls: 'guerrero', level: 30, x: st.def.x, z: st.def.z });
  const now = Date.now();
  st.door.dead = true; st.door.hp = 0; st.door.destroyedAt = now;
  assert.equal(w.interact(p, 'fort_eldwyn', now), null);
  applyDamage(w, st.guards[0], p, 1, {}, now + 500);
  assert.equal(p.capturing, null);
  assert.equal(st.capture, null);
});
