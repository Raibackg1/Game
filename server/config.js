// server/config.js
// Toda la configuración viene de variables de entorno con valores por defecto de desarrollo.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function intEnv(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Variable de entorno ${name} debe ser un entero, recibido: "${v}"`);
  return n;
}

export const CONFIG = Object.freeze({
  PORT: intEnv('PORT', 8080),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'game.db'),
  SESSION_TTL_SECONDS: intEnv('SESSION_TTL_SECONDS', 7 * 24 * 3600),
  MAX_CHARACTERS_PER_ACCOUNT: intEnv('MAX_CHARACTERS_PER_ACCOUNT', 6),
  SAVE_INTERVAL_SECONDS: intEnv('SAVE_INTERVAL_SECONDS', 30),
  MAX_CONNECTIONS: intEnv('MAX_CONNECTIONS', 500),
  MAX_MESSAGE_BYTES: intEnv('MAX_MESSAGE_BYTES', 4096),
  LOGIN_ATTEMPTS_PER_MINUTE: intEnv('LOGIN_ATTEMPTS_PER_MINUTE', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  CLIENT_DIR: path.join(ROOT_DIR, 'client'),
  SHARED_DIR: path.join(ROOT_DIR, 'shared'),
  THREE_DIR: path.join(ROOT_DIR, 'node_modules', 'three'),
});
