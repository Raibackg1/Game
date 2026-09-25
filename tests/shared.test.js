// tests/shared.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REALMS, RACES, CLASSES, SKILLS, SKILL_IDS, skillsFor, xpForNextLevel, xpForKill, derivedStats, armorMitigation,
  MAX_LEVEL, baseClassOf, subclassesOf, MOB_TYPES, mobStats,
} from '../shared/constants.js';
import { terrainHeight, terrainNormal } from '../shared/terrain.js';
import { REALM_CENTERS, STRUCTURES, realmZoneAt, isWarZone, structureDoorPos, biomeWeights } from '../shared/worldmap.js';
import { hash2, seededRandom } from '../shared/math.js';

test('cada raza pertenece a un reino existente y hay 3 por reino', () => {
  const count = {};
  for (const r of Object.values(RACES)) {
    assert.ok(REALMS[r.realm], `reino ${r.realm} no existe`);
    count[r.realm] = (count[r.realm] || 0) + 1;
  }
  assert.deepEqual(count, { norheim: 3, pyrrhos: 3, eldwyn: 3 });
});

test('cada clase base tiene exactamente 2 subclases y toda habilidad referencia una clase válida', () => {
  for (const base of ['guerrero', 'arquero', 'mago']) assert.equal(subclassesOf(base).length, 2);
  for (const id of SKILL_IDS) {
    const s = SKILLS[id];
    assert.ok(CLASSES[s.cls], `habilidad ${id} referencia clase inexistente ${s.cls}`);
    assert.ok(['enemy', 'ally', 'self'].includes(s.target));
    assert.ok(s.effects.length > 0);
  }
  assert.equal(baseClassOf('brujo'), 'mago');
});

test('las subclases heredan las habilidades de su clase base y las de nivel <= L', () => {
  const ids = skillsFor('caballero', 15).map((s) => s.id);
  assert.ok(ids.includes('golpe_brutal'));
  assert.ok(ids.includes('escudo_defensivo'));
  assert.ok(ids.includes('provocar'));
  assert.ok(!ids.includes('aura_proteccion'));  // nivel 20
  assert.ok(!ids.includes('furia'));            // subclase distinta
  assert.deepEqual(skillsFor('mago', 1).map((s) => s.id), ['descarga_arcana']);
});

test('curva de XP es creciente y finita hasta el nivel máximo', () => {
  let prev = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    const x = xpForNextLevel(l);
    assert.ok(x > prev, `xp nivel ${l}`);
    prev = x;
  }
  assert.equal(xpForNextLevel(MAX_LEVEL), Infinity);
  assert.ok(xpForKill(1, 1) > 0);
  assert.ok(xpForKill(1, 20) < xpForKill(1, 1), 'monstruos grises dan menos XP');
  assert.ok(xpForKill(10, 5) > xpForKill(10, 10), 'monstruos superiores dan más XP');
});

test('estadísticas derivadas crecen con el nivel y la mitigación está acotada', () => {
  const l1 = derivedStats('nordo', 'guerrero', 1);
  const l30 = derivedStats('nordo', 'guerrero', 30);
  assert.ok(l30.maxHp > l1.maxHp * 3);
  assert.ok(l30.meleePower > l1.meleePower);
  assert.ok(armorMitigation(0, 1) === 0);
  assert.ok(armorMitigation(1e9, 1) <= 0.6);
  for (const t of Object.keys(MOB_TYPES)) {
    const s = mobStats(t, MOB_TYPES[t].minLevel);
    assert.ok(s.maxHp > 0 && s.damage > 0 && s.speed > 0, t);
  }
});

test('terreno determinista y plano en altares/estructuras', () => {
  assert.equal(terrainHeight(123.4, -567.8), terrainHeight(123.4, -567.8));
  for (const [id, c] of Object.entries(REALM_CENTERS)) {
    const h0 = terrainHeight(c.x, c.z);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const h = terrainHeight(c.x + Math.cos(a) * 20, c.z + Math.sin(a) * 20);
      assert.ok(Math.abs(h - h0) < 0.35, `altar ${id} no es plano: ${h0} vs ${h}`);
    }
    assert.ok(h0 > 0.5, `altar ${id} bajo el agua`);
  }
  for (const s of STRUCTURES) {
    assert.ok(terrainHeight(s.x, s.z) > 0.5, `${s.id} bajo el agua`);
    const dp = structureDoorPos(s);
    assert.ok(Math.abs(terrainHeight(dp.x, dp.z) - terrainHeight(s.x, s.z)) < 0.5, `${s.id} puerta desnivelada`);
  }
  const n = terrainNormal(100, 100);
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-6);
});

test('zonas: altares dentro de su reino, estructuras y origen en zona de guerra', () => {
  for (const [id, c] of Object.entries(REALM_CENTERS)) assert.equal(realmZoneAt(c.x, c.z), id);
  for (const s of STRUCTURES) assert.ok(isWarZone(s.x, s.z), `${s.id} debe estar en zona de guerra`);
  assert.ok(isWarZone(0, 0));
  const w = biomeWeights(0, -800);
  assert.ok(w.norheim > 0.9);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('hash y PRNG con semilla son deterministas y están en [0,1)', () => {
  assert.equal(hash2(5, 7, 1), hash2(5, 7, 1));
  assert.notEqual(hash2(5, 7, 1), hash2(5, 7, 2));
  const a = seededRandom(9), b = seededRandom(9);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
