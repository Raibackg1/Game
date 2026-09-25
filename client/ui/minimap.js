// client/ui/minimap.js
// Minimapa circular local y mapa del mundo completo.
import { REALMS, REALM_IDS, WORLD_HALF } from '/shared/constants.js';
import { REALM_CENTERS, REALM_ZONE_RADIUS, STRUCTURE_BY_ID, CRATER_RADIUS } from '/shared/worldmap.js';

export class Minimap {
  constructor(canvas, worldCanvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.wc = worldCanvas; this.wctx = worldCanvas.getContext('2d');
    this.radius = 110; // unidades de mundo visibles
  }

  drawLocal(self, views, structures, camYaw) {
    const ctx = this.ctx, W = this.c.width, H = this.c.height, cx = W / 2, cy = H / 2;
    const scale = (W / 2 - 4) / this.radius;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    // fondo por zona
    ctx.fillStyle = '#1a2230'; ctx.fillRect(0, 0, W, H);
    ctx.translate(cx, cy);
    ctx.rotate(-camYaw + Math.PI); // arriba = dirección de la cámara
    const toMap = (x, z) => [(x - self.x) * scale, -(z - self.z) * scale];
    // zonas de reino
    for (const id of REALM_IDS) {
      const c = REALM_CENTERS[id];
      const [mx, mz] = toMap(c.x, c.z);
      ctx.beginPath(); ctx.arc(mx, mz, REALM_ZONE_RADIUS * scale, 0, Math.PI * 2);
      ctx.fillStyle = REALMS[id].cssColor + '22'; ctx.fill();
      ctx.strokeStyle = REALMS[id].cssColor + '99'; ctx.lineWidth = 2; ctx.stroke();
    }
    // cráter
    { const [mx, mz] = toMap(0, 0); ctx.beginPath(); ctx.arc(mx, mz, CRATER_RADIUS * scale, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff33'; ctx.stroke(); }
    // estructuras
    for (const s of structures.values()) {
      const def = STRUCTURE_BY_ID[s.id]; if (!def) continue;
      const [mx, mz] = toMap(def.x, def.z);
      ctx.fillStyle = REALMS[s.owner]?.cssColor ?? '#fff';
      ctx.beginPath();
      if (def.kind === 'castle') { ctx.rect(mx - 6, mz - 6, 12, 12); } else { ctx.moveTo(mx, mz - 6); ctx.lineTo(mx + 6, mz + 5); ctx.lineTo(mx - 6, mz + 5); ctx.closePath(); }
      ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
    // entidades
    for (const v of views.values()) {
      const d = v.data; if (d.d) continue;
      const [mx, mz] = toMap(v.pos.x, v.pos.z);
      if (d.k === 'p') { ctx.fillStyle = REALMS[d.r]?.cssColor ?? '#fff'; ctx.beginPath(); ctx.arc(mx, mz, d.id === self.id ? 0 : 3, 0, Math.PI * 2); ctx.fill(); }
      else if (d.k === 'm') { ctx.fillStyle = d.r ? (REALMS[d.r]?.cssColor ?? '#ccc') : '#ef5350'; ctx.fillRect(mx - 1.5, mz - 1.5, 3, 3); }
    }
    ctx.restore();
    // jugador (flecha hacia arriba = cámara)
    ctx.save(); ctx.translate(cx, cy);
    ctx.rotate(-camYaw + Math.PI + self.yaw);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // borde
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 2; ctx.stroke();
  }

  drawWorld(self, structures, views) {
    const ctx = this.wctx, W = this.wc.width, H = this.wc.height;
    const scale = W / (WORLD_HALF * 2);
    const toMap = (x, z) => [(x + WORLD_HALF) * scale, (z + WORLD_HALF) * scale];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a2230'; ctx.fillRect(0, 0, W, H);
    for (const id of REALM_IDS) {
      const c = REALM_CENTERS[id]; const [mx, mz] = toMap(c.x, c.z);
      ctx.beginPath(); ctx.arc(mx, mz, REALM_ZONE_RADIUS * scale, 0, Math.PI * 2);
      ctx.fillStyle = REALMS[id].cssColor + '33'; ctx.fill(); ctx.strokeStyle = REALMS[id].cssColor; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = REALMS[id].cssColor; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(REALMS[id].name, mx, Math.max(18, mz - REALM_ZONE_RADIUS * scale - 6));
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText('altar', mx, mz + 14);
      ctx.beginPath(); ctx.arc(mx, mz, 4, 0, Math.PI * 2); ctx.fill();
    }
    { const [mx, mz] = toMap(0, 0); ctx.beginPath(); ctx.arc(mx, mz, CRATER_RADIUS * scale, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff55'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#ccc'; ctx.font = '12px sans-serif'; ctx.fillText('Cráter del Dragón', mx, mz + 4); }
    ctx.fillStyle = '#ffe082'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('ZONA DE GUERRA', W / 2, H / 2 - CRATER_RADIUS * scale - 40);
    for (const s of structures.values()) {
      const def = STRUCTURE_BY_ID[s.id]; if (!def) continue;
      const [mx, mz] = toMap(def.x, def.z);
      ctx.fillStyle = REALMS[s.owner]?.cssColor ?? '#fff';
      ctx.beginPath();
      if (def.kind === 'castle') ctx.rect(mx - 8, mz - 8, 16, 16); else { ctx.moveTo(mx, mz - 8); ctx.lineTo(mx + 8, mz + 7); ctx.lineTo(mx - 8, mz + 7); ctx.closePath(); }
      ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.fillText(def.name + (s.doorDestroyed ? ' 💥' : ''), mx, mz + 22);
    }
    for (const v of views.values()) {
      if (v.data.k !== 'p' || v.data.d) continue;
      const [mx, mz] = toMap(v.pos.x, v.pos.z);
      ctx.fillStyle = REALMS[v.data.r]?.cssColor ?? '#fff'; ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
    }
    const [px, pz] = toMap(self.x, self.z);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, pz, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillText('Tú', px, pz - 9);
  }
}
