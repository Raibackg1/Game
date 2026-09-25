// shared/terrain.js
// Altura del terreno determinista. El servidor la usa para posicionar entidades
// y el cliente para construir la malla: ambos deben coincidir exactamente.
import { hash2, smoothstep, lerp, clamp, dist } from './math.js';
import {
  REALM_CENTERS, STRUCTURES, SPAWN_PLATEAU_RADIUS, STRUCTURE_FLAT_RADIUS, CRATER_RADIUS,
} from './worldmap.js';
import { REALM_IDS } from './constants.js';

const SEED = 90210;

/** Ruido de valor 2D interpolado, en [0,1]. */
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = smoothstep(fx), sz = smoothstep(fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function fbm(x, z, octaves, baseFreq, seed) {
  let amp = 1, freq = baseFreq, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq, z * freq, seed + i * 101) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm; // [-1,1]
}

export const WATER_LEVEL = 0.0;

/** Altura "bruta" antes de aplanar zonas jugables. */
function rawHeight(x, z) {
  // Colinas base
  let h = 4 + fbm(x, z, 4, 1 / 190, SEED) * 7;
  // Detalle
  h += fbm(x, z, 3, 1 / 38, SEED + 7) * 1.2;

  // Montañas del norte (Norheim): relieve más agresivo
  const cn = REALM_CENTERS.norheim;
  const dn = dist(x, z, cn.x, cn.z);
  const wn = clamp(1 - dn / 520, 0, 1);
  h += wn * Math.abs(fbm(x, z, 3, 1 / 120, SEED + 31)) * 14;

  // Dunas de Pyrrhos: ondulación larga
  const cp = REALM_CENTERS.pyrrhos;
  const wp = clamp(1 - dist(x, z, cp.x, cp.z) / 520, 0, 1);
  h += wp * Math.sin(x * 0.045 + z * 0.02) * 1.8;

  // Cráter central: borde elevado y fondo hundido
  const dc = dist(x, z, 0, 0);
  if (dc < CRATER_RADIUS * 1.6) {
    const t = dc / CRATER_RADIUS;
    const rim = Math.exp(-Math.pow((t - 1.05) / 0.22, 2)) * 9;  // anillo
    const bowl = t < 1 ? -(1 - t * t) * 4.5 : 0;                   // hueco
    h += rim + bowl;
  }
  return h;
}

/** Aplana suavemente hacia `flatH` dentro de `radius` alrededor de (cx,cz). */
function flatten(h, x, z, cx, cz, radius, flatH) {
  const d = dist(x, z, cx, cz);
  if (d >= radius) return h;
  // totalmente plano en la mitad interior, transición suave en la exterior
  const t = smoothstep(clamp((d - radius * 0.5) / (radius * 0.5), 0, 1));
  return lerp(flatH, h, t);
}

// Alturas fijas de mesetas (calculadas con el ruido para que sean coherentes)
const PLATEAU_HEIGHTS = {};
for (const id of REALM_IDS) {
  const c = REALM_CENTERS[id];
  PLATEAU_HEIGHTS[id] = Math.max(3, rawHeight(c.x, c.z));
}
const STRUCT_HEIGHTS = {};
for (const s of STRUCTURES) {
  STRUCT_HEIGHTS[s.id] = Math.max(3, rawHeight(s.x, s.z));
}

/** Altura final del terreno en (x,z). */
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const id of REALM_IDS) {
    const c = REALM_CENTERS[id];
    h = flatten(h, x, z, c.x, c.z, SPAWN_PLATEAU_RADIUS, PLATEAU_HEIGHTS[id]);
  }
  for (const s of STRUCTURES) {
    h = flatten(h, x, z, s.x, s.z, STRUCTURE_FLAT_RADIUS, STRUCT_HEIGHTS[s.id]);
  }
  return h;
}

/** Normal aproximada del terreno (para inclinar props). */
export function terrainNormal(x, z, eps = 0.5) {
  const hl = terrainHeight(x - eps, z), hr = terrainHeight(x + eps, z);
  const hd = terrainHeight(x, z - eps), hu = terrainHeight(x, z + eps);
  const nx = hl - hr, nz = hd - hu, ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz);
  return { x: nx / len, y: ny / len, z: nz / len };
}
