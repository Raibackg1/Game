// client/render/entities.js
// Vistas 3D de entidades: modelos por clase/raza/monstruo, interpolación de snapshots,
// animación básica, placas de nombre (CSS2D), anillo de selección y texto flotante de combate.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { terrainHeight } from '/shared/terrain.js';
import { REALMS, RACES, CLASSES, MOB_TYPES, baseClassOf, SKILLS } from '/shared/constants.js';
import { STRUCTURE_BY_ID } from '/shared/worldmap.js';

const INTERP_DELAY_MS = 120;
const MAX_EXTRAPOLATE_MS = 250;

const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0b89a });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2b });
const metalMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
const woodMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
const glowMat = new THREE.MeshLambertMaterial({ color: 0x7c4dff, emissive: 0x7c4dff, emissiveIntensity: 0.8 });
const doorWoodMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
const brokenMat = new THREE.MeshLambertMaterial({ color: 0x2a211d });
const materialCache = new Map();
function colorMat(hex) {
  if (!materialCache.has(hex)) materialCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return materialCache.get(hex);
}
function box(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; return m; }
function sphere(r, mat, seg = 10) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat); m.castShadow = true; return m; }

/** Modelo humanoide (jugadores y guardias). */
function buildHumanoid({ color, cls, scale = 1, bulky = false }) {
  const g = new THREE.Group();
  const armor = colorMat(color);
  const parts = {};
  const legH = 0.8, torsoH = 0.8;
  parts.leftLeg = box(0.26, legH, 0.26, darkMat); parts.leftLeg.position.set(-0.16, legH / 2, 0);
  parts.rightLeg = box(0.26, legH, 0.26, darkMat); parts.rightLeg.position.set(0.16, legH / 2, 0);
  // pivote de piernas en la cadera
  for (const k of ['leftLeg', 'rightLeg']) { parts[k].geometry.translate(0, -legH / 2, 0); parts[k].position.y = legH; }
  parts.torso = box(bulky ? 0.8 : 0.62, torsoH, 0.36, armor); parts.torso.position.y = legH + torsoH / 2;
  parts.head = sphere(0.23, skinMat); parts.head.position.y = legH + torsoH + 0.3;
  const armH = 0.7;
  parts.leftArm = box(0.2, armH, 0.2, armor); parts.leftArm.geometry.translate(0, -armH / 2, 0); parts.leftArm.position.set(-(bulky ? 0.52 : 0.43), legH + torsoH - 0.05, 0);
  parts.rightArm = box(0.2, armH, 0.2, armor); parts.rightArm.geometry.translate(0, -armH / 2, 0); parts.rightArm.position.set(bulky ? 0.52 : 0.43, legH + torsoH - 0.05, 0);
  // arma según clase base
  const base = cls ? baseClassOf(cls) : null;
  let weapon = null;
  if (base === 'guerrero' || !base) {
    weapon = box(0.08, 1.1, 0.16, metalMat); weapon.position.set(0, -armH - 0.2, 0.1);
    const hilt = box(0.3, 0.08, 0.08, woodMat); hilt.position.y = 0.4; weapon.add(hilt);
  } else if (base === 'arquero') {
    weapon = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 14, Math.PI), woodMat);
    weapon.rotation.z = Math.PI / 2; weapon.position.set(0, -armH + 0.1, 0.25);
  } else if (base === 'mago') {
    weapon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), woodMat); weapon.position.set(0, -armH + 0.3, 0.15);
    const orb = sphere(0.14, glowMat, 8); orb.position.y = 0.9; weapon.add(orb);
  }
  if (weapon) { weapon.castShadow = true; parts.rightArm.add(weapon); parts.weapon = weapon; }
  for (const p of Object.values(parts)) if (p !== parts.weapon) g.add(p);
  g.scale.setScalar(scale);
  return { group: g, parts, height: (legH + torsoH + 0.55) * scale };
}

/** Modelos de monstruos según forma. */
function buildMob(type, level) {
  const g = new THREE.Group();
  const mat = colorMat(type.color);
  const parts = {};
  const s = type.scale;
  if (type.shape === 'quadruped') {
    parts.body = box(1.3, 0.6, 0.55, mat); parts.body.position.y = 0.75;
    parts.head = box(0.45, 0.4, 0.4, mat); parts.head.position.set(0, 0.95, 0.75);
    const legs = ['fl', 'fr', 'bl', 'br'];
    legs.forEach((k, i) => {
      const l = box(0.18, 0.5, 0.18, darkMat); l.geometry.translate(0, -0.25, 0);
      l.position.set(i % 2 ? 0.22 : -0.22, 0.5, i < 2 ? 0.45 : -0.45);
      parts[k] = l;
    });
    parts.leftLeg = parts.fl; parts.rightLeg = parts.br;
    parts.tail = box(0.1, 0.1, 0.6, mat); parts.tail.position.set(0, 0.85, -0.9);
    g.rotation.y = 0;
  } else if (type.shape === 'spider') {
    parts.body = sphere(0.45, mat, 8); parts.body.position.y = 0.55;
    parts.abd = sphere(0.55, mat, 8); parts.abd.position.set(0, 0.6, -0.7);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, idx = i % 4;
      const l = box(0.9, 0.06, 0.06, darkMat); l.geometry.translate(0.45, 0, 0);
      l.position.set(side * 0.3, 0.55, 0.4 - idx * 0.3);
      l.rotation.set(0, side > 0 ? 0 : Math.PI, side * 0.35);
      parts['leg' + i] = l;
    }
    parts.leftLeg = parts.leg0; parts.rightLeg = parts.leg5;
  } else if (type.shape === 'dragon') {
    parts.body = box(1.4, 0.9, 2.6, mat); parts.body.position.y = 1.4;
    parts.neck = box(0.5, 0.5, 1.2, mat); parts.neck.position.set(0, 2.1, 1.6); parts.neck.rotation.x = -0.6;
    parts.head = box(0.6, 0.5, 0.9, mat); parts.head.position.set(0, 2.6, 2.3);
    parts.tail = box(0.4, 0.4, 2.2, mat); parts.tail.position.set(0, 1.3, -2.2);
    parts.leftWing = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), new THREE.MeshLambertMaterial({ color: type.color, side: THREE.DoubleSide }));
    parts.leftWing.geometry.translate(-1.5, 0, 0); parts.leftWing.position.set(-0.7, 1.9, 0); parts.leftWing.rotation.x = -Math.PI / 2;
    parts.rightWing = parts.leftWing.clone(); parts.rightWing.geometry = parts.leftWing.geometry.clone(); parts.rightWing.geometry.translate(3, 0, 0); parts.rightWing.position.set(0.7, 1.9, 0);
    const legs = ['fl', 'fr', 'bl', 'br'];
    legs.forEach((k, i) => { const l = box(0.3, 1.0, 0.3, darkMat); l.geometry.translate(0, -0.5, 0); l.position.set(i % 2 ? 0.55 : -0.55, 1.0, i < 2 ? 0.8 : -0.8); parts[k] = l; });
    parts.leftLeg = parts.fl; parts.rightLeg = parts.br;
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffeb3b, emissive: 0xffeb3b });
    const e1 = sphere(0.08, eyeMat, 6); e1.position.set(-0.2, 2.75, 2.7); const e2 = e1.clone(); e2.position.x = 0.2;
    g.add(e1, e2);
  } else { // humanoide
    const h = buildHumanoid({ color: type.color, cls: null, scale: 1, bulky: true });
    Object.assign(parts, h.parts);
    // garrote
    if (parts.weapon) { parts.rightArm.remove(parts.weapon); }
    const club = box(0.16, 0.9, 0.16, woodMat); club.position.set(0, -0.85, 0.1); parts.rightArm.add(club); parts.weapon = club;
    g.add(...h.group.children);
  }
  for (const [k, p] of Object.entries(parts)) if (p.parent == null) g.add(p);
  g.scale.setScalar(s);
  const height = (type.shape === 'dragon' ? 3.2 : type.shape === 'quadruped' ? 1.3 : type.shape === 'spider' ? 1.1 : 2.2) * s;
  return { group: g, parts, height };
}

function buildDoor(structureId) {
  const def = STRUCTURE_BY_ID[structureId];
  const h = def ? def.wallHeight : 6;
  const g = new THREE.Group();
  const door = box(6.4, h, 0.9, doorWoodMat); door.position.y = h / 2 + 0.8; g.add(door);
  for (const yy of [0.3, 0.6]) { const band = box(6.5, 0.25, 1.0, metalMat); band.position.y = 0.8 + h * yy; g.add(band); }
  const rubble = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + (i % 3) * 0.25, 0), brokenMat);
    r.position.set(-2.4 + i * 0.8, 0.4 + (i % 2) * 0.3, (i % 3 - 1) * 0.6); rubble.add(r);
  }
  rubble.visible = false; g.add(rubble);
  return { group: g, parts: { door, rubble }, height: h + 1 };
}

function levelColor(targetLevel, myLevel) {
  const d = targetLevel - myLevel;
  if (d >= 5) return '#ff5252';
  if (d >= 2) return '#ffab40';
  if (d >= -2) return '#ffee58';
  if (d >= -7) return '#69f0ae';
  return '#9e9e9e';
}

export class EntityManager {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
    this.selfId = null;
    this.myRealm = null;
    this.myLevel = 1;
    this.targetId = null;
    this.floaters = [];
    this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0xff5252, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 2;
    scene.add(this.selectionRing);
    this.raycaster = new THREE.Raycaster();
    this._pickList = [];
    // predicción local del propio jugador
    this.selfPredicted = null;
    this.lastServerTs = 0;
  }

  setSelf(id, realm, level) { this.selfId = id; this.myRealm = realm; this.myLevel = level; }

  clear() {
    for (const v of this.views.values()) this._dispose(v);
    this.views.clear();
    for (const f of this.floaters) this.scene.remove(f.obj);
    this.floaters = [];
    this.selfPredicted = null;
  }

  isHostile(d) {
    if (d.k === 'p') return d.r !== this.myRealm;
    if (d.k === 'd' || (d.k === 'm' && d.r)) return d.r !== this.myRealm;
    return true;
  }

  _createView(d) {
    let model, name, title = '';
    if (d.k === 'p') {
      const race = RACES[d.ra];
      model = buildHumanoid({ color: REALMS[d.r]?.color ?? 0xffffff, cls: d.c, scale: race ? race.scale : 1 });
      name = d.n; title = `${CLASSES[d.c]?.name ?? d.c} de ${REALMS[d.r]?.name ?? '?'}`;
    } else if (d.k === 'm') {
      const type = MOB_TYPES[d.t];
      if (!type) { console.error('Tipo de monstruo desconocido:', d.t); return null; }
      if (type.guard) {
        model = buildHumanoid({ color: REALMS[d.r]?.color ?? 0x9e9e9e, cls: 'guerrero', scale: type.scale, bulky: true });
        name = `${type.name}`; title = `Guardia de ${REALMS[d.r]?.name ?? '?'}`;
      } else {
        model = buildMob(type, d.lv);
        name = type.name; title = type.elite ? '★ Élite' : '';
      }
    } else if (d.k === 'd') {
      model = buildDoor(d.s);
      const def = STRUCTURE_BY_ID[d.s];
      name = def ? `Puerta de ${def.name}` : 'Puerta'; title = `${REALMS[d.r]?.name ?? '?'}`;
    } else {
      console.error('Clase de entidad desconocida:', d.k); return null;
    }
    const g = model.group;
    g.userData.entityId = d.id;
    g.traverse((o) => { o.userData.entityId = d.id; });
    // placa
    const el = document.createElement('div');
    el.className = 'nameplate';
    el.innerHTML = `<div class="np-name"></div><div class="np-title"></div><div class="np-bar"><div class="fill"></div></div><div class="np-cast hidden"><div class="fill"></div></div>`;
    const label = new CSS2DObject(el);
    label.position.set(0, model.height + 0.35, 0);
    g.add(label);
    this.scene.add(g);
    const v = {
      id: d.id, data: d, group: g, parts: model.parts, height: model.height, label, el,
      nameEl: el.querySelector('.np-name'), titleEl: el.querySelector('.np-title'),
      hpFill: el.querySelector('.np-bar .fill'), castEl: el.querySelector('.np-cast'), castFill: el.querySelector('.np-cast .fill'),
      prev: null, next: null, pos: new THREE.Vector3(d.x, terrainHeight(d.x, d.z), d.z), yaw: d.yaw,
      animPhase: 0, speed: 0, attackUntil: 0, deadT: 0, casting: null, lastPos: new THREE.Vector3(d.x, 0, d.z),
    };
    v.nameEl.textContent = name; v.titleEl.textContent = title;
    if (d.k === 'p') v.nameEl.style.color = REALMS[d.r]?.cssColor ?? '#fff';
    return v;
  }

  _dispose(v) {
    v.group.remove(v.label);
    v.el.remove();
    this.scene.remove(v.group);
    v.group.traverse((o) => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose?.(); });
  }

  applySnapshot(snap) {
    this.lastServerTs = snap.ts;
    for (const d of snap.ents) {
      let v = this.views.get(d.id);
      if (!v) { v = this._createView(d); if (!v) continue; this.views.set(d.id, v); }
      const wasDead = v.data.d;
      v.data = d;
      v.prev = v.next || { x: d.x, z: d.z, yaw: d.yaw, t: snap.ts - 100 };
      v.next = { x: d.x, z: d.z, yaw: d.yaw, t: snap.ts };
      // teleport (reaparición): saltar interpolación
      if (Math.hypot(v.prev.x - d.x, v.prev.z - d.z) > 40) { v.prev = { ...v.next }; v.pos.set(d.x, terrainHeight(d.x, d.z), d.z); if (d.id === this.selfId) this.selfPredicted = null; }
      if (d.k === 'p' && d.cast) v.casting = d.cast; else if (d.k === 'p') v.casting = null;
      if (wasDead && !d.d) { v.deadT = 0; }
      this._refreshPlate(v);
    }
    for (const id of snap.gone) {
      const v = this.views.get(id);
      if (v) { this._dispose(v); this.views.delete(id); }
      if (this.targetId === id) this.targetId = null;
    }
    if (this.targetId !== null && !this.views.has(this.targetId)) this.targetId = null;
  }

  _refreshPlate(v) {
    const d = v.data;
    const pct = d.mhp > 0 ? Math.max(0, Math.min(1, d.hp / d.mhp)) : 0;
    v.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    const hostile = this.isHostile(d);
    v.hpFill.style.background = d.id === this.selfId ? '#43a047' : hostile ? '#e53935' : '#42a5f5';
    if (d.k === 'm') v.nameEl.style.color = levelColor(d.lv, this.myLevel);
    if (d.k === 'd') v.nameEl.style.color = hostile ? '#ff8a80' : '#a5d6a7';
    v.el.classList.toggle('target', d.id === this.targetId);
    if (d.k === 'd') {
      v.parts.door.visible = !d.d; v.parts.rubble.visible = !!d.d;
      const s = 0.3 + 0.7 * pct; v.parts.door.scale.y = Math.max(0.3, s); v.parts.door.position.y = 0.8 + (v.parts.door.geometry.parameters.height * v.parts.door.scale.y) / 2;
    }
  }

  /** Posición interpolada actual de una entidad (Vector3) o null. */
  positionOf(id) { const v = this.views.get(id); return v ? v.pos : null; }
  get(id) { return this.views.get(id) || null; }

  setTarget(id) {
    const old = this.targetId;
    this.targetId = id;
    for (const i of [old, id]) { const v = i != null ? this.views.get(i) : null; if (v) v.el.classList.toggle('target', v.id === id); }
  }

  /** Enemigos atacables ordenados por distancia al jugador. */
  hostilesSorted(maxDist = 60) {
    const me = this.views.get(this.selfId);
    if (!me) return [];
    const out = [];
    for (const v of this.views.values()) {
      if (v.id === this.selfId || v.data.d) continue;
      if (!this.isHostile(v.data)) continue;
      const d = v.pos.distanceTo(me.pos);
      if (d <= maxDist) out.push({ v, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.v);
  }

  /** Selección por clic: devuelve id de entidad o null. */
  pick(ndcX, ndcY, camera) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    this._pickList.length = 0;
    for (const v of this.views.values()) if (v.id !== this.selfId) this._pickList.push(v.group);
    const hits = this.raycaster.intersectObjects(this._pickList, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.entityId === undefined) o = o.parent;
      if (o) return o.userData.entityId;
    }
    return null;
  }

  /** Movimiento local del propio jugador (predicción) → devuelve posición predicha. */
  predictSelf(mx, mz, speed, dt) {
    const me = this.views.get(this.selfId);
    if (!me) return null;
    if (!this.selfPredicted) this.selfPredicted = me.pos.clone();
    if (mx || mz) { this.selfPredicted.x += mx * speed * dt; this.selfPredicted.z += mz * speed * dt; }
    return this.selfPredicted;
  }

  update(dt, serverNow, clock) {
    const renderT = serverNow - INTERP_DELAY_MS;
    for (const v of this.views.values()) {
      const d = v.data;
      if (v.prev && v.next) {
        const span = Math.max(1, v.next.t - v.prev.t);
        let a = (renderT - v.prev.t) / span;
        if (a > 1) a = Math.min(a, 1 + MAX_EXTRAPOLATE_MS / span);
        if (a < 0) a = 0;
        const x = v.prev.x + (v.next.x - v.prev.x) * a, z = v.prev.z + (v.next.z - v.prev.z) * a;
        v.pos.set(x, 0, z);
        // yaw: interpolación angular corta
        let dy = v.next.yaw - v.prev.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.yaw = v.prev.yaw + dy * Math.min(1, a);
      }
      if (v.id === this.selfId && this.selfPredicted) {
        // reconciliación suave con el servidor
        const err = Math.hypot(this.selfPredicted.x - v.pos.x, this.selfPredicted.z - v.pos.z);
        if (err > 4) this.selfPredicted.copy(v.pos);
        else this.selfPredicted.lerp(new THREE.Vector3(v.pos.x, 0, v.pos.z), Math.min(1, dt * 3));
        v.pos.x = this.selfPredicted.x; v.pos.z = this.selfPredicted.z;
      }
      v.pos.y = terrainHeight(v.pos.x, v.pos.z);
      v.speed = v.lastPos.distanceTo(new THREE.Vector3(v.pos.x, 0, v.pos.z)) / Math.max(dt, 1e-3);
      v.lastPos.set(v.pos.x, 0, v.pos.z);
      v.group.position.copy(v.pos);
      if (d.k !== 'd') v.group.rotation.y = v.yaw;
      this._animate(v, dt, clock);
      // placas: ocultar lejanas
      const me = this.views.get(this.selfId);
      const far = me && me !== v ? v.pos.distanceTo(me.pos) > 75 : false;
      v.label.visible = v.id === this.targetId || (!far && v.id !== this.selfId);
      if (v.id === this.selfId) v.label.visible = false;
      if (v.casting) {
        v.castEl.classList.remove('hidden');
        const s = SKILLS[v.casting.s];
        const total = s ? s.castTime * 1000 : 1000;
        const p = 1 - Math.max(0, v.casting.e - serverNow) / total;
        v.castFill.style.width = (Math.min(1, p) * 100).toFixed(0) + '%';
      } else v.castEl.classList.add('hidden');
    }
    // anillo de selección
    const t = this.targetId != null ? this.views.get(this.targetId) : null;
    if (t) {
      this.selectionRing.visible = true;
      this.selectionRing.position.set(t.pos.x, t.pos.y + 0.08, t.pos.z);
      const sc = t.data.k === 'd' ? 4 : (t.data.k === 'm' ? (MOB_TYPES[t.data.t]?.scale ?? 1) : 1);
      this.selectionRing.scale.setScalar(sc);
      this.selectionRing.material.color.setHex(this.isHostile(t.data) ? 0xff5252 : 0x69f0ae);
    } else this.selectionRing.visible = false;
    // texto flotante
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.obj.position.y += dt * 1.6;
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.age - 0.5) / 0.7));
      if (f.age > 1.3) { this.scene.remove(f.obj); f.el.remove(); this.floaters.splice(i, 1); }
    }
  }

  _animate(v, dt, clock) {
    const p = v.parts;
    const d = v.data;
    // muerte: tumbar y hundir
    if (d.d) {
      v.deadT = Math.min(1, v.deadT + dt * 2);
      v.group.rotation.x = -Math.PI / 2 * v.deadT;
      v.group.position.y -= 0.3 * v.deadT;
      return;
    }
    v.group.rotation.x = 0;
    const moving = v.speed > 0.6;
    if (moving) v.animPhase += dt * Math.min(14, 6 + v.speed);
    const swing = moving ? Math.sin(v.animPhase) * 0.6 : 0;
    if (p.leftLeg && p.rightLeg) { p.leftLeg.rotation.x = swing; p.rightLeg.rotation.x = -swing; }
    if (d.k === 'm' && p.fr && p.bl) { p.fr.rotation.x = -swing; p.bl.rotation.x = swing; }
    if (p.leftArm && p.rightArm) {
      const attacking = clock < v.attackUntil;
      const castingArms = v.casting ? -2.2 : 0;
      p.leftArm.rotation.x = castingArms || -swing * 0.7;
      p.rightArm.rotation.x = attacking ? -1.8 + Math.sin((v.attackUntil - clock) * 30) * 0.5 : (castingArms || swing * 0.7);
    }
    if (p.leftWing && p.rightWing) {
      const flap = Math.sin(clock * 5) * 0.5;
      p.leftWing.rotation.z = flap; p.rightWing.rotation.z = -flap;
      v.group.position.y += 1.2 + Math.sin(clock * 2) * 0.3;
    }
    if (d.k === 'm' && MOB_TYPES[d.t]?.shape === 'spider') {
      for (let i = 0; i < 8; i++) if (p['leg' + i]) p['leg' + i].rotation.y = (i < 4 ? Math.PI : 0) + (moving ? Math.sin(v.animPhase + i) * 0.25 : 0);
    }
    if (p.tail) p.tail.rotation.y = Math.sin(clock * 3) * 0.3;
  }

  /** Texto flotante sobre una entidad. */
  floatText(entityId, text, cls, offsetY = 0) {
    const v = this.views.get(entityId);
    if (!v) return;
    const el = document.createElement('div');
    el.className = 'float-text ' + cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(v.pos.x + (Math.random() - 0.5) * 0.8, v.pos.y + v.height * 0.8 + offsetY, v.pos.z);
    this.scene.add(obj);
    this.floaters.push({ obj, el, age: 0 });
  }

  /** Reacciona a eventos de combate del servidor. */
  onEvent(ev, clock) {
    switch (ev.e) {
      case 'damage': {
        const src = this.views.get(ev.src);
        if (src) src.attackUntil = clock + 0.35;
        const mine = ev.src === this.selfId, onMe = ev.dst === this.selfId;
        this.floatText(ev.dst, (ev.crit ? '💥 ' : '') + ev.amt, (ev.crit ? 'crit ' : '') + (onMe ? 'dmg-in' : mine ? 'dmg-out' : 'miss'));
        const dst = this.views.get(ev.dst);
        if (dst) { dst.data.hp = Math.max(0, dst.data.hp - ev.amt); this._refreshPlate(dst); }
        break;
      }
      case 'heal': {
        this.floatText(ev.dst, '+' + ev.amt, 'heal');
        break;
      }
      case 'cast_start': { const v = this.views.get(ev.src); if (v) v.casting = { s: ev.skill, e: ev.endsAt }; break; }
      case 'cast_end': { const v = this.views.get(ev.src); if (v) { v.casting = null; if (!ev.cancelled) v.attackUntil = clock + 0.4; } break; }
      case 'death': { const v = this.views.get(ev.id); if (v) { v.data.d = 1; v.data.hp = 0; v.casting = null; this._refreshPlate(v); } break; }
      case 'respawn': { const v = this.views.get(ev.id); if (v) { v.data.d = 0; v.deadT = 0; } break; }
      case 'level_up': { this.floatText(ev.id, '¡NIVEL ' + ev.level + '!', 'xp', 0.6); break; }
      default: break;
    }
  }
}
