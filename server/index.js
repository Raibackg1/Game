// server/index.js
// Arranque: HTTP (cliente estático + /api/status) y WebSocket (juego) en el mismo puerto.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config.js';
import { log } from './log.js';
import { GameDB } from './db.js';
import { World } from './world/world.js';
import { Session } from './net/session.js';
import { RateLimiter } from './auth.js';
import { serveStatic } from './static.js';
import { REALMS } from '../shared/constants.js';

export function createServer(options = {}) {
  const dbPath = options.dbPath ?? CONFIG.DB_PATH;
  const db = new GameDB(dbPath);
  const world = new World(db, { rng: options.rng });
  world.init();

  const sessions = new Set();
  const loginLimiter = new RateLimiter(CONFIG.LOGIN_ATTEMPTS_PER_MINUTE);

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/status') {
      const body = JSON.stringify({
        ok: true,
        online: world.players.size,
        uptimeSeconds: Math.floor((Date.now() - world.startedAt) / 1000),
        structures: world.structures.publicStates().map((s) => ({ id: s.id, name: s.name, owner: s.owner, doorDestroyed: s.doorDestroyed })),
        realms: Object.fromEntries(Object.keys(REALMS).map((r) => [r, { owned: world.structures.countOwned(r), online: [...world.players.values()].filter((p) => p.realm === r).length }])),
        population: db.realmPopulation(),
        tickMsAvg: +world.stats.tickMsAvg.toFixed(3),
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    if (url.pathname === '/api/leaderboard') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ top: db.leaderboard(20), captures: db.recentCaptures(20) }));
      return;
    }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: CONFIG.MAX_MESSAGE_BYTES });
  wss.on('connection', (ws, req) => {
    if (sessions.size >= CONFIG.MAX_CONNECTIONS) {
      ws.close(1013, 'Servidor lleno');
      return;
    }
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const session = new Session(ws, world, db, { ip, loginLimiter, sessions });
    sessions.add(session);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  // latido: cierra conexiones muertas
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* cerrado */ }
    }
    loginLimiter.sweep();
    db.purgeExpiredSessions();
  }, 30000);

  function listen(port = CONFIG.PORT, host = CONFIG.HOST) {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        world.start(CONFIG.SAVE_INTERVAL_SECONDS);
        const addr = httpServer.address();
        log.info(`Servidor escuchando en http://${host}:${addr.port}  (ws://${host}:${addr.port}/ws)`, { db: dbPath });
        resolve(addr);
      });
    });
  }

  async function close() {
    clearInterval(heartbeat);
    world.stop();
    world.saveAll();
    for (const s of sessions) s.close(1001, 'Servidor apagándose');
    await new Promise((r) => wss.close(() => r()));
    await new Promise((r) => httpServer.close(() => r()));
    db.close();
  }

  return { httpServer, wss, world, db, listen, close };
}

// Ejecución directa
const isMain = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isMain) {
  const server = createServer();
  server.listen().catch((err) => {
    log.error('No se pudo iniciar el servidor', { err: err.message });
    process.exit(1);
  });
  const shutdown = async (sig) => {
    log.info(`Señal ${sig}: guardando y cerrando...`);
    try { await server.close(); process.exit(0); }
    catch (err) { log.error('Error al cerrar', { err: err.message }); process.exit(1); }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => { log.error('uncaughtException', { err: err.stack || err.message }); });
  process.on('unhandledRejection', (err) => { log.error('unhandledRejection', { err: String(err && err.stack || err) }); });
}
