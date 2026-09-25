// tests/auth-db.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newToken, RateLimiter } from '../server/auth.js';
import { GameDB } from '../server/db.js';

test('scrypt: verifica la contraseña correcta y rechaza la incorrecta; sales distintas', () => {
  const a = hashPassword('MiClave-123');
  const b = hashPassword('MiClave-123');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(verifyPassword('MiClave-123', a.hash, a.salt));
  assert.ok(!verifyPassword('MiClave-124', a.hash, a.salt));
  assert.equal(newToken().length, 64);
});

test('limitador: bloquea al superar el máximo por minuto', () => {
  const rl = new RateLimiter(2);
  assert.ok(rl.allow('ip'));
  assert.ok(rl.allow('ip'));
  assert.ok(!rl.allow('ip'));
  assert.ok(rl.allow('otra'));
});

test('BD: cuentas, sesiones caducadas, personajes y estructuras', () => {
  const db = new GameDB(':memory:');
  const { hash, salt } = hashPassword('x'.repeat(10));
  const id = db.createAccount('Usuario', hash, salt);
  assert.equal(db.getAccountByUsername('usuario').id, id, 'username sin distinguir mayúsculas');
  assert.throws(() => db.createAccount('USUARIO', hash, salt), /UNIQUE/);

  db.createSession('a'.repeat(64), id, -1);   // ya caducada
  assert.equal(db.getSession('a'.repeat(64)), null);
  db.createSession('b'.repeat(64), id, 60);
  assert.equal(db.getSession('b'.repeat(64)).account_id, id);

  const cid = db.createCharacter({ accountId: id, name: 'Aria', realm: 'eldwyn', race: 'elfo', cls: 'mago', x: 1, z: 2, yaw: 0, hp: 100, mana: 100 });
  assert.ok(db.characterNameExists('ARIA'));
  db.saveCharacter({ id: cid, cls: 'brujo', level: 12, xp: 5, gold: 9, x: 3, z: 4, yaw: 1, hp: 50, mana: 60, kills_pve: 1, kills_pvp: 2, deaths: 3, captures: 4, playtime_seconds: 10.6 });
  const row = db.getCharacter(cid);
  assert.equal(row.cls, 'brujo'); assert.equal(row.level, 12); assert.equal(row.playtime_seconds, 11);
  assert.equal(db.getCharactersByAccount(id).length, 1);
  assert.ok(db.deleteCharacter(cid, id));
  assert.ok(!db.deleteCharacter(cid, id));

  assert.equal(db.getStructures().length, 6);
  db.setStructureOwner('fort_eldwyn', 'pyrrhos', { fromRealm: 'eldwyn', characterId: null, characterName: 'Aria' });
  assert.equal(db.getStructures().find((s) => s.id === 'fort_eldwyn').owner_realm, 'pyrrhos');
  assert.equal(db.recentCaptures(5)[0].to_realm, 'pyrrhos');
  db.close();
});
