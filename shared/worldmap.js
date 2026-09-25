// shared/worldmap.js
// Disposición del mundo: centros de reino, zonas seguras, castillos, fuertes y
// áreas de aparición de monstruos. Compartido por servidor y cliente.
import { REALMS, REALM_IDS, WORLD_HALF } from './constants.js';
import { deg2rad, dist } from './math.js';

export const REALM_CENTER_DISTANCE = 800;  // distancia del centro del reino al origen
export const REALM_ZONE_RADIUS = 360;      // radio de la zona interior (segura) de cada reino
export const SPAWN_PLATEAU_RADIUS = 70;    // zona plana alrededor del altar
export const CASTLE_DISTANCE = 400;        // distancia del castillo al origen
export const FORT_DISTANCE = 215;          // distancia del fuerte al origen
export const FORT_ANGLE_OFFSET = 32;       // grados de rotación del fuerte respecto al eje del reino
export const STRUCTURE_FLAT_RADIUS = 48;   // zona plana alrededor de estructuras
export const CRATER_RADIUS = 150;

function polar(angleDeg, radius) {
  const a = deg2rad(angleDeg);
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
}

/** Centro (altar / punto de reaparición) de cada reino. */
export const REALM_CENTERS = Object.fromEntries(
  REALM_IDS.map((id) => [id, polar(REALMS[id].angleDeg, REALM_CENTER_DISTANCE)])
);

/**
 * Estructuras capturables. `owner` inicial = reino de origen.
 * kind: 'castle' | 'fort'. Los guardias reaparecen mientras haya dueño.
 */
export const STRUCTURES = [];
for (const id of REALM_IDS) {
  const realm = REALMS[id];
  const castlePos = polar(realm.angleDeg, CASTLE_DISTANCE);
  const fortPos = polar(realm.angleDeg + FORT_ANGLE_OFFSET, FORT_DISTANCE);
  const castleNames = { norheim: 'Castillo de Hielo Eterno', pyrrhos: 'Castillo de la Forja Ardiente', eldwyn: 'Castillo de las Raíces' };
  const fortNames = { norheim: 'Fuerte Ventisca', pyrrhos: 'Fuerte Ceniza', eldwyn: 'Fuerte Espina' };
  STRUCTURES.push({
    id: `castle_${id}`, kind: 'castle', name: castleNames[id], realm: id,
    x: castlePos.x, z: castlePos.z, radius: 26, wallHeight: 9,
    doorHp: 9000, guards: 6, guardType: 'guardia_castillo', guardLevel: 40,
    // la puerta mira hacia el origen (zona de guerra)
    doorAngle: Math.atan2(-castlePos.x, -castlePos.z),
  });
  STRUCTURES.push({
    id: `fort_${id}`, kind: 'fort', name: fortNames[id], realm: id,
    x: fortPos.x, z: fortPos.z, radius: 18, wallHeight: 6,
    doorHp: 5000, guards: 4, guardType: 'guardia', guardLevel: 30,
    doorAngle: Math.atan2(-fortPos.x, -fortPos.z),
  });
}
export const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

/** Posición de la puerta y de la bandera de una estructura. */
export function structureDoorPos(s) {
  return { x: s.x + Math.sin(s.doorAngle) * s.radius, z: s.z + Math.cos(s.doorAngle) * s.radius };
}
export function structureFlagPos(s) {
  return { x: s.x, z: s.z };
}

/** Devuelve el reino cuya zona interior contiene el punto, o null si es zona de guerra. */
export function realmZoneAt(x, z) {
  for (const id of REALM_IDS) {
    const c = REALM_CENTERS[id];
    if (dist(x, z, c.x, c.z) <= REALM_ZONE_RADIUS) return id;
  }
  return null;
}
export function isWarZone(x, z) { return realmZoneAt(x, z) === null; }
export function insideWorld(x, z) {
  return x >= -WORLD_HALF + 5 && x <= WORLD_HALF - 5 && z >= -WORLD_HALF + 5 && z <= WORLD_HALF - 5;
}

/** Pesos de bioma (0..1, suman 1) para colorear el terreno y distribuir fauna. */
export function biomeWeights(x, z) {
  const w = { norheim: 0, pyrrhos: 0, eldwyn: 0, crater: 0 };
  let total = 0;
  for (const id of REALM_IDS) {
    const c = REALM_CENTERS[id];
    const d = Math.max(30, dist(x, z, c.x, c.z));
    const v = 1 / Math.pow(d, 2.2);
    w[id] = v; total += v;
  }
  const dc = Math.max(30, dist(x, z, 0, 0));
  const vc = 1.6 / Math.pow(dc, 2.2);
  w.crater = vc; total += vc;
  for (const k of Object.keys(w)) w[k] /= total;
  return w;
}

/**
 * Áreas de aparición de monstruos en las zonas de reino: anillos concéntricos
 * alrededor del altar. Cada entrada: { realm, typeId, rMin, rMax, count }.
 */
export const REALM_SPAWN_RINGS = {
  norheim: [
    { typeId: 'lobo_hielo', rMin: 80, rMax: 150, count: 14 },
    { typeId: 'oso_polar', rMin: 150, rMax: 220, count: 12 },
    { typeId: 'troll_escarcha', rMin: 220, rMax: 295, count: 12 },
    { typeId: 'yeti', rMin: 295, rMax: 350, count: 10 },
  ],
  pyrrhos: [
    { typeId: 'escorpion', rMin: 80, rMax: 150, count: 14 },
    { typeId: 'chacal', rMin: 150, rMax: 220, count: 12 },
    { typeId: 'salamandra', rMin: 220, rMax: 295, count: 12 },
    { typeId: 'elemental_lava', rMin: 295, rMax: 350, count: 10 },
  ],
  eldwyn: [
    { typeId: 'jabali', rMin: 80, rMax: 150, count: 14 },
    { typeId: 'arana_bosque', rMin: 150, rMax: 220, count: 12 },
    { typeId: 'ent_corrupto', rMin: 220, rMax: 295, count: 12 },
    { typeId: 'driada_oscura', rMin: 295, rMax: 350, count: 10 },
  ],
};
/** Zona de guerra: anillos alrededor del origen. */
export const WAR_SPAWN_RINGS = [
  { typeId: 'ogro', rMin: 330, rMax: 470, count: 30 },
  { typeId: 'dragon_joven', rMin: 200, rMax: 330, count: 18 },
  { typeId: 'golem_ancestral', rMin: 80, rMax: 200, count: 14 },
  { typeId: 'dragon_crater', rMin: 0, rMax: 1, count: 1 },
];
