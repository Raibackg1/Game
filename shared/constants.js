// shared/constants.js
// Definiciones de juego compartidas entre servidor y cliente.
// Todo lo que afecta al balance vive aquí para que ambos lados usen los mismos números.

export const MAX_LEVEL = 60;
export const SUBCLASS_LEVEL = 10;
export const WORLD_SIZE = 2400;          // lado del mapa (unidades)
export const WORLD_HALF = WORLD_SIZE / 2;
export const TICK_RATE = 20;             // simulación servidor (Hz)
export const SNAPSHOT_RATE = 10;         // envío de estado (Hz)
export const INTEREST_RADIUS = 170;      // radio de visibilidad de entidades
export const PLAYER_SPEED = 7.5;         // unidades/segundo
export const PLAYER_RADIUS = 0.6;
export const GLOBAL_COOLDOWN = 1.0;      // segundos
export const RESPAWN_DELAY = 8;          // segundos hasta poder reaparecer
export const CAPTURE_TIME = 30;          // segundos de canalización para capturar un fuerte
export const CAPTURE_RANGE = 4;          // distancia máxima a la bandera
export const DOOR_REPAIR_DELAY = 600;    // segundos hasta que la puerta se repara sola
export const REALM_BONUS_PER_STRUCTURE = 0.02; // +2% daño y XP por estructura poseída
export const HP_REGEN_PCT = 0.012;       // % de HP máximo regenerado por segundo fuera de combate
export const MANA_REGEN_PCT = 0.02;
export const OUT_OF_COMBAT_SECONDS = 6;

// ---------------------------------------------------------------------------
// Reinos
// ---------------------------------------------------------------------------
export const REALMS = {
  norheim: {
    id: 'norheim',
    name: 'Norheim',
    title: 'Reino del Hielo',
    color: 0x4fc3f7,
    cssColor: '#4fc3f7',
    description: 'Tierras heladas del norte. Guerreros curtidos por la ventisca.',
    angleDeg: 270,
  },
  pyrrhos: {
    id: 'pyrrhos',
    name: 'Pyrrhos',
    title: 'Reino del Fuego',
    color: 0xff7043,
    cssColor: '#ff7043',
    description: 'Desiertos volcánicos del sureste. Nada sobrevive allí sin forjarse en la ceniza.',
    angleDeg: 30,
  },
  eldwyn: {
    id: 'eldwyn',
    name: 'Eldwyn',
    title: 'Reino del Bosque',
    color: 0x66bb6a,
    cssColor: '#66bb6a',
    description: 'Bosques antiguos del suroeste, custodiados por arqueros y conjuradores.',
    angleDeg: 150,
  },
};
export const REALM_IDS = Object.keys(REALMS);

// ---------------------------------------------------------------------------
// Razas (3 por reino). Modificadores sobre los atributos base (10 cada uno).
// str = fuerza (daño cuerpo a cuerpo), dex = destreza (daño a distancia, crítico),
// int = inteligencia (daño mágico, maná), con = constitución (vida, armadura).
// ---------------------------------------------------------------------------
export const RACES = {
  // Norheim
  nordo:     { id: 'nordo',     realm: 'norheim', name: 'Nordo',            mods: { str: 2, dex: 0, int: 0, con: 2 }, scale: 1.0,  description: 'Humanos del norte. Equilibrados y resistentes.' },
  enano:     { id: 'enano',     realm: 'norheim', name: 'Enano',            mods: { str: 1, dex: -1, int: 0, con: 4 }, scale: 0.8, description: 'Bajos, macizos, casi imposibles de tumbar.' },
  utgard:    { id: 'utgard',    realm: 'norheim', name: 'Gigante de Utgard', mods: { str: 4, dex: -2, int: -1, con: 3 }, scale: 1.25, description: 'Gigantes de escarcha. Fuerza bruta descomunal.' },
  // Pyrrhos
  ignar:     { id: 'ignar',     realm: 'pyrrhos', name: 'Ignar',            mods: { str: 1, dex: 1, int: 1, con: 1 }, scale: 1.0,  description: 'Humanos del desierto. Versátiles y feroces.' },
  beliak:    { id: 'beliak',    realm: 'pyrrhos', name: 'Beliak',           mods: { str: 3, dex: 2, int: -2, con: 1 }, scale: 1.1,  description: 'Hombres-bestia. Rápidos y salvajes en combate.' },
  cinerio:   { id: 'cinerio',   realm: 'pyrrhos', name: 'Cinerio',          mods: { str: -1, dex: 0, int: 4, con: 1 }, scale: 0.95, description: 'No-muertos de ceniza. Maestros de la magia oscura.' },
  // Eldwyn
  elfo:      { id: 'elfo',      realm: 'eldwyn',  name: 'Elfo',             mods: { str: -1, dex: 3, int: 3, con: -1 }, scale: 1.0, description: 'Ágiles y sabios. Los mejores arqueros y magos.' },
  semielfo:  { id: 'semielfo',  realm: 'eldwyn',  name: 'Semielfo',         mods: { str: 1, dex: 2, int: 1, con: 0 }, scale: 1.0,  description: 'Mezcla de sangre humana y élfica. Adaptables.' },
  silvano:   { id: 'silvano',   realm: 'eldwyn',  name: 'Silvano',          mods: { str: -2, dex: 2, int: 4, con: 0 }, scale: 0.75, description: 'Espíritus menores del bosque. Frágiles pero letales con magia.' },
};
export const RACE_IDS = Object.keys(RACES);

// ---------------------------------------------------------------------------
// Clases. 3 base; al nivel 10 se elige subclase.
// ---------------------------------------------------------------------------
export const CLASSES = {
  guerrero:   { id: 'guerrero',   name: 'Guerrero',   base: null,       tier: 0, role: 'Cuerpo a cuerpo', primary: 'str', hpPerLevel: 14, mpPerLevel: 3, baseArmor: 12, attackRange: 3.0, attackSpeed: 1.8, weapon: 'espada', description: 'Combate cuerpo a cuerpo. Mucha vida y armadura.' },
  arquero:    { id: 'arquero',    name: 'Arquero',    base: null,       tier: 0, role: 'A distancia',     primary: 'dex', hpPerLevel: 10, mpPerLevel: 4, baseArmor: 7,  attackRange: 24.0, attackSpeed: 2.0, weapon: 'arco',   description: 'Ataca desde lejos. Daño constante y críticos.' },
  mago:       { id: 'mago',       name: 'Mago',       base: null,       tier: 0, role: 'Mágico',          primary: 'int', hpPerLevel: 8,  mpPerLevel: 8, baseArmor: 4,  attackRange: 20.0, attackSpeed: 2.2, weapon: 'baston', description: 'Magia ofensiva y de apoyo. Frágil pero devastador.' },

  caballero:  { id: 'caballero',  name: 'Caballero',  base: 'guerrero', tier: 1, role: 'Tanque',          primary: 'str', hpPerLevel: 17, mpPerLevel: 3, baseArmor: 18, attackRange: 3.0, attackSpeed: 1.9, weapon: 'espada', description: 'Defensor del reino. Escudos, provocación y auras.' },
  barbaro:    { id: 'barbaro',    name: 'Bárbaro',    base: 'guerrero', tier: 1, role: 'Daño melé',       primary: 'str', hpPerLevel: 13, mpPerLevel: 3, baseArmor: 10, attackRange: 3.2, attackSpeed: 1.6, weapon: 'hacha',  description: 'Furia pura. El mayor daño cuerpo a cuerpo.' },
  cazador:    { id: 'cazador',    name: 'Cazador',    base: 'arquero',  tier: 1, role: 'Control',         primary: 'dex', hpPerLevel: 11, mpPerLevel: 4, baseArmor: 8,  attackRange: 24.0, attackSpeed: 1.8, weapon: 'arco',   description: 'Velocidad, raíces y disparos certeros.' },
  tirador:    { id: 'tirador',    name: 'Tirador',    base: 'arquero',  tier: 1, role: 'Daño a distancia', primary: 'dex', hpPerLevel: 9,  mpPerLevel: 5, baseArmor: 6,  attackRange: 28.0, attackSpeed: 2.1, weapon: 'arco',   description: 'Alcance extremo y disparos devastadores.' },
  conjurador: { id: 'conjurador', name: 'Conjurador', base: 'mago',     tier: 1, role: 'Sanador',         primary: 'int', hpPerLevel: 9,  mpPerLevel: 9, baseArmor: 5,  attackRange: 20.0, attackSpeed: 2.2, weapon: 'baston', description: 'Curaciones y bendiciones. El corazón de todo ejército.' },
  brujo:      { id: 'brujo',      name: 'Brujo',      base: 'mago',     tier: 1, role: 'Daño mágico',     primary: 'int', hpPerLevel: 7,  mpPerLevel: 9, baseArmor: 3,  attackRange: 22.0, attackSpeed: 2.3, weapon: 'baston', description: 'Maldiciones, drenajes y meteoros.' },
};
export const CLASS_IDS = Object.keys(CLASSES);
export const BASE_CLASS_IDS = CLASS_IDS.filter((c) => CLASSES[c].tier === 0);
export function subclassesOf(baseId) {
  return CLASS_IDS.filter((c) => CLASSES[c].base === baseId);
}
/** Clase base de cualquier clase (para saber qué habilidades hereda). */
export function baseClassOf(classId) {
  const c = CLASSES[classId];
  return c ? (c.base || c.id) : null;
}

// ---------------------------------------------------------------------------
// Habilidades.
// power: 'melee' | 'ranged' | 'spell' → qué poder de ataque escala el efecto.
// effects: lista de efectos aplicados en orden.
//   damage  { mult, flat, aoe? (radio), guaranteedCrit? }
//   heal    { mult, flat }
//   dot/hot { mult, flat, ticks, interval }
//   buff    { stat: 'damageMult'|'damageTakenMult'|'speedMult', value, duration }
//   root    { duration }   slow { value, duration }   taunt { duration }
//   drain   { mult, flat, healPct }   shield { mult, flat, duration }
// target: 'enemy' | 'ally' | 'self'  (ally incluye a uno mismo)
// ---------------------------------------------------------------------------
export const SKILLS = {
  // --- Guerrero (base) ---
  golpe_brutal:     { id: 'golpe_brutal',     name: 'Golpe Brutal',        cls: 'guerrero',   level: 1,  mana: 10, cooldown: 4,  range: 3.5, castTime: 0,   target: 'enemy', power: 'melee',  icon: '⚔️', effects: [{ kind: 'damage', mult: 1.25, flat: 8 }], description: 'Golpe fuerte contra el objetivo.' },
  grito_guerra:     { id: 'grito_guerra',     name: 'Grito de Guerra',     cls: 'guerrero',   level: 4,  mana: 20, cooldown: 30, range: 0,   castTime: 0,   target: 'self',  power: 'melee',  icon: '📣', effects: [{ kind: 'buff', stat: 'damageMult', value: 1.2, duration: 15 }], description: '+20% de daño durante 15 s.' },
  barrido:          { id: 'barrido',          name: 'Barrido',             cls: 'guerrero',   level: 7,  mana: 18, cooldown: 8,  range: 3.5, castTime: 0,   target: 'enemy', power: 'melee',  icon: '🌀', effects: [{ kind: 'damage', mult: 0.9, flat: 5, aoe: 5 }], description: 'Golpea a todos los enemigos cercanos al objetivo.' },
  // --- Caballero ---
  escudo_defensivo: { id: 'escudo_defensivo', name: 'Escudo Defensivo',    cls: 'caballero',  level: 10, mana: 25, cooldown: 40, range: 0,   castTime: 0,   target: 'self',  power: 'melee',  icon: '🛡️', effects: [{ kind: 'buff', stat: 'damageTakenMult', value: 0.6, duration: 10 }], description: '-40% de daño recibido durante 10 s.' },
  provocar:         { id: 'provocar',         name: 'Provocar',            cls: 'caballero',  level: 14, mana: 15, cooldown: 15, range: 15,  castTime: 0,   target: 'enemy', power: 'melee',  icon: '😡', effects: [{ kind: 'taunt', duration: 6 }, { kind: 'damage', mult: 0.4, flat: 2 }], description: 'Obliga a un monstruo a atacarte 6 s.' },
  aura_proteccion:  { id: 'aura_proteccion',  name: 'Aura de Protección',  cls: 'caballero',  level: 20, mana: 40, cooldown: 45, range: 0,   castTime: 0,   target: 'self',  power: 'melee',  icon: '✨', effects: [{ kind: 'hot', mult: 0.3, flat: 6, ticks: 6, interval: 2, aoeAllies: 12 }], description: 'Cura a los aliados cercanos durante 12 s.' },
  // --- Bárbaro ---
  furia:            { id: 'furia',            name: 'Furia',               cls: 'barbaro',    level: 10, mana: 25, cooldown: 45, range: 0,   castTime: 0,   target: 'self',  power: 'melee',  icon: '🔥', effects: [{ kind: 'buff', stat: 'damageMult', value: 1.4, duration: 12 }, { kind: 'buff', stat: 'damageTakenMult', value: 1.15, duration: 12 }], description: '+40% daño, +15% daño recibido, 12 s.' },
  ejecutar:         { id: 'ejecutar',         name: 'Ejecutar',            cls: 'barbaro',    level: 14, mana: 30, cooldown: 12, range: 3.5, castTime: 0,   target: 'enemy', power: 'melee',  icon: '💀', effects: [{ kind: 'damage', mult: 2.2, flat: 15 }], description: 'Golpe demoledor.' },
  torbellino:       { id: 'torbellino',       name: 'Torbellino',          cls: 'barbaro',    level: 20, mana: 35, cooldown: 18, range: 3.5, castTime: 0,   target: 'enemy', power: 'melee',  icon: '🌪️', effects: [{ kind: 'damage', mult: 1.5, flat: 10, aoe: 6 }], description: 'Daño en área alrededor del objetivo.' },
  // --- Arquero (base) ---
  disparo_rapido:   { id: 'disparo_rapido',   name: 'Disparo Rápido',      cls: 'arquero',    level: 1,  mana: 8,  cooldown: 3,  range: 24,  castTime: 0,   target: 'enemy', power: 'ranged', icon: '🏹', effects: [{ kind: 'damage', mult: 1.15, flat: 6 }], description: 'Flecha veloz.' },
  flecha_venenosa:  { id: 'flecha_venenosa',  name: 'Flecha Venenosa',     cls: 'arquero',    level: 4,  mana: 15, cooldown: 12, range: 24,  castTime: 0,   target: 'enemy', power: 'ranged', icon: '☠️', effects: [{ kind: 'damage', mult: 0.5, flat: 3 }, { kind: 'dot', mult: 0.35, flat: 3, ticks: 5, interval: 2 }], description: 'Envenena durante 10 s.' },
  disparo_penetrante: { id: 'disparo_penetrante', name: 'Disparo Penetrante', cls: 'arquero', level: 7, mana: 18, cooldown: 10, range: 24, castTime: 0.8, target: 'enemy', power: 'ranged', icon: '🎯', effects: [{ kind: 'damage', mult: 1.6, flat: 10, armorPen: 0.5 }], description: 'Ignora el 50% de la armadura.' },
  // --- Cazador ---
  paso_ligero:      { id: 'paso_ligero',      name: 'Paso Ligero',         cls: 'cazador',    level: 10, mana: 20, cooldown: 30, range: 0,   castTime: 0,   target: 'self',  power: 'ranged', icon: '💨', effects: [{ kind: 'buff', stat: 'speedMult', value: 1.5, duration: 8 }], description: '+50% velocidad durante 8 s.' },
  flecha_paralizante: { id: 'flecha_paralizante', name: 'Flecha Paralizante', cls: 'cazador', level: 14, mana: 22, cooldown: 25, range: 24, castTime: 0, target: 'enemy', power: 'ranged', icon: '🕸️', effects: [{ kind: 'root', duration: 4 }, { kind: 'damage', mult: 0.6, flat: 4 }], description: 'Inmoviliza 4 s.' },
  disparo_certero:  { id: 'disparo_certero',  name: 'Disparo Certero',     cls: 'cazador',    level: 20, mana: 28, cooldown: 15, range: 24,  castTime: 0,   target: 'enemy', power: 'ranged', icon: '💥', effects: [{ kind: 'damage', mult: 1.6, flat: 12, guaranteedCrit: true }], description: 'Crítico garantizado.' },
  // --- Tirador ---
  tiro_largo:       { id: 'tiro_largo',       name: 'Tiro Largo',          cls: 'tirador',    level: 10, mana: 25, cooldown: 10, range: 36,  castTime: 2,   target: 'enemy', power: 'ranged', icon: '🔭', effects: [{ kind: 'damage', mult: 2.0, flat: 12 }], description: 'Alcance enorme, 2 s de preparación.' },
  lluvia_flechas:   { id: 'lluvia_flechas',   name: 'Lluvia de Flechas',   cls: 'tirador',    level: 14, mana: 35, cooldown: 20, range: 28,  castTime: 1.5, target: 'enemy', power: 'ranged', icon: '🌧️', effects: [{ kind: 'damage', mult: 1.2, flat: 8, aoe: 8 }], description: 'Daño en área.' },
  disparo_letal:    { id: 'disparo_letal',    name: 'Disparo Letal',       cls: 'tirador',    level: 20, mana: 45, cooldown: 25, range: 30,  castTime: 3,   target: 'enemy', power: 'ranged', icon: '☄️', effects: [{ kind: 'damage', mult: 2.8, flat: 20 }], description: 'El disparo más potente del juego.' },
  // --- Mago (base) ---
  descarga_arcana:  { id: 'descarga_arcana',  name: 'Descarga Arcana',     cls: 'mago',       level: 1,  mana: 12, cooldown: 2.5, range: 20, castTime: 1,   target: 'enemy', power: 'spell',  icon: '🔮', effects: [{ kind: 'damage', mult: 1.3, flat: 8 }], description: 'Proyectil arcano.' },
  escudo_mana:      { id: 'escudo_mana',      name: 'Escudo de Maná',      cls: 'mago',       level: 4,  mana: 25, cooldown: 25, range: 0,   castTime: 0,   target: 'self',  power: 'spell',  icon: '🔵', effects: [{ kind: 'shield', mult: 1.5, flat: 20, duration: 15 }], description: 'Absorbe daño durante 15 s.' },
  rayo_helado:      { id: 'rayo_helado',      name: 'Rayo Helado',         cls: 'mago',       level: 7,  mana: 20, cooldown: 8,  range: 20,  castTime: 1.2, target: 'enemy', power: 'spell',  icon: '❄️', effects: [{ kind: 'damage', mult: 1.4, flat: 8 }, { kind: 'slow', value: 0.5, duration: 5 }], description: 'Daño y ralentiza 50% 5 s.' },
  // --- Conjurador ---
  curar:            { id: 'curar',            name: 'Curar',               cls: 'conjurador', level: 10, mana: 22, cooldown: 3,  range: 25,  castTime: 1.5, target: 'ally',  power: 'spell',  icon: '💚', effects: [{ kind: 'heal', mult: 2.0, flat: 20 }], description: 'Cura a un aliado.' },
  regeneracion:     { id: 'regeneracion',     name: 'Regeneración',        cls: 'conjurador', level: 14, mana: 28, cooldown: 10, range: 25,  castTime: 0,   target: 'ally',  power: 'spell',  icon: '🌿', effects: [{ kind: 'hot', mult: 0.5, flat: 8, ticks: 6, interval: 2 }], description: 'Cura durante 12 s.' },
  bendicion:        { id: 'bendicion',        name: 'Bendición',           cls: 'conjurador', level: 20, mana: 35, cooldown: 30, range: 25,  castTime: 0,   target: 'ally',  power: 'spell',  icon: '🙏', effects: [{ kind: 'buff', stat: 'damageMult', value: 1.15, duration: 30 }], description: '+15% de daño a un aliado 30 s.' },
  // --- Brujo ---
  drenar_vida:      { id: 'drenar_vida',      name: 'Drenar Vida',         cls: 'brujo',      level: 10, mana: 20, cooldown: 8,  range: 20,  castTime: 1,   target: 'enemy', power: 'spell',  icon: '🩸', effects: [{ kind: 'drain', mult: 1.3, flat: 8, healPct: 0.5 }], description: 'Daña y te cura el 50%.' },
  maldicion:        { id: 'maldicion',        name: 'Maldición',           cls: 'brujo',      level: 14, mana: 25, cooldown: 14, range: 22,  castTime: 0,   target: 'enemy', power: 'spell',  icon: '🕯️', effects: [{ kind: 'dot', mult: 0.45, flat: 5, ticks: 6, interval: 2 }, { kind: 'buff', stat: 'damageTakenMult', value: 1.15, duration: 12 }], description: 'Daño en el tiempo y +15% daño recibido.' },
  meteoro:          { id: 'meteoro',          name: 'Meteoro',             cls: 'brujo',      level: 20, mana: 50, cooldown: 30, range: 24,  castTime: 3,   target: 'enemy', power: 'spell',  icon: '🌠', effects: [{ kind: 'damage', mult: 2.2, flat: 25, aoe: 8 }], description: 'Devastación en área tras 3 s.' },
};
export const SKILL_IDS = Object.keys(SKILLS);

/** Habilidades disponibles para una clase y nivel dados (incluye las de la clase base). */
export function skillsFor(classId, level) {
  const base = baseClassOf(classId);
  return SKILL_IDS
    .map((id) => SKILLS[id])
    .filter((s) => (s.cls === classId || s.cls === base) && s.level <= level)
    .sort((a, b) => a.level - b.level);
}

// ---------------------------------------------------------------------------
// Experiencia
// ---------------------------------------------------------------------------
/** XP necesaria para pasar del nivel `level` al siguiente. */
export function xpForNextLevel(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.floor(100 * Math.pow(level, 1.8) + 50 * level);
}
/** XP otorgada por matar un monstruo de nivel mobLevel a un jugador de nivel playerLevel. */
export function xpForKill(mobLevel, playerLevel, elite = false) {
  const diff = mobLevel - playerLevel;
  let factor = 1;
  if (diff <= -8) factor = 0.1;
  else if (diff < 0) factor = 1 + diff * 0.1;   // -10% por nivel por debajo
  else factor = 1 + Math.min(diff, 5) * 0.15;   // +15% por nivel por encima (máx 5)
  const base = 18 + mobLevel * 14;
  return Math.max(1, Math.floor(base * factor * (elite ? 5 : 1)));
}

// ---------------------------------------------------------------------------
// Atributos derivados
// ---------------------------------------------------------------------------
export function baseStats(raceId) {
  const r = RACES[raceId];
  return {
    str: 10 + r.mods.str,
    dex: 10 + r.mods.dex,
    int: 10 + r.mods.int,
    con: 10 + r.mods.con,
  };
}
/** Atributos a un nivel dado: +1 al primario cada nivel, +1 a los demás cada 2 niveles. */
export function statsAtLevel(raceId, classId, level) {
  const s = baseStats(raceId);
  const primary = CLASSES[classId].primary;
  for (const k of Object.keys(s)) {
    s[k] += k === primary ? (level - 1) : Math.floor((level - 1) / 2);
  }
  return s;
}
export function derivedStats(raceId, classId, level) {
  const s = statsAtLevel(raceId, classId, level);
  const c = CLASSES[classId];
  return {
    ...s,
    maxHp: Math.floor(80 + s.con * 8 + level * c.hpPerLevel),
    maxMana: Math.floor(50 + s.int * 6 + level * c.mpPerLevel),
    meleePower: s.str * 2 + level,
    rangedPower: s.dex * 2 + level,
    spellPower: s.int * 2 + level,
    armor: c.baseArmor + level * 2 + Math.floor(s.con / 2),
    critChance: Math.min(0.3, 0.05 + s.dex * 0.002),
    attackRange: c.attackRange,
    attackSpeed: c.attackSpeed,
  };
}
/** Mitigación por armadura (0..0.6). */
export function armorMitigation(armor, attackerLevel) {
  return Math.min(0.6, armor / (armor + 100 + attackerLevel * 5));
}

// ---------------------------------------------------------------------------
// Monstruos. hpMult/dmgMult permiten élites.
// ---------------------------------------------------------------------------
export const MOB_TYPES = {
  // Norheim (1-25)
  lobo_hielo:      { id: 'lobo_hielo',      name: 'Lobo de Hielo',      shape: 'quadruped', color: 0xcfd8dc, minLevel: 1,  maxLevel: 5,  aggressive: false, speed: 6.5, scale: 0.8 },
  oso_polar:       { id: 'oso_polar',       name: 'Oso Polar',          shape: 'quadruped', color: 0xeeeeee, minLevel: 5,  maxLevel: 10, aggressive: true,  speed: 6.0, scale: 1.2 },
  troll_escarcha:  { id: 'troll_escarcha',  name: 'Troll de Escarcha',  shape: 'humanoid',  color: 0x80cbc4, minLevel: 10, maxLevel: 18, aggressive: true,  speed: 5.5, scale: 1.4 },
  yeti:            { id: 'yeti',            name: 'Yeti',               shape: 'humanoid',  color: 0xe0f7fa, minLevel: 18, maxLevel: 25, aggressive: true,  speed: 6.0, scale: 1.6 },
  // Pyrrhos (1-25)
  escorpion:       { id: 'escorpion',       name: 'Escorpión Gigante',  shape: 'spider',    color: 0x8d6e63, minLevel: 1,  maxLevel: 5,  aggressive: false, speed: 6.0, scale: 0.8 },
  chacal:          { id: 'chacal',          name: 'Chacal de Ceniza',   shape: 'quadruped', color: 0xa1887f, minLevel: 5,  maxLevel: 10, aggressive: true,  speed: 7.0, scale: 0.9 },
  salamandra:      { id: 'salamandra',      name: 'Salamandra Ígnea',   shape: 'quadruped', color: 0xff7043, minLevel: 10, maxLevel: 18, aggressive: true,  speed: 6.0, scale: 1.2 },
  elemental_lava:  { id: 'elemental_lava',  name: 'Elemental de Lava',  shape: 'humanoid',  color: 0xff3d00, minLevel: 18, maxLevel: 25, aggressive: true,  speed: 5.0, scale: 1.6 },
  // Eldwyn (1-25)
  jabali:          { id: 'jabali',          name: 'Jabalí Salvaje',     shape: 'quadruped', color: 0x6d4c41, minLevel: 1,  maxLevel: 5,  aggressive: false, speed: 6.5, scale: 0.8 },
  arana_bosque:    { id: 'arana_bosque',    name: 'Araña del Bosque',   shape: 'spider',    color: 0x33691e, minLevel: 5,  maxLevel: 10, aggressive: true,  speed: 6.5, scale: 1.0 },
  ent_corrupto:    { id: 'ent_corrupto',    name: 'Ent Corrupto',       shape: 'humanoid',  color: 0x4e342e, minLevel: 10, maxLevel: 18, aggressive: true,  speed: 4.5, scale: 1.7 },
  driada_oscura:   { id: 'driada_oscura',   name: 'Dríada Oscura',      shape: 'humanoid',  color: 0x7e57c2, minLevel: 18, maxLevel: 25, aggressive: true,  speed: 6.5, scale: 1.1 },
  // Zona de guerra (25-60)
  ogro:            { id: 'ogro',            name: 'Ogro de Guerra',     shape: 'humanoid',  color: 0x827717, minLevel: 25, maxLevel: 35, aggressive: true,  speed: 5.5, scale: 1.8 },
  dragon_joven:    { id: 'dragon_joven',    name: 'Dragón Joven',       shape: 'dragon',    color: 0xb71c1c, minLevel: 35, maxLevel: 45, aggressive: true,  speed: 7.0, scale: 1.6 },
  golem_ancestral: { id: 'golem_ancestral', name: 'Gólem Ancestral',    shape: 'humanoid',  color: 0x546e7a, minLevel: 45, maxLevel: 55, aggressive: true,  speed: 4.5, scale: 2.2 },
  dragon_crater:   { id: 'dragon_crater',   name: 'Dragón del Cráter',  shape: 'dragon',    color: 0x212121, minLevel: 60, maxLevel: 60, aggressive: true,  speed: 7.5, scale: 3.5, elite: true },
  // Guardias de estructuras (no dan XP normal)
  guardia:         { id: 'guardia',         name: 'Guardia',            shape: 'humanoid',  color: 0x9e9e9e, minLevel: 30, maxLevel: 30, aggressive: true,  speed: 6.5, scale: 1.05, guard: true },
  guardia_castillo:{ id: 'guardia_castillo',name: 'Guardia Real',       shape: 'humanoid',  color: 0xbdbdbd, minLevel: 40, maxLevel: 40, aggressive: true,  speed: 6.5, scale: 1.1, guard: true },
};

export function mobStats(typeId, level) {
  const t = MOB_TYPES[typeId];
  const eliteMult = t.elite ? 12 : 1;
  const guardMult = t.guard ? 2.5 : 1;
  return {
    maxHp: Math.floor((30 + level * 22) * eliteMult * guardMult),
    damage: Math.floor((4 + level * 2.2) * (t.elite ? 2.5 : 1)),
    armor: Math.floor(level * 1.5),
    attackSpeed: t.elite ? 1.5 : 2.0,
    attackRange: t.shape === 'dragon' ? 6 : 2.5,
    aggroRadius: t.aggressive ? (t.elite ? 30 : 12) : 0,
    leashRadius: 45,
    speed: t.speed,
    gold: Math.floor((2 + level * 1.5) * (t.elite ? 20 : 1)),
  };
}

// ---------------------------------------------------------------------------
// Canales de chat
// ---------------------------------------------------------------------------
export const CHAT_CHANNELS = ['say', 'realm', 'global'];
export const SAY_RADIUS = 40;
export const CHAT_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Validación de nombres
// ---------------------------------------------------------------------------
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
export const CHARNAME_RE = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]{3,14}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
