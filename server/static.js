// server/static.js
// Servidor de ficheros estáticos mínimo: cliente, módulos compartidos y Three.js desde node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Prefijos de URL → directorios en disco. El orden importa. */
const MOUNTS = [
  { prefix: '/shared/', dir: CONFIG.SHARED_DIR },
  { prefix: '/vendor/three/', dir: CONFIG.THREE_DIR },
  { prefix: '/', dir: CONFIG.CLIENT_DIR },
];

function resolveSafe(baseDir, rel) {
  const target = path.resolve(baseDir, '.' + path.posix.normalize('/' + rel));
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return null; // path traversal
  return target;
}

export function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  for (const m of MOUNTS) {
    if (!urlPath.startsWith(m.prefix)) continue;
    const rel = urlPath.slice(m.prefix.length);
    const file = resolveSafe(m.dir, rel);
    if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': m.prefix === '/vendor/three/' ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', (err) => {
      console.error('static read error', file, err.message);
      res.destroy(err);
    }).pipe(res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado: ' + urlPath);
}
