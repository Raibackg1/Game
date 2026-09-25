// client/render/terrain.js
// Malla del terreno (misma función de altura que el servidor), agua, vegetación y fronteras de reino.
import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL } from '/shared/terrain.js';
import { biomeWeights, REALM_CENTERS, REALM_ZONE_RADIUS, STRUCTURES, SPAWN_PLATEAU_RADIUS } from '/shared/worldmap.js';
import { WORLD_SIZE, WORLD_HALF, REALMS, REALM_IDS } from '/shared/constants.js';
import { seededRandom, dist, hash2, clamp } from '/shared/math.js';

const SEGMENTS = 240;

const PALETTE = {
  snow: new THREE.Color(0.93, 0.95, 1.0),
  frostGrass: new THREE.Color(0.52, 0.66, 0.58),
  sand: new THREE.Color(0.86, 0.68, 0.42),
  volcanic: new THREE.Color(0.38, 0.26, 0.22),
  grass: new THREE.Color(0.30, 0.56, 0.26),
  forestDark: new THREE.Color(0.20, 0.40, 0.20),
  rock: new THREE.Color(0.46, 0.45, 0.47),
  crater: new THREE.Color(0.28, 0.27, 0.30),
  mud: new THREE.Color(0.35, 0.33, 0.25),
};

const _tmp = new THREE.Color();
function colorAt(x, z, h, slope, out) {
  const w = biomeWeights(x, z);
  out.setRGB(0, 0, 0);
  // Norheim: nieve arriba, hierba helada abajo
  _tmp.copy(PALETTE.frostGrass).lerp(PALETTE.snow, clamp((h - 6) / 8, 0, 1));
  out.r += _tmp.r * w.norheim; out.g += _tmp.g * w.norheim; out.b += _tmp.b * w.norheim;
  // Pyrrhos: arena, roca volcánica en alto
  _tmp.copy(PALETTE.sand).lerp(PALETTE.volcanic, clamp((h - 7) / 7, 0, 1));
  out.r += _tmp.r * w.pyrrhos; out.g += _tmp.g * w.pyrrhos; out.b += _tmp.b * w.pyrrhos;
  // Eldwyn: hierba, bosque oscuro en bajo
  _tmp.copy(PALETTE.grass).lerp(PALETTE.forestDark, clamp((5 - h) / 5, 0, 1));
  out.r += _tmp.r * w.eldwyn; out.g += _tmp.g * w.eldwyn; out.b += _tmp.b * w.eldwyn;
  // Cráter
  out.r += PALETTE.crater.r * w.crater; out.g += PALETTE.crater.g * w.crater; out.b += PALETTE.crater.b * w.crater;
  // pendientes → roca
  const rockT = clamp((slope - 0.35) / 0.35, 0, 1);
  out.lerp(PALETTE.rock, rockT * 0.85);
  // orilla / fondo
  if (h < WATER_LEVEL + 0.6) out.lerp(PALETTE.mud, clamp((WATER_LEVEL + 0.6 - h) / 1.2, 0, 1) * 0.8);
  // variación sutil
  const n = (hash2(Math.floor(x * 0.7), Math.floor(z * 0.7), 5) - 0.5) * 0.08;
  out.r = clamp(out.r + n, 0, 1); out.g = clamp(out.g + n, 0, 1); out.b = clamp(out.b + n, 0, 1);
}

export function buildTerrainMesh() {
  const n = SEGMENTS + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const step = WORLD_SIZE / SEGMENTS;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    heights[iz * n + ix] = terrainHeight(-WORLD_HALF + ix * step, -WORLD_HALF + iz * step);
  }
  const c = new THREE.Color();
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = -WORLD_HALF + ix * step, z = -WORLD_HALF + iz * step;
    const i = iz * n + ix;
    const h = heights[i];
    const hl = heights[iz * n + Math.max(0, ix - 1)], hr = heights[iz * n + Math.min(n - 1, ix + 1)];
    const hd = heights[Math.max(0, iz - 1) * n + ix], hu = heights[Math.min(n - 1, iz + 1) * n + ix];
    const slope = Math.hypot(hr - hl, hu - hd) / (2 * step);
    positions[i * 3] = x; positions[i * 3 + 1] = h; positions[i * 3 + 2] = z;
    colorAt(x, z, h, slope, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
  let k = 0;
  for (let iz = 0; iz < SEGMENTS; iz++) for (let ix = 0; ix < SEGMENTS; ix++) {
    const a = iz * n + ix, b = a + 1, cc = a + n, d = cc + 1;
    indices[k++] = a; indices[k++] = cc; indices[k++] = b;
    indices[k++] = b; indices[k++] = cc; indices[k++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({ color: 0x2f6fb5, transparent: true, opacity: 0.72, shininess: 90, specular: 0x88bbff });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL + 0.25;
  mesh.name = 'water';
  return mesh;
}

function dominantBiome(x, z) {
  const w = biomeWeights(x, z);
  let best = 'crater', bv = -1;
  for (const k of Object.keys(w)) if (w[k] > bv) { bv = w[k]; best = k; }
  return best;
}

function placeable(x, z) {
  const h = terrainHeight(x, z);
  if (h < WATER_LEVEL + 0.6) return false;
  if (dist(x, z, 0, 0) < 30) return false;
  for (const id of REALM_IDS) { const c = REALM_CENTERS[id]; if (dist(x, z, c.x, c.z) < SPAWN_PLATEAU_RADIUS + 8) return false; }
  for (const s of STRUCTURES) if (dist(x, z, s.x, s.z) < s.radius + 14) return false;
  return true;
}

function instanced(geometry, color, transforms, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, ...(opts.matProps || {}) });
  const mesh = new THREE.InstancedMesh(geometry, mat, transforms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  transforms.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    p.set(t.x, t.y, t.z); s.set(t.s, t.s * (t.sy || 1), t.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  return mesh;
}

/** Vegetación y rocas por bioma (determinista). */
export function buildProps() {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = seededRandom(7777);
  const pines = [], oaks = [], cacti = [], rocks = [], craterRocks = [];
  const ATTEMPTS = 5200;
  for (let i = 0; i < ATTEMPTS; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 20), z = (rng() * 2 - 1) * (WORLD_HALF - 20);
    if (!placeable(x, z)) continue;
    const y = terrainHeight(x, z);
    const b = dominantBiome(x, z);
    const t = { x, y, z, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.7 };
    if (b === 'norheim') { if (rng() < 0.8) pines.push(t); else rocks.push(t); }
    else if (b === 'eldwyn') { if (rng() < 0.85) oaks.push(t); else rocks.push(t); }
    else if (b === 'pyrrhos') { if (rng() < 0.5) cacti.push(t); else rocks.push(t); }
    else { if (rng() < 0.7) craterRocks.push({ ...t, s: t.s * 1.6 }); }
  }
  // pinos: tronco + cono
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6); trunk.translate(0, 0.8, 0);
  const cone = new THREE.ConeGeometry(1.5, 4.5, 7); cone.translate(0, 3.6, 0);
  group.add(instanced(trunk, 0x4e342e, pines, { shadow: false }));
  group.add(instanced(cone, 0x2f5d3a, pines));
  // robles: tronco + copa esférica
  const oakTrunk = new THREE.CylinderGeometry(0.22, 0.35, 2.2, 6); oakTrunk.translate(0, 1.1, 0);
  const canopy = new THREE.IcosahedronGeometry(2.0, 1); canopy.translate(0, 3.4, 0);
  group.add(instanced(oakTrunk, 0x5d4037, oaks, { shadow: false }));
  group.add(instanced(canopy, 0x3f8f3a, oaks));
  // cactus
  const cactus = new THREE.CylinderGeometry(0.35, 0.4, 2.8, 7); cactus.translate(0, 1.4, 0);
  group.add(instanced(cactus, 0x6b8e23, cacti));
  // rocas
  const rock = new THREE.DodecahedronGeometry(1.0, 0); rock.translate(0, 0.5, 0);
  group.add(instanced(rock, 0x6d6d6d, rocks));
  group.add(instanced(rock, 0x3a3a3f, craterRocks));
  return group;
}

/** Cilindros translúcidos que marcan la frontera de cada reino. */
export function buildRealmBorders() {
  const group = new THREE.Group();
  group.name = 'borders';
  for (const id of REALM_IDS) {
    const c = REALM_CENTERS[id];
    const geo = new THREE.CylinderGeometry(REALM_ZONE_RADIUS, REALM_ZONE_RADIUS, 40, 128, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: REALMS[id].color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(c.x, 8, c.z);
    group.add(mesh);
  }
  return group;
}

/** Altar de reino: plataforma + obelisco luminoso en el punto de reaparición. */
export function buildAltars() {
  const group = new THREE.Group();
  for (const id of REALM_IDS) {
    const c = REALM_CENTERS[id];
    const y = terrainHeight(c.x, c.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 0.8, 24), new THREE.MeshLambertMaterial({ color: 0x9e9e9e }));
    base.position.set(c.x, y + 0.4, c.z); base.receiveShadow = true;
    const obelisk = new THREE.Mesh(new THREE.ConeGeometry(1.2, 9, 4), new THREE.MeshLambertMaterial({ color: REALMS[id].color, emissive: REALMS[id].color, emissiveIntensity: 0.5 }));
    obelisk.position.set(c.x, y + 5.2, c.z); obelisk.castShadow = true;
    const light = new THREE.PointLight(REALMS[id].color, 60, 60, 2);
    light.position.set(c.x, y + 6, c.z);
    group.add(base, obelisk, light);
  }
  return group;
}
