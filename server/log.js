// server/log.js
import { CONFIG } from './config.js';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[CONFIG.LOG_LEVEL] ?? 20;
function fmt(level, msg, extra) {
  const ts = new Date().toISOString();
  const tail = extra === undefined ? '' : ' ' + JSON.stringify(extra);
  return `${ts} [${level.toUpperCase()}] ${msg}${tail}`;
}
export const log = {
  debug: (m, e) => { if (threshold <= 10) console.log(fmt('debug', m, e)); },
  info: (m, e) => { if (threshold <= 20) console.log(fmt('info', m, e)); },
  warn: (m, e) => { if (threshold <= 30) console.warn(fmt('warn', m, e)); },
  error: (m, e) => { if (threshold <= 40) console.error(fmt('error', m, e)); },
};
