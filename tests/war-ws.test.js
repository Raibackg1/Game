// tests/war-ws.test.js
// Guerra de reinos por red: dos clientes de reinos distintos en la zona de guerra.
// PvP, derribo de la puerta de un fuerte, captura canalizada y bono de reino, todo a través del protocolo real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndEnter } from './helpers.js';
import { structureFlagPos, structureDoorPos } from '../shared/worldmap.js';
import { CAPTURE_TIME } from '../shared/constants.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms)); // el servidor limita acciones a una cada 80 ms

let env;
test.before(async () => { env = await startTestServer({ rng: () => 0.5 }); });
after(async () => { if (env) await env.server.close(); });

/** Coloca a un jugador (desde el servidor, como haría un GM) y espera a que el cliente lo vea. */
function teleport(name, x, z) {
  const p = [...env.server.world.players.values()].find((q) => q.name === name);
  p.x = x; p.z = z; env.server.world.updateGrid(p);
  return p;
}

test('PvP en zona de guerra, puerta y captura de fuerte entre dos reinos por WebSocket', async () => {
  const A = await registerAndEnter(env.url, { username: 'war_norheim', name: 'Sigrun', realm: 'norheim', race: 'utgard', cls: 'guerrero' });
  const B = await registerAndEnter(env.url, { username: 'war_pyrrhos', name: 'Kaelor', realm: 'pyrrhos', race: 'beliak', cls: 'guerrero' });
  const world = env.server.world;
  const pa = world.players.get(A.welcome.self.id), pb = world.players.get(B.welcome.self.id);
  // subir de nivel a ambos para que el combate sea rápido y puedan con los guardias
  for (const p of [pa, pb]) { p.level = 50; p.recalc(); p.hp = p.maxHp; p.mana = p.maxMana; p.dirtySelf = true; }

  // 1) En zona segura no hay PvP: A intenta atacar a B dentro de Norheim → rechazado
  const st = world.structures.get('fort_eldwyn');
  teleport('Sigrun', 0, -820); teleport('Kaelor', 2, -820); // ambos dentro de la zona de Norheim (Kaelor "invadiendo" por fuerza para la prueba)
  A.client.clear();
  A.client.send({ t: 'target', id: pb.id });
  await wait(100);
  A.client.send({ t: 'attack', on: true });
  const rejected = await A.client.waitType('error', 3000);
  assert.equal(rejected.code, 'invalid_target', 'sin PvP en zona segura');

  // 2) En zona de guerra sí: A ataca a B junto al fuerte de Eldwyn
  const flag = structureFlagPos(st.def), door = structureDoorPos(st.def);
  // dejamos un solo guardia vivo: suficiente para comprobar su agresividad sin que mate a los jugadores durante la prueba
  for (const g of st.guards.slice(1)) { g.hp = 0; g.dead = true; g.respawnAt = Date.now() + 600000; }
  teleport('Sigrun', door.x + 2, door.z + 2); teleport('Kaelor', door.x + 3.5, door.z + 2); // dentro del alcance melé (3)
  await new Promise((r) => setTimeout(r, 250));
  A.client.clear(); B.client.clear();
  A.client.send({ t: 'target', id: pb.id });
  await wait(100);
  A.client.send({ t: 'attack', on: true });
  const hit = await B.client.waitFor((m) => m.t === 'ev' && m.e === 'damage' && m.dst === pb.id && m.src === pa.id, 5000, 'daño PvP visto por la víctima');
  assert.ok(hit.amt > 0);
  await wait(100);
  A.client.send({ t: 'attack', on: false });
  await wait(100);

  // 3) A derriba la puerta del fuerte de Eldwyn
  const doorEnt = st.door;
  doorEnt.hp = 200; // acortar la prueba: la puerta tiene 5000 HP
  // los guardias de Eldwyn atacarán a A: comprobamos que A recibe daño de un guardia (IA hostil a reinos enemigos)
  A.client.clear();
  A.client.send({ t: 'target', id: doorEnt.id });
  await wait(100);
  A.client.send({ t: 'attack', on: true });
  const destroyed = await A.client.waitFor((m) => m.t === 'ev' && m.e === 'door_destroyed' && m.structureId === 'fort_eldwyn', 30000, 'puerta destruida');
  assert.equal(destroyed.realm, 'norheim');
  const structMsg = await B.client.waitFor((m) => m.t === 'struct' && m.s.id === 'fort_eldwyn' && m.s.doorDestroyed, 5000, 'B ve la puerta destruida');
  assert.equal(structMsg.s.owner, 'eldwyn');
  // el guardia superviviente ataca al invasor en cuanto entra en su radio de agresión
  const guard = st.guards[0];
  A.client.clear();
  teleport('Sigrun', guard.x + 2, guard.z);
  const guardHit = await A.client.waitFor((m) => m.t === 'ev' && m.e === 'damage' && m.dst === pa.id && m.src === guard.id, 8000, 'el guardia ataca al invasor');
  assert.ok(guardHit.amt > 0);

  // 4) A captura: se coloca en la bandera y pulsa interactuar
  for (const g of st.guards) { g.hp = 0; g.dead = true; g.respawnAt = Date.now() + 600000; } // neutralizar guardias para la canalización
  teleport('Sigrun', flag.x + 1, flag.z);
  pa.hp = pa.maxHp; pa.autoAttack = false; pa.targetId = null;
  await new Promise((r) => setTimeout(r, 200));
  A.client.clear(); B.client.clear();
  A.client.send({ t: 'interact', id: 'fort_eldwyn' });
  const capStart = await B.client.waitFor((m) => m.t === 'struct' && m.s.id === 'fort_eldwyn' && m.s.capture, 5000, 'captura en curso visible para todos');
  assert.equal(capStart.s.capture.playerName, 'Sigrun');
  assert.equal(capStart.s.capture.realm, 'norheim');
  assert.ok(capStart.s.capture.endsAt - capStart.s.capture.startedAt === CAPTURE_TIME * 1000);
  // B (enemigo) intenta capturar a la vez → rechazado porque ya hay un capturador
  teleport('Kaelor', flag.x - 1, flag.z);
  B.client.send({ t: 'interact', id: 'fort_eldwyn' });
  const busy = await B.client.waitType('error', 3000);
  assert.equal(busy.code, 'invalid_target');
  // acelerar la canalización desde el servidor (30 s reales no aportan nada a la prueba)
  st.capture.endsAt = Date.now() + 300; pa.capturing.endsAt = st.capture.endsAt;
  const captured = await A.client.waitFor((m) => m.t === 'ev' && m.e === 'structure_captured' && m.structureId === 'fort_eldwyn', 5000, 'captura completada');
  assert.equal(captured.to, 'norheim'); assert.equal(captured.from, 'eldwyn'); assert.equal(captured.by, 'Sigrun');
  const xp = await A.client.waitFor((m) => m.t === 'ev' && m.e === 'xp' && m.reason === 'captura', 3000, 'XP de captura');
  assert.ok(xp.amt > 0);
  const selfA = await A.client.waitFor((m) => m.t === 'self' && m.self.captures === 1, 3000, 'contador de capturas');
  assert.equal(selfA.self.captures, 1);
  // estado final coherente en servidor, BD y API HTTP
  assert.equal(st.owner, 'norheim');
  assert.ok(!st.door.dead && st.door.hp === st.door.maxHp, 'puerta restaurada para el nuevo dueño');
  assert.ok(st.guards.every((g) => g.realm === 'norheim' && g.alive), 'guardias ahora de Norheim');
  assert.equal(env.server.db.getStructures().find((s) => s.id === 'fort_eldwyn').owner_realm, 'norheim');
  const status = await (await fetch(env.http + '/api/status')).json();
  assert.equal(status.structures.find((s) => s.id === 'fort_eldwyn').owner, 'norheim');
  assert.equal(status.realms.norheim.owned, 3);
  const lb = await (await fetch(env.http + '/api/leaderboard')).json();
  assert.equal(lb.captures[0].character_name, 'Sigrun');
  // el guardia ahora defiende a Norheim: no puede atacar a Sigrun, sí a Kaelor
  const anyGuard = st.guards[0];
  B.client.clear();
  teleport('Kaelor', anyGuard.x + 1.5, anyGuard.z);
  const guardVsB = await B.client.waitFor((m) => m.t === 'ev' && m.e === 'damage' && m.dst === pb.id && m.src === anyGuard.id, 8000, 'guardia convertido ataca al enemigo');
  assert.ok(guardVsB.amt > 0);
  A.client.close(); B.client.close();
});

test('un jugador muerto reaparece en su altar tras el tiempo de espera', async () => {
  const C = await registerAndEnter(env.url, { username: 'war_muerte', name: 'Ylva', realm: 'norheim', race: 'nordo', cls: 'mago' });
  const world = env.server.world;
  const p = world.players.get(C.welcome.self.id);
  C.client.clear();
  C.client.send({ t: 'respawn' });
  assert.equal((await C.client.waitType('error')).code, 'bad_request', 'no se puede reaparecer vivo');
  // matarlo desde el servidor (como haría un monstruo)
  const { applyDamage } = await import('../server/world/combat.js');
  applyDamage(world, null, p, 1e6, {}, Date.now());
  const dead = await C.client.waitFor((m) => m.t === 'self' && m.self.dead, 3000, 'estado de muerte');
  assert.ok(dead.self.canRespawnAt > Date.now());
  C.client.send({ t: 'respawn' });
  assert.equal((await C.client.waitType('error')).code, 'bad_request', 'demasiado pronto');
  p.diedAt -= 60000; // adelantar el reloj de la prueba
  C.client.send({ t: 'respawn' });
  const alive = await C.client.waitFor((m) => m.t === 'self' && !m.self.dead, 3000, 'reaparecido');
  assert.equal(alive.self.hp, alive.self.maxHp);
  assert.ok(Math.hypot(alive.self.x - 0, alive.self.z + 800) < 20, 'reaparece en el altar de Norheim');
  C.client.close();
});
