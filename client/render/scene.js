// client/render/scene.js
// Renderer, escena, luces, cielo, niebla por bioma y capa CSS2D para etiquetas.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildTerrainMesh, buildWater, buildProps, buildRealmBorders, buildAltars } from './terrain.js';
import { biomeWeights } from '/shared/worldmap.js';

const FOG_COLORS = {
  norheim: new THREE.Color(0xbfd8ea),
  pyrrhos: new THREE.Color(0xe8b98a),
  eldwyn: new THREE.Color(0xa9c9b0),
  crater: new THREE.Color(0x6e6a72),
};

export class GameScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc5e8);
    this.scene.fog = new THREE.Fog(0x9fc5e8, 140, 520);
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    // cielo con degradado
    const skyGeo = new THREE.SphereGeometry(1400, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d7ac9) }, horizon: { value: new THREE.Color(0x9fc5e8) } },
      vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vW; void main(){ float h = normalize(vW).y; float t = smoothstep(-0.05, 0.5, h); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    this.terrain = buildTerrainMesh();
    this.scene.add(this.terrain);
    this.scene.add(buildWater());
    this.scene.add(buildProps());
    this.scene.add(buildRealmBorders());
    this.scene.add(buildAltars());

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._fogTarget = new THREE.Color();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  /** Sol y niebla siguen al jugador; el color de la niebla depende del bioma. */
  follow(x, z, dt) {
    this.sun.position.set(x + 90, 150, z + 60);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(x, 0, z);
    const w = biomeWeights(x, z);
    this._fogTarget.setRGB(0, 0, 0);
    for (const k of Object.keys(FOG_COLORS)) {
      this._fogTarget.r += FOG_COLORS[k].r * w[k]; this._fogTarget.g += FOG_COLORS[k].g * w[k]; this._fogTarget.b += FOG_COLORS[k].b * w[k];
    }
    this.scene.fog.color.lerp(this._fogTarget, Math.min(1, dt * 0.8));
    this.scene.background.copy(this.scene.fog.color);
    this.sky.material.uniforms.horizon.value.copy(this.scene.fog.color);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
