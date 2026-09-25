// client/render/structures.js
// Fuertes y castillos: murallas, torres, torreón, bandera coloreada por el reino dueño.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { terrainHeight } from '/shared/terrain.js';
import { STRUCTURE_BY_ID } from '/shared/worldmap.js';
import { REALMS } from '/shared/constants.js';

const stoneMat = new THREE.MeshLambertMaterial({ color: 0x7c7c84 });
const darkStoneMat = new THREE.MeshLambertMaterial({ color: 0x5c5c66 });
const woodMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });

export class StructureViews {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
  }

  build(states) {
    for (const st of states) this._create(st);
  }

  _create(st) {
    const def = STRUCTURE_BY_ID[st.id];
    if (!def) { console.error('Estructura desconocida del servidor:', st.id); return; }
    const y = terrainHeight(def.x, def.z);
    const g = new THREE.Group();
    g.position.set(def.x, y, def.z);
    const r = def.radius, h = def.wallHeight;
    const isCastle = def.kind === 'castle';

    // plataforma
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r + 3, r + 4.5, 1.2, 32), darkStoneMat);
    base.position.y = 0.3; base.receiveShadow = true; g.add(base);

    // murallas en segmentos, con hueco para la puerta
    const segs = isCastle ? 16 : 12;
    const gapHalf = Math.asin(3.4 / r); // medio ángulo del hueco
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
      // ángulo de la puerta en la convención (sin, cos)
      let d = Math.atan2(Math.sin(am), Math.cos(am)) - def.doorAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < gapHalf + Math.PI / segs * 0.6) continue;
      const len = 2 * r * Math.sin(Math.PI / segs) + 0.3;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, h, 1.4), stoneMat);
      wall.position.set(Math.sin(am) * r, h / 2 + 0.8, Math.cos(am) * r);
      wall.rotation.y = am;
      wall.castShadow = true; wall.receiveShadow = true;
      g.add(wall);
      // almenas
      const crenel = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.8, 1.6), darkStoneMat);
      crenel.position.set(Math.sin(am) * r, h + 1.2, Math.cos(am) * r); crenel.rotation.y = am;
      g.add(crenel);
    }
    // pilares de la puerta
    for (const side of [-1, 1]) {
      const a = def.doorAngle + side * gapHalf * 1.15;
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, h + 2, 1.8), darkStoneMat);
      p.position.set(Math.sin(a) * r, (h + 2) / 2 + 0.8, Math.cos(a) * r);
      p.castShadow = true; g.add(p);
    }
    // torres
    const towers = isCastle ? 6 : 4;
    const roofs = [];
    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2 + Math.PI / towers;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, h + 4, 10), stoneMat);
      t.position.set(Math.sin(a) * r, (h + 4) / 2 + 0.8, Math.cos(a) * r);
      t.castShadow = true; g.add(t);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 3.2, 10), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      roof.position.set(Math.sin(a) * r, h + 4 + 0.8 + 1.6, Math.cos(a) * r);
      roof.castShadow = true; g.add(roof); roofs.push(roof);
    }
    // torreón (castillo)
    if (isCastle) {
      const kx = -Math.sin(def.doorAngle) * r * 0.45, kz = -Math.cos(def.doorAngle) * r * 0.45;
      const keep = new THREE.Mesh(new THREE.BoxGeometry(11, h + 7, 11), stoneMat);
      keep.position.set(kx, (h + 7) / 2 + 0.8, kz); keep.castShadow = true; keep.receiveShadow = true; g.add(keep);
      const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(8.5, 5, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      keepRoof.position.set(kx, h + 7 + 0.8 + 2.5, kz); keepRoof.rotation.y = Math.PI / 4; g.add(keepRoof); roofs.push(keepRoof);
    }
    // bandera central
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 11, 8), woodMat);
    pole.position.y = 5.5 + 0.8; g.add(pole);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissive: 0x000000 });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4, 6, 1), flagMat);
    flag.position.set(2, 10.3, 0); flag.castShadow = true;
    g.add(flag);
    // círculo de captura en el suelo
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4, 32), new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.95; g.add(ring);
    // etiqueta
    const el = document.createElement('div');
    el.className = 'nameplate';
    el.innerHTML = `<div class="np-name"></div><div class="np-title"></div>`;
    const label = new CSS2DObject(el);
    label.position.set(0, 13.5, 0);
    g.add(label);

    this.scene.add(g);
    const view = { id: st.id, def, group: g, flag, flagMat, roofs, label, el, state: st, ring };
    this.views.set(st.id, view);
    this.update(st);
  }

  update(st) {
    const v = this.views.get(st.id);
    if (!v) { this._create(st); return; }
    v.state = st;
    const color = REALMS[st.owner]?.color ?? 0xffffff;
    v.flagMat.color.setHex(color);
    for (const r of v.roofs) r.material.color.setHex(color);
    v.el.querySelector('.np-name').textContent = st.name;
    v.el.querySelector('.np-name').style.color = REALMS[st.owner]?.cssColor ?? '#fff';
    const door = st.doorDestroyed ? '🚪💥 puerta destruida' : `🚪 ${Math.round(st.doorHp / st.doorMaxHp * 100)}%`;
    const cap = st.capture ? ` · ⚔️ ${st.capture.playerName} capturando` : '';
    v.el.querySelector('.np-title').textContent = `${REALMS[st.owner]?.name ?? '?'} · ${door}${cap}`;
    v.ring.material.color.setHex(st.doorDestroyed ? 0xff5252 : 0xffd54f);
  }

  animate(t, serverNow) {
    for (const v of this.views.values()) {
      // ondeo simple de la bandera
      const pos = v.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(t * 3 + x * 1.5) * 0.12 * (x + 2) / 4);
      }
      pos.needsUpdate = true;
      // captura en curso → bandera parpadea
      if (v.state.capture) {
        const p = (serverNow - v.state.capture.startedAt) / (v.state.capture.endsAt - v.state.capture.startedAt);
        v.flagMat.emissive.setHex(0xffd54f).multiplyScalar(0.3 + 0.3 * Math.sin(t * 8));
        v.ring.material.opacity = 0.35 + 0.4 * Math.max(0, Math.min(1, p));
      } else {
        v.flagMat.emissive.setHex(0x000000);
        v.ring.material.opacity = 0.35;
      }
    }
  }

  /** Estructura cuya bandera está a menos de `range` del punto, o null. */
  nearest(x, z, range) {
    let best = null, bd = range;
    for (const v of this.views.values()) {
      const d = Math.hypot(v.def.x - x, v.def.z - z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
}
