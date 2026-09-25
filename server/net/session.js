// server/net/session.js
// Máquina de estados de una conexión: sin autenticar → autenticada → en el mundo.
// Valida cada mensaje entrante antes de tocar el mundo.
import { C2S, S2C, ERR } from '../../shared/messages.js';
import {
  REALMS, RACES, CLASSES, BASE_CLASS_IDS, USERNAME_RE, CHARNAME_RE, PASSWORD_MIN, PASSWORD_MAX,
  CHAT_CHANNELS, CHAT_MAX_LENGTH, derivedStats,
} from '../../shared/constants.js';
import { hashPassword, verifyPassword, newToken } from '../auth.js';
import { CONFIG } from '../config.js';
import { log } from '../log.js';

const INPUT_MIN_INTERVAL_MS = 30;   // ~33 Hz máx
const CHAT_MIN_INTERVAL_MS = 700;
const ACTION_MIN_INTERVAL_MS = 80;

let nextSessionId = 1;

export class Session {
  /**
   * @param {import('ws').WebSocket} ws
   * @param {import('../world/world.js').World} world
   * @param {import('../db.js').GameDB} db
   * @param {{ ip: string, loginLimiter: import('../auth.js').RateLimiter, sessions: Set<Session> }} ctx
   */
  constructor(ws, world, db, ctx) {
    this.id = nextSessionId++;
    this.ws = ws;
    this.world = world;
    this.db = db;
    this.ctx = ctx;
    this.ip = ctx.ip;
    this.account = null;   // { id, username }
    this.token = null;
    this.player = null;
    this.lastInputAt = 0;
    this.lastChatAt = 0;
    this.lastActionAt = 0;
    this.closed = false;
    ws.on('message', (data, isBinary) => this._onMessage(data, isBinary));
    ws.on('close', () => this._onClose());
    ws.on('error', (err) => log.warn('ws error', { session: this.id, err: err.message }));
  }

  // --- envío ----------------------------------------------------------------------
  send(obj) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    try { this.ws.send(JSON.stringify(obj)); }
    catch (err) { log.warn('Error enviando', { session: this.id, err: err.message }); }
  }
  sendError(code, message, extra = {}) {
    this.send({ t: S2C.ERROR, code, message: message || code, ...extra });
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    try { this.ws.close(code, reason); } catch { /* ya cerrado */ }
  }

  // --- recepción -------------------------------------------------------------------
  _onMessage(data, isBinary) {
    if (isBinary) { this.sendError(ERR.BAD_REQUEST, 'Solo se aceptan mensajes de texto JSON.'); return; }
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); }
    catch { this.sendError(ERR.BAD_REQUEST, 'JSON inválido.'); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') { this.sendError(ERR.BAD_REQUEST, 'Mensaje sin tipo.'); return; }
    try {
      this._dispatch(msg);
    } catch (err) {
      log.error('Error procesando mensaje', { session: this.id, type: msg.t, err: err.stack || err.message });
      this.sendError(ERR.SERVER_ERROR, 'Error interno del servidor procesando ' + msg.t);
    }
  }

  _dispatch(msg) {
    const now = Date.now();
    switch (msg.t) {
      case C2S.PING: this.send({ t: S2C.PONG, ts: typeof msg.ts === 'number' ? msg.ts : now, serverTime: now, online: this.world.players.size }); return;
      case C2S.REGISTER: return this._register(msg);
      case C2S.LOGIN: return this._login(msg);
      case C2S.RESUME: return this._resume(msg);
      case C2S.LOGOUT: return this._logout();
    }
    if (!this.account) { this.sendError(ERR.AUTH_REQUIRED, 'Inicia sesión primero.'); return; }
    switch (msg.t) {
      case C2S.CREATE_CHAR: return this._createChar(msg);
      case C2S.DELETE_CHAR: return this._deleteChar(msg);
      case C2S.ENTER: return this._enter(msg, now);
      case C2S.LEAVE: return this._leave();
    }
    const p = this.player;
    if (!p) { this.sendError(ERR.NOT_IN_WORLD, 'No estás en el mundo.'); return; }
    switch (msg.t) {
      case C2S.INPUT: {
        if (now - this.lastInputAt < INPUT_MIN_INTERVAL_MS) return; // descartar en silencio (exceso de frecuencia)
        this.lastInputAt = now;
        const mx = num(msg.mx), mz = num(msg.mz), yaw = num(msg.yaw);
        if (mx === null || mz === null || yaw === null) { this.sendError(ERR.BAD_REQUEST, 'input inválido'); return; }
        this.world.setInput(p, mx, mz, yaw, now);
        return;
      }
      case C2S.TARGET: {
        const id = msg.id === null || msg.id === undefined ? null : Number(msg.id);
        if (id !== null && !Number.isInteger(id)) { this.sendError(ERR.BAD_REQUEST, 'id inválido'); return; }
        const r = this.world.setTarget(p, id);
        if (r) this.sendError(r, 'Objetivo no válido.');
        return;
      }
      case C2S.ATTACK: {
        if (!this._actionAllowed(now)) return;
        const r = this.world.setAutoAttack(p, !!msg.on);
        if (r) this.sendError(r, r === ERR.NO_TARGET ? 'Selecciona un objetivo.' : r === ERR.DEAD ? 'Estás muerto.' : 'No puedes atacar a ese objetivo.');
        return;
      }
      case C2S.CAST: {
        if (!this._actionAllowed(now)) return;
        if (typeof msg.skill !== 'string' || msg.skill.length > 40) { this.sendError(ERR.BAD_REQUEST, 'skill inválida'); return; }
        const tid = msg.target === undefined || msg.target === null ? null : Number(msg.target);
        const r = this.world.useSkill(p, msg.skill, Number.isInteger(tid) ? tid : null, now);
        if (r) this.sendError(r.code, r.message, { skill: msg.skill });
        return;
      }
      case C2S.INTERACT: {
        if (!this._actionAllowed(now)) return;
        if (typeof msg.id !== 'string' || msg.id.length > 40) { this.sendError(ERR.BAD_REQUEST, 'id inválido'); return; }
        const r = this.world.interact(p, msg.id, now);
        if (r) this.sendError(r.code, r.message);
        return;
      }
      case C2S.CHAT: return this._chat(msg, now);
      case C2S.RESPAWN: {
        const r = this.world.respawn(p, now);
        if (r) this.sendError(r.code, r.message);
        return;
      }
      case C2S.CHOOSE_SUBCLASS: {
        if (typeof msg.cls !== 'string') { this.sendError(ERR.BAD_REQUEST, 'cls inválida'); return; }
        const r = this.world.chooseSubclass(p, msg.cls);
        if (r) this.sendError(r.code, r.message);
        else this.send({ t: S2C.SELF, self: p.packSelf(now) });
        return;
      }
      default:
        this.sendError(ERR.BAD_REQUEST, `Tipo de mensaje desconocido: ${msg.t}`);
    }
  }

  _actionAllowed(now) {
    if (now - this.lastActionAt < ACTION_MIN_INTERVAL_MS) { this.sendError(ERR.RATE_LIMIT, 'Demasiadas acciones.'); return false; }
    this.lastActionAt = now;
    return true;
  }

  // --- autenticación -----------------------------------------------------------------
  _validateCredentials(msg) {
    if (typeof msg.username !== 'string' || !USERNAME_RE.test(msg.username)) {
      this.sendError(ERR.INVALID_NAME, 'Usuario: 3-16 caracteres, letras, números o _.'); return false;
    }
    if (typeof msg.password !== 'string' || msg.password.length < PASSWORD_MIN || msg.password.length > PASSWORD_MAX) {
      this.sendError(ERR.INVALID_PASSWORD, `Contraseña: entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`); return false;
    }
    return true;
  }
  _register(msg) {
    if (this.account) { this.sendError(ERR.BAD_REQUEST, 'Ya has iniciado sesión.'); return; }
    if (!this.ctx.loginLimiter.allow(this.ip)) { this.sendError(ERR.RATE_LIMIT, 'Demasiados intentos. Espera un minuto.'); return; }
    if (!this._validateCredentials(msg)) return;
    if (this.db.getAccountByUsername(msg.username)) { this.sendError(ERR.USERNAME_TAKEN, 'Ese usuario ya existe.'); return; }
    const { hash, salt } = hashPassword(msg.password);
    let id;
    try { id = this.db.createAccount(msg.username, hash, salt); }
    catch (err) {
      if (String(err.message).includes('UNIQUE')) { this.sendError(ERR.USERNAME_TAKEN, 'Ese usuario ya existe.'); return; }
      throw err;
    }
    log.info('Cuenta creada', { username: msg.username, ip: this.ip });
    this._authenticated({ id, username: msg.username });
  }
  _login(msg) {
    if (this.account) { this.sendError(ERR.BAD_REQUEST, 'Ya has iniciado sesión.'); return; }
    if (!this.ctx.loginLimiter.allow(this.ip)) { this.sendError(ERR.RATE_LIMIT, 'Demasiados intentos. Espera un minuto.'); return; }
    if (typeof msg.username !== 'string' || typeof msg.password !== 'string') { this.sendError(ERR.BAD_REQUEST, 'Credenciales inválidas.'); return; }
    const acc = this.db.getAccountByUsername(msg.username);
    if (!acc || !verifyPassword(msg.password, acc.pass_hash, acc.salt)) {
      this.sendError(ERR.INVALID_CREDENTIALS, 'Usuario o contraseña incorrectos.'); return;
    }
    this._authenticated({ id: acc.id, username: acc.username });
  }
  _resume(msg) {
    if (this.account) { this.sendError(ERR.BAD_REQUEST, 'Ya has iniciado sesión.'); return; }
    if (typeof msg.token !== 'string' || msg.token.length !== 64) { this.sendError(ERR.SESSION_EXPIRED, 'Sesión no válida.'); return; }
    const s = this.db.getSession(msg.token);
    if (!s) { this.sendError(ERR.SESSION_EXPIRED, 'La sesión ha caducado. Inicia sesión de nuevo.'); return; }
    const acc = this.db.getAccountById(s.account_id);
    if (!acc) { this.sendError(ERR.SESSION_EXPIRED, 'Cuenta no encontrada.'); return; }
    this._authenticated({ id: acc.id, username: acc.username }, msg.token);
  }
  _authenticated(account, existingToken = null) {
    // una cuenta solo puede tener una conexión activa: expulsa la anterior
    for (const other of this.ctx.sessions) {
      if (other !== this && other.account && other.account.id === account.id) {
        other.sendError(ERR.SESSION_EXPIRED, 'Tu cuenta se ha conectado desde otro sitio.');
        other.close(4000, 'duplicate login');
      }
    }
    this.account = account;
    if (existingToken) this.token = existingToken;
    else { this.token = newToken(); this.db.createSession(this.token, account.id, CONFIG.SESSION_TTL_SECONDS); }
    this.db.touchLogin(account.id);
    this.send({ t: S2C.AUTH, ok: true, token: this.token, username: account.username, characters: this._charList() });
  }
  _logout() {
    if (this.player) this._leave();
    if (this.token) { try { this.db.deleteSession(this.token); } catch (err) { log.warn('logout', { err: err.message }); } }
    this.account = null; this.token = null;
    this.send({ t: S2C.AUTH, ok: false, loggedOut: true });
  }

  // --- personajes ------------------------------------------------------------------------
  _charList() {
    return this.db.getCharactersByAccount(this.account.id).map((c) => ({
      id: c.id, name: c.name, realm: c.realm, race: c.race, cls: c.cls, level: c.level,
      kills_pvp: c.kills_pvp, kills_pve: c.kills_pve, captures: c.captures, lastPlayed: c.last_played,
    }));
  }
  _createChar(msg) {
    if (this.player) { this.sendError(ERR.ALREADY_IN_WORLD, 'Sal del mundo primero.'); return; }
    const { name, realm, race, cls } = msg;
    if (typeof name !== 'string' || !CHARNAME_RE.test(name)) { this.sendError(ERR.INVALID_NAME, 'Nombre: 3-14 letras, sin espacios ni números.'); return; }
    if (!REALMS[realm]) { this.sendError(ERR.INVALID_REALM, 'Reino inválido.'); return; }
    if (!RACES[race] || RACES[race].realm !== realm) { this.sendError(ERR.INVALID_RACE, 'Esa raza no pertenece a ese reino.'); return; }
    if (!BASE_CLASS_IDS.includes(cls)) { this.sendError(ERR.INVALID_CLASS, 'Clase inválida.'); return; }
    if (this.db.countCharacters(this.account.id) >= CONFIG.MAX_CHARACTERS_PER_ACCOUNT) { this.sendError(ERR.MAX_CHARACTERS, `Máximo ${CONFIG.MAX_CHARACTERS_PER_ACCOUNT} personajes.`); return; }
    if (this.db.characterNameExists(name)) { this.sendError(ERR.NAME_TAKEN, 'Ese nombre ya está en uso.'); return; }
    const d = derivedStats(race, cls, 1);
    const sp = this.world.spawnPoint(realm);
    let id;
    try {
      id = this.db.createCharacter({ accountId: this.account.id, name, realm, race, cls, x: sp.x, z: sp.z, yaw: 0, hp: d.maxHp, mana: d.maxMana });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) { this.sendError(ERR.NAME_TAKEN, 'Ese nombre ya está en uso.'); return; }
      throw err;
    }
    log.info('Personaje creado', { name, realm, race, cls, account: this.account.username });
    this.send({ t: S2C.CHARS, characters: this._charList(), created: id });
  }
  _deleteChar(msg) {
    if (this.player) { this.sendError(ERR.ALREADY_IN_WORLD, 'Sal del mundo primero.'); return; }
    const id = Number(msg.id);
    if (!Number.isInteger(id)) { this.sendError(ERR.BAD_REQUEST, 'id inválido'); return; }
    if (!this.db.deleteCharacter(id, this.account.id)) { this.sendError(ERR.NOT_FOUND, 'Personaje no encontrado.'); return; }
    this.send({ t: S2C.CHARS, characters: this._charList(), deleted: id });
  }
  _enter(msg, now) {
    if (this.player) { this.sendError(ERR.ALREADY_IN_WORLD, 'Ya estás en el mundo.'); return; }
    const id = Number(msg.charId);
    const row = Number.isInteger(id) ? this.db.getCharacter(id) : null;
    if (!row || row.account_id !== this.account.id) { this.sendError(ERR.NOT_FOUND, 'Personaje no encontrado.'); return; }
    this.player = this.world.addPlayer(row, this);
    this.send(this.world.welcomePayload(this.player, now));
    log.info('Jugador entra', { name: row.name, realm: row.realm, session: this.id });
  }
  _leave() {
    if (!this.player) return;
    const p = this.player;
    this.world.removePlayer(p);
    this.player = null;
    this.send({ t: S2C.LEFT, characters: this._charList() });
    log.info('Jugador sale', { name: p.name, session: this.id });
  }

  // --- chat ------------------------------------------------------------------------------
  _chat(msg, now) {
    if (now - this.lastChatAt < CHAT_MIN_INTERVAL_MS) { this.sendError(ERR.RATE_LIMIT, 'Escribes demasiado rápido.'); return; }
    if (!CHAT_CHANNELS.includes(msg.ch)) { this.sendError(ERR.BAD_REQUEST, 'Canal inválido.'); return; }
    if (typeof msg.text !== 'string') { this.sendError(ERR.BAD_REQUEST, 'Texto inválido.'); return; }
    const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    this.lastChatAt = now;
    this.world.chat(this.player, msg.ch, text);
  }

  // --- cierre -----------------------------------------------------------------------------
  _onClose() {
    if (this.closed) return;
    this.closed = true;
    if (this.player) {
      try { this.world.removePlayer(this.player); }
      catch (err) { log.error('Error al retirar jugador', { err: err.stack || err.message }); }
      this.player = null;
    }
    this.ctx.sessions.delete(this);
    log.debug('Sesión cerrada', { session: this.id });
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
