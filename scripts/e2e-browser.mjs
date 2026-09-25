// scripts/e2e-browser.mjs
// Prueba de navegador real: arranca el servidor, abre el cliente en Chromium headless,
// registra una cuenta, crea un personaje, entra al mundo, se mueve, ataca y captura pantallas.
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createServer } from '../server/index.js';

// Playwright no es dependencia del proyecto: se usa el instalado localmente o el global (npm root -g).
async function loadPlaywright() {
  try { return await import('playwright'); }
  catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const candidate = path.join(globalRoot, 'playwright', 'index.mjs');
    if (!fs.existsSync(candidate)) throw new Error('Playwright no encontrado. Instálalo con: npm i -g playwright && npx playwright install chromium');
    return await import(pathToFileURL(candidate).href);
  }
}
const { chromium } = await loadPlaywright();

const OUT = process.env.SCREENSHOT_DIR || path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const server = createServer({ dbPath: ':memory:' });
const addr = await server.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${addr.port}`;
console.log('Servidor de prueba en', base);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => consoleErrors.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => consoleErrors.push('[requestfailed] ' + r.url() + ' ' + r.failure()?.errorText));

let failed = false;
const step = async (name, fn) => {
  try { await fn(); console.log('✔', name); }
  catch (err) { failed = true; console.error('✘', name, '\n  ', err.message); await page.screenshot({ path: path.join(OUT, `fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
};

await step('carga la página de acceso', async () => {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#login-user', { timeout: 10000 });
  await page.waitForFunction(() => window.__game && window.__game.net.connected, null, { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, '01-login.png') });
});
const user = 'prueba' + Math.floor(Math.random() * 1e6);
await step('registra una cuenta', async () => {
  await page.fill('#login-user', user);
  await page.fill('#login-pass', 'contraseña-de-prueba');
  await page.click('#btn-register');
  await page.waitForSelector('#btn-new', { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, '02-personajes.png') });
});
await step('crea un personaje (Eldwyn · Elfo · Arquero)', async () => {
  await page.click('#btn-new');
  await page.waitForSelector('#realm-cards');
  await page.click('#realm-cards .card.realm-eldwyn');
  await page.waitForSelector('#race-cards .card');
  await page.click('#race-cards .card:nth-child(1)');
  await page.click('#class-cards .card:nth-child(2)');
  await page.fill('#char-name', 'Legolin' + String.fromCharCode(97 + Math.floor(Math.random() * 26)) + String.fromCharCode(97 + Math.floor(Math.random() * 26)));
  await page.screenshot({ path: path.join(OUT, '03-creacion.png') });
  await page.click('#btn-create');
  await page.waitForSelector('[data-enter]', { timeout: 10000 });
});
await step('entra al mundo y renderiza la escena 3D', async () => {
  await page.click('[data-enter]');
  await page.waitForFunction(() => window.__game.state.inWorld && window.__game.game && window.__game.game.entities.views.size > 1, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const g = window.__game.game;
    return { entities: g.entities.views.size, self: g.self.name, realm: g.self.realm, hp: g.self.hp, structures: window.__game.state.structures.size, drawCalls: g.scene.renderer.info.render.calls, triangles: g.scene.renderer.info.render.triangles };
  });
  console.log('   ', JSON.stringify(info));
  if (info.entities < 2) throw new Error('No hay entidades visibles');
  if (info.triangles < 1000) throw new Error('La escena no está renderizando triángulos: ' + info.triangles);
  await page.screenshot({ path: path.join(OUT, '04-mundo.png') });
});
await step('se mueve con el teclado y el servidor lo confirma', async () => {
  const before = await page.evaluate(() => { const p = window.__game.game.selfPos(); return [p.x, p.z]; });
  await page.mouse.click(640, 400); // foco en el lienzo
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const v = window.__game.game.entities.get(window.__game.game.selfId); return [v.next.x, v.next.z]; });
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
  console.log('    desplazamiento confirmado por el servidor:', moved.toFixed(2), 'unidades');
  if (moved < 3) throw new Error('El personaje no se movió (' + moved + ')');
});
await step('camina hasta el monstruo más cercano, lo selecciona con Tab y lo ataca', async () => {
  // localizar el hostil más cercano visible (los anillos de monstruos empiezan a ~80 u del altar)
  const nearestDist = () => page.evaluate(() => {
    const g = window.__game.game; const p = g.selfPos();
    const list = g.entities.hostilesSorted(170);
    if (!list.length) return null;
    const t = list[0];
    g.cam.yaw = Math.atan2(t.pos.x - p.x, t.pos.z - p.z); // cámara mirando al objetivo → W avanza hacia él
    return Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
  });
  let d = await nearestDist();
  if (d === null) throw new Error('No hay hostiles visibles cerca del altar');
  const t0 = Date.now();
  while (d > 18 && Date.now() - t0 < 40000) {
    await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
    await page.waitForTimeout(150);
    d = await nearestDist();
  }
  console.log('    distancia al monstruo más cercano:', d.toFixed(1));
  if (d > 18) throw new Error('No se pudo llegar hasta el monstruo');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const target = await page.evaluate(() => window.__game.game.entities.targetId);
  if (target == null) throw new Error('Tab no seleccionó objetivo');
  await page.keyboard.press('Digit1'); // Disparo Rápido (alcance 24)
  const got = await page.waitForFunction(() => [...document.querySelectorAll('#chat-log .ch-combat')].some((l) => /Tú →/.test(l.textContent)), null, { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '05-combate.png') });
  if (!got) throw new Error('No se registró daño propio en el chat de combate');
  const tf = await page.evaluate(() => document.getElementById('target-frame').classList.contains('hidden') ? null : document.getElementById('target-name').textContent);
  console.log('    objetivo en el marco:', tf);
});
await step('abre mapa del mundo y ayuda', async () => {
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-mapa.png') });
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '07-ayuda.png') });
  await page.keyboard.press('KeyH');
});
await step('escribe en el chat de reino', async () => {
  await page.keyboard.press('Enter');
  await page.keyboard.type('/r Saludos desde la prueba automática');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#chat-log .ch-realm')].some((l) => /Saludos desde/.test(l.textContent)), null, { timeout: 5000 });
});
await step('sale al menú y la posición queda guardada', async () => {
  await page.keyboard.press('KeyH');
  await page.click('#leave-btn');
  await page.waitForSelector('[data-enter]', { timeout: 10000 });
  const chars = server.db.getCharactersByAccount(server.db.getAccountByUsername(user).id);
  console.log('    personaje guardado en BD:', chars[0].name, 'pos', chars[0].x.toFixed(1), chars[0].z.toFixed(1), 'nivel', chars[0].level, 'xp', chars[0].xp);
});

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e));
if (realErrors.length) { failed = true; console.error('Errores de consola del navegador:\n' + realErrors.join('\n')); }
else console.log('✔ sin errores de consola en el navegador');
await browser.close();
await server.close();
console.log(failed ? 'RESULTADO: FALLOS' : 'RESULTADO: OK', '· capturas en', OUT);
process.exit(failed ? 1 : 0);
