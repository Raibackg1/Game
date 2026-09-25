// scripts/balance-sim.mjs
// Simulación de balance: cada clase base contra el monstruo típico de su nivel.
// Bot simple: autoataque + usa habilidades ofensivas disponibles cuando no hay enfriamiento.
import { GameDB } from '../server/db.js';
import { World } from '../server/world/world.js';
import { Mob } from '../server/world/entities.js';
import { derivedStats, skillsFor, SKILLS, MOB_TYPES } from '../shared/constants.js';
import { REALM_CENTERS } from '../shared/worldmap.js';
import { seededRandom } from '../shared/math.js';

const fakeSession = () => ({ send() {}, sendError() {} });
function makePlayer(w, db, { name, realm, race, cls, level, x, z }) {
  const d = derivedStats(race, cls, level);
  const accId = db.createAccount(name.toLowerCase() + Math.random().toString(36).slice(2, 6), 'h', 's');
  const cid = db.createCharacter({ accountId: accId, name, realm, race, cls, x, z, yaw: 0, hp: d.maxHp, mana: d.maxMana });
  const row = db.getCharacter(cid); row.level = level;
  const p = w.addPlayer(row, fakeSession());
  p.level = level; p.recalc(); p.hp = p.maxHp; p.mana = p.maxMana;
  return p;
}
function duel({ race, cls, level, mobType, mobLevel, seed }) {
  const db = new GameDB(':memory:');
  const w = new World(db, { rng: seededRandom(seed) });
  w.init();
  const c = REALM_CENTERS.eldwyn; // altar: sin monstruos alrededor
  const p = makePlayer(w, db, { name: 'Bot', realm: 'eldwyn', race, cls, level, x: c.x, z: c.z });
  const mob = new Mob(mobType, mobLevel, c.x + 2, c.z); w.addEntity(mob);
  let t = Date.now();
  w.setTarget(p, mob.id); w.setAutoAttack(p, true);
  const offensive = skillsFor(cls, level).filter((s) => s.target === 'enemy');
  const selfBuffs = skillsFor(cls, level).filter((s) => s.target === 'self' || s.target === 'ally');
  let ticks = 0;
  while (p.alive && mob.alive && ticks < 20 * 120) { // máx 120 s
    t += 50; ticks++;
    // mantener distancia de la clase: los a distancia se quedan quietos (el monstruo viene)
    for (const s of [...selfBuffs, ...offensive]) {
      if (!p.alive || !mob.alive) break;
      const r = w.useSkill(p, s.id, mob.id, t);
      if (r === null) break; // una habilidad por tick (GCD)
    }
    w.tick(0.05, t);
  }
  return { won: mob.dead, seconds: ticks / 20, hpLeft: p.alive ? p.hp / p.maxHp : 0, playerDead: p.dead, mobHpLeft: mob.hp / mob.maxHp };
}

const cases = [
  { level: 1, mobType: 'jabali', mobLevel: 1 }, { level: 1, mobType: 'jabali', mobLevel: 3 },
  { level: 5, mobType: 'arana_bosque', mobLevel: 5 }, { level: 7, mobType: 'arana_bosque', mobLevel: 8 },
  { level: 10, mobType: 'ent_corrupto', mobLevel: 10 }, { level: 14, mobType: 'ent_corrupto', mobLevel: 14 },
  { level: 18, mobType: 'driada_oscura', mobLevel: 18 }, { level: 22, mobType: 'driada_oscura', mobLevel: 22 },
  { level: 26, mobType: 'ogro', mobLevel: 26 }, { level: 30, mobType: 'guardia', mobLevel: 30 },
  { level: 36, mobType: 'dragon_joven', mobLevel: 36 }, { level: 46, mobType: 'golem_ancestral', mobLevel: 46 },
];
const classes = [
  ['nordo', 'guerrero'], ['elfo', 'arquero'], ['silvano', 'mago'],
  ['enano', 'caballero'], ['utgard', 'barbaro'], ['semielfo', 'cazador'], ['elfo', 'tirador'], ['cinerio', 'conjurador'], ['cinerio', 'brujo'],
];
console.log('clase        | nivel vs monstruo(nivel)      | victorias | t medio | vida restante');
for (const [race, cls] of classes) {
  for (const cse of cases) {
    if (cse.level < 10 && ['caballero', 'barbaro', 'cazador', 'tirador', 'conjurador', 'brujo'].includes(cls)) continue;
    if (cse.level >= 10 && ['guerrero', 'arquero', 'mago'].includes(cls)) continue;
    let wins = 0, secs = 0, hp = 0; const N = 5;
    for (let i = 0; i < N; i++) { const r = duel({ race, cls, seed: 100 + i, ...cse }); if (r.won) { wins++; secs += r.seconds; hp += r.hpLeft; } }
    const label = `${cls.padEnd(12)} | L${String(cse.level).padStart(2)} vs ${cse.mobType}(${cse.mobLevel})`.padEnd(46);
    console.log(`${label}| ${wins}/${N}       | ${wins ? (secs / wins).toFixed(1).padStart(5) : '  -  '}s | ${wins ? Math.round(hp / wins * 100) : 0}%`);
  }
}
