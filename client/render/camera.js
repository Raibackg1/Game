// client/render/camera.js
// Cámara orbital en tercera persona (estilo WoW): gira con el ratón, zoom con la rueda,
// no atraviesa el terreno.
import * as THREE from 'three';
import { terrainHeight } from '/shared/terrain.js';

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;      // detrás del personaje mirando hacia +z
    this.pitch = 0.32;
    this.dist = 11;
    this.minDist = 2.5; this.maxDist = 32;
    this.target = new THREE.Vector3();
    this.smoothPos = null;
  }
  rotate(dx, dy) {
    this.yaw -= dx * 0.0045;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0035, -0.15, 1.35);
  }
  zoom(steps) {
    this.dist = THREE.MathUtils.clamp(this.dist * Math.pow(1.15, steps), this.minDist, this.maxDist);
  }
  /** Dirección "adelante" de la cámara proyectada en el suelo (x,z), unitaria. */
  forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  right() { return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) }; }

  update(px, py, pz, dt) {
    this.target.set(px, py + 1.7, pz);
    const f = this.forward();
    const horiz = this.dist * Math.cos(this.pitch);
    const desired = new THREE.Vector3(
      this.target.x - f.x * horiz,
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z - f.z * horiz,
    );
    // no atravesar el terreno
    const ground = terrainHeight(desired.x, desired.z) + 0.6;
    if (desired.y < ground) desired.y = ground;
    if (!this.smoothPos) this.smoothPos = desired.clone();
    else this.smoothPos.lerp(desired, Math.min(1, dt * 14));
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.target);
  }
}
