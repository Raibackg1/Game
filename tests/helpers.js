// tests/helpers.js
import WebSocket from 'ws';
import { createServer } from '../server/index.js';

/** Arranca un servidor real en puerto efímero con BD en memoria. */
export async function startTestServer(opts = {}) {
  const server = createServer({ dbPath: ':memory:', rng: opts.rng });
  const addr = await server.listen(0, '127.0.0.1');
  return { server, port: addr.port, url: `ws://127.0.0.1:${addr.port}/ws`, http: `http://127.0.0.1:${addr.port}` };
}

/** Cliente WS de prueba con cola de mensajes y espera por tipo. */
export class TestClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.all = [];
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.all.push(m);
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) { const w = this.waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }
      else this.queue.push(m);
    });
    this.opened = new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  /** Espera el próximo mensaje que cumpla pred (busca primero en la cola). */
  waitFor(pred, timeoutMs = 4000, label = 'mensaje') {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timeout esperando ${label}. Últimos: ${JSON.stringify(this.all.slice(-5)).slice(0, 600)}`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }
  waitType(t, timeoutMs, extra = () => true) { return this.waitFor((m) => m.t === t && extra(m), timeoutMs, `t=${t}`); }
  clear() { this.queue.length = 0; }
  close() { this.ws.close(); }
}

export async function registerAndEnter(url, { username, password = 'contraseña-segura-1', name, realm, race, cls }) {
  const c = new TestClient(url);
  await c.opened;
  c.send({ t: 'register', username, password });
  const auth = await c.waitType('auth');
  if (!auth.ok) throw new Error('auth falló: ' + JSON.stringify(auth));
  c.send({ t: 'create_char', name, realm, race, cls });
  const chars = await c.waitType('chars');
  const charId = chars.created;
  c.send({ t: 'enter', charId });
  const welcome = await c.waitType('welcome');
  return { client: c, auth, charId, welcome };
}
