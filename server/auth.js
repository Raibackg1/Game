// server/auth.js
// Hash de contraseñas con scrypt (node:crypto), tokens de sesión y limitador de intentos.
import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return { hash: key.toString('hex'), salt: salt.toString('hex') };
}

export function verifyPassword(password, hashHex, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const key = crypto.scryptSync(password, salt, expected.length, SCRYPT_PARAMS);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Limitador de intentos por clave (IP) con ventana deslizante de 60 s. */
export class RateLimiter {
  constructor(maxPerMinute) {
    this.max = maxPerMinute;
    this.buckets = new Map();
  }
  allow(key) {
    const now = Date.now();
    let arr = this.buckets.get(key);
    if (!arr) { arr = []; this.buckets.set(key, arr); }
    while (arr.length && arr[0] < now - 60000) arr.shift();
    if (arr.length >= this.max) return false;
    arr.push(now);
    return true;
  }
  /** Limpia claves inactivas (llamar periódicamente). */
  sweep() {
    const now = Date.now();
    for (const [k, arr] of this.buckets) {
      while (arr.length && arr[0] < now - 60000) arr.shift();
      if (!arr.length) this.buckets.delete(k);
    }
  }
}
