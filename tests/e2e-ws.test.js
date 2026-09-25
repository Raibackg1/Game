// tests/e2e-ws.test.js
// Prueba de extremo a extremo contra un servidor real por WebSocket.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestClient, registerAndEnter } from './helpers.js';

let env;
test.before(async () => { env = await startTestServer({ rng: () => 0.5 }); });
after(async () => { if (env) await env.server.close(); });

test('registro, validaciones y creación de personaje', async () => {
  const c = new TestClient(env.url);
  await c.opened;
  c.send({ t: 'register', username: 'ab', password: 'contraseña-larga' });
  assert.equal((await c.waitType('error')).code, 'invalid_name');
  c.send({ t: 'register', username: 'jugador1', password: 'corta' });
  assert.equal((await c.waitType('error')).code, 'invalid_password');
  c.send({ t: 'create_char', name: 'X', realm: 'norheim', race: 'nordo', cls: 'guerrero' });
  assert.equal((await c.waitType('error')).code, 'auth_required');
  c.send({ t: 'register', username: 'jugador1', password: 'contraseña-larga' });
  const auth = await c.waitType('auth');
  assert.ok(auth.ok && auth.token.length === 64 && auth.characters.length === 0);
  c.send({ t: 'create_char', name: 'Thorin', realm: 'norheim', race: 'elfo', cls: 'guerrero' });
  assert.equal((await c.waitType('error')).code, 'invalid_race');
  c.send({ t: 'create_char', name: 'Thorin', realm: 'norheim', race: 'enano', cls: 'guerrero' });
  const chars = await c.waitType('chars');
  assert.equal(chars.characters.length, 1);
  assert.equal(chars.characters[0].name, 'Thorin');
  // el mismo nombre queda bloqueado para otra cuenta
  const c2 = new TestClient(env.url); await c2.opened;
  c2.send({ t: 'register', username: 'jugador2', password: 'contraseña-larga' });
  await c2.waitType('auth');
  c2.send({ t: 'create_char', name: 'thorin', realm: 'eldwyn', race: 'elfo', cls: 'mago' });
  assert.equal((await c2.waitType('error')).code, 'name_taken');
  // reanudar sesión con token en una conexión nueva
  const c3 = new TestClient(env.url); await c3.opened;
  c3.send({ t: 'resume', token: auth.token });
  const re = await c3.waitType('auth');
  assert.ok(re.ok && re.characters.length === 1);
  // la conexión anterior fue expulsada
  const kicked = await c.waitType('error');
  assert.equal(kicked.code, 'session_expired');
  c.close(); c2.close(); c3.close();
});

test('entrar al mundo, recibir snapshots, moverse y matar un monstruo por red', async () => {
  const { client: c, welcome } = await registerAndEnter(env.url, { username: 'guerrero_e2e', name: 'Brunhild', realm: 'norheim', race: 'utgard', cls: 'guerrero' });
  assert.equal(welcome.self.name, 'Brunhild');
  assert.equal(welcome.structures.length, 6);
  const snap = await c.waitType('snap');
  assert.ok(snap.ents.some((e) => e.id === welcome.self.id), 'me veo a mí mismo');
  const wolves = snap.ents.filter((e) => e.k === 'm' && e.t === 'lobo_hielo');
  assert.ok(wolves.length > 0, 'hay lobos cerca del altar');
  const me = snap.ents.find((e) => e.id === welcome.self.id);
  const wolf = wolves.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
  let pos = { x: me.x, z: me.z };
  const deadline = Date.now() + 25000;
  while (Math.hypot(wolf.x - pos.x, wolf.z - pos.z) > 2.2 && Date.now() < deadline) {
    const dx = wolf.x - pos.x, dz = wolf.z - pos.z, d = Math.hypot(dx, dz);
    c.send({ t: 'input', mx: dx / d, mz: dz / d, yaw: Math.atan2(dx, dz) });
    const s = await c.waitType('snap', 2000);
    const m = s.ents.find((e) => e.id === welcome.self.id);
    if (m) pos = { x: m.x, z: m.z };
    const wl = s.ents.find((e) => e.id === wolf.id);
    if (wl) { wolf.x = wl.x; wolf.z = wl.z; }
  }
  c.send({ t: 'input', mx: 0, mz: 0, yaw: 0 });
  assert.ok(Math.hypot(wolf.x - pos.x, wolf.z - pos.z) <= 2.5, 'llegué junto al lobo');
  c.clear();
  c.send({ t: 'target', id: wolf.id });
  c.send({ t: 'attack', on: true });
  const dmg = await c.waitFor((m) => m.t === 'ev' && m.e === 'damage' && m.dst === wolf.id, 5000, 'daño al lobo');
  assert.ok(dmg.amt > 0);
  await new Promise((r) => setTimeout(r, 150)); // respeta el límite de acciones por segundo
  c.send({ t: 'cast', skill: 'golpe_brutal', target: wolf.id });
  const castEnd = await c.waitFor((m) => (m.t === 'ev' && m.e === 'cast_end' && m.skill === 'golpe_brutal') || (m.t === 'error' && m.skill === 'golpe_brutal'), 3000, 'respuesta al cast');
  assert.equal(castEnd.t, 'ev', 'el cast debe aceptarse: ' + JSON.stringify(castEnd));
  const death = await c.waitFor((m) => m.t === 'ev' && m.e === 'death' && m.id === wolf.id, 30000, 'muerte del lobo');
  assert.equal(death.killer, welcome.self.id);
  const xp = await c.waitFor((m) => m.t === 'ev' && m.e === 'xp', 3000, 'xp');
  assert.ok(xp.amt > 0);
  const self = await c.waitFor((m) => m.t === 'self' && m.self.kills_pve >= 1, 3000, 'self actualizado');
  assert.ok(self.self.xp > 0 || self.self.level > 1);
  c.send({ t: 'chat', ch: 'realm', text: 'Hola Norheim' });
  const chat = await c.waitFor((m) => m.t === 'chat' && m.text === 'Hola Norheim', 3000, 'chat');
  assert.equal(chat.from, 'Brunhild');
  await new Promise((r) => setTimeout(r, 120)); // límite de acciones (80 ms)
  c.clear();
  c.send({ t: 'interact', id: 'fort_pyrrhos' });
  const err = await c.waitType('error');
  assert.ok(['invalid_target', 'out_of_range'].includes(err.code), 'error inesperado: ' + JSON.stringify(err));
  c.send({ t: 'leave' });
  const left = await c.waitType('left');
  assert.equal(left.characters.length, 1);
  const row = env.server.db.getCharacter(left.characters[0].id);
  assert.ok(Math.abs(row.x - pos.x) < 3 && Math.abs(row.z - pos.z) < 3, 'posición persistida');
  assert.ok(row.kills_pve >= 1);
  c.close();
});

test('mensajes malformados no tumban el servidor y el estado HTTP responde', async () => {
  const c = new TestClient(env.url); await c.opened;
  c.ws.send('esto no es json');
  assert.equal((await c.waitType('error')).code, 'bad_request');
  c.send({ t: 'input', mx: 'x' });
  assert.equal((await c.waitType('error')).code, 'auth_required');
  c.send({ t: 'ping', ts: 42 });
  assert.equal((await c.waitType('pong')).ts, 42);
  const res = await fetch(env.http + '/api/status');
  const body = await res.json();
  assert.ok(body.ok && body.structures.length === 6);
  const lb = await (await fetch(env.http + '/api/leaderboard')).json();
  assert.ok(Array.isArray(lb.top));
  c.close();
});
