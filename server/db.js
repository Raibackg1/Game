// server/db.js
// Persistencia con SQLite (módulo nativo node:sqlite, sin dependencias externas).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { REALM_IDS } from '../shared/constants.js';
import { STRUCTURES } from '../shared/worldmap.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  realm TEXT NOT NULL,
  race TEXT NOT NULL,
  cls TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL,
  z REAL NOT NULL,
  yaw REAL NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL,
  mana INTEGER NOT NULL,
  kills_pve INTEGER NOT NULL DEFAULT 0,
  kills_pvp INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  captures INTEGER NOT NULL DEFAULT 0,
  playtime_seconds INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_played INTEGER
);
CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);

CREATE TABLE IF NOT EXISTS structures (
  id TEXT PRIMARY KEY,
  owner_realm TEXT NOT NULL,
  captured_at INTEGER,
  captures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capture_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  structure_id TEXT NOT NULL,
  from_realm TEXT NOT NULL,
  to_realm TEXT NOT NULL,
  character_id INTEGER,
  character_name TEXT,
  at INTEGER NOT NULL
);
`;

export class GameDB {
  /** @param {string} filePath ruta al fichero .db o ':memory:' */
  constructor(filePath) {
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec(SCHEMA);
    this._prepare();
    this._seedStructures();
  }

  _prepare() {
    const d = this.db;
    this.q = {
      insertAccount: d.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)'),
      accountByUsername: d.prepare('SELECT * FROM accounts WHERE username = ?'),
      accountById: d.prepare('SELECT id, username, created_at, last_login FROM accounts WHERE id = ?'),
      touchLogin: d.prepare('UPDATE accounts SET last_login = ? WHERE id = ?'),

      insertSession: d.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
      sessionByToken: d.prepare('SELECT * FROM sessions WHERE token = ?'),
      deleteSession: d.prepare('DELETE FROM sessions WHERE token = ?'),
      purgeSessions: d.prepare('DELETE FROM sessions WHERE expires_at < ?'),

      insertCharacter: d.prepare(`INSERT INTO characters
        (account_id, name, realm, race, cls, level, xp, gold, x, z, yaw, hp, mana, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?)`),
      charactersByAccount: d.prepare('SELECT * FROM characters WHERE account_id = ? ORDER BY created_at ASC'),
      countCharacters: d.prepare('SELECT COUNT(*) AS n FROM characters WHERE account_id = ?'),
      characterById: d.prepare('SELECT * FROM characters WHERE id = ?'),
      characterByName: d.prepare('SELECT id FROM characters WHERE name = ?'),
      deleteCharacter: d.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?'),
      saveCharacter: d.prepare(`UPDATE characters SET
        cls = ?, level = ?, xp = ?, gold = ?, x = ?, z = ?, yaw = ?, hp = ?, mana = ?,
        kills_pve = ?, kills_pvp = ?, deaths = ?, captures = ?, playtime_seconds = ?, last_played = ?
        WHERE id = ?`),

      structureById: d.prepare('SELECT * FROM structures WHERE id = ?'),
      allStructures: d.prepare('SELECT * FROM structures'),
      insertStructure: d.prepare('INSERT OR IGNORE INTO structures (id, owner_realm) VALUES (?, ?)'),
      setStructureOwner: d.prepare('UPDATE structures SET owner_realm = ?, captured_at = ?, captures = captures + 1 WHERE id = ?'),
      insertCaptureLog: d.prepare('INSERT INTO capture_log (structure_id, from_realm, to_realm, character_id, character_name, at) VALUES (?, ?, ?, ?, ?, ?)'),
      recentCaptures: d.prepare('SELECT * FROM capture_log ORDER BY at DESC LIMIT ?'),

      leaderboard: d.prepare('SELECT name, realm, cls, level, kills_pvp, captures FROM characters ORDER BY level DESC, xp DESC LIMIT ?'),
      realmPopulation: d.prepare('SELECT realm, COUNT(*) AS n FROM characters GROUP BY realm'),
    };
  }

  _seedStructures() {
    for (const s of STRUCTURES) this.q.insertStructure.run(s.id, s.realm);
  }

  // --- cuentas ---------------------------------------------------------------
  createAccount(username, passHash, salt) {
    const res = this.q.insertAccount.run(username, passHash, salt, Date.now());
    return Number(res.lastInsertRowid);
  }
  getAccountByUsername(username) { return this.q.accountByUsername.get(username) ?? null; }
  getAccountById(id) { return this.q.accountById.get(id) ?? null; }
  touchLogin(id) { this.q.touchLogin.run(Date.now(), id); }

  // --- sesiones ---------------------------------------------------------------
  createSession(token, accountId, ttlSeconds) {
    const now = Date.now();
    this.q.insertSession.run(token, accountId, now, now + ttlSeconds * 1000);
  }
  getSession(token) {
    const s = this.q.sessionByToken.get(token);
    if (!s) return null;
    if (s.expires_at < Date.now()) { this.q.deleteSession.run(token); return null; }
    return s;
  }
  deleteSession(token) { this.q.deleteSession.run(token); }
  purgeExpiredSessions() { return this.q.purgeSessions.run(Date.now()).changes; }

  // --- personajes -------------------------------------------------------------
  createCharacter({ accountId, name, realm, race, cls, x, z, yaw, hp, mana }) {
    const res = this.q.insertCharacter.run(accountId, name, realm, race, cls, x, z, yaw, hp, mana, Date.now());
    return Number(res.lastInsertRowid);
  }
  getCharactersByAccount(accountId) { return this.q.charactersByAccount.all(accountId); }
  countCharacters(accountId) { return this.q.countCharacters.get(accountId).n; }
  getCharacter(id) { return this.q.characterById.get(id) ?? null; }
  characterNameExists(name) { return !!this.q.characterByName.get(name); }
  deleteCharacter(id, accountId) { return this.q.deleteCharacter.run(id, accountId).changes > 0; }
  saveCharacter(c) {
    this.q.saveCharacter.run(
      c.cls, c.level, c.xp, c.gold, c.x, c.z, c.yaw, Math.round(c.hp), Math.round(c.mana),
      c.kills_pve, c.kills_pvp, c.deaths, c.captures, Math.round(c.playtime_seconds), Date.now(), c.id,
    );
  }

  // --- estructuras ------------------------------------------------------------
  getStructures() { return this.q.allStructures.all(); }
  setStructureOwner(id, realm, { fromRealm, characterId, characterName }) {
    const now = Date.now();
    const tx = this.db.prepare('BEGIN'); // transacción manual: dos escrituras atómicas
    tx.run();
    try {
      this.q.setStructureOwner.run(realm, now, id);
      this.q.insertCaptureLog.run(id, fromRealm, realm, characterId ?? null, characterName ?? null, now);
      this.db.prepare('COMMIT').run();
    } catch (err) {
      this.db.prepare('ROLLBACK').run();
      throw err;
    }
  }
  recentCaptures(limit = 20) { return this.q.recentCaptures.all(limit); }

  // --- estadísticas -----------------------------------------------------------
  leaderboard(limit = 20) { return this.q.leaderboard.all(limit); }
  realmPopulation() {
    const rows = this.q.realmPopulation.all();
    const out = Object.fromEntries(REALM_IDS.map((r) => [r, 0]));
    for (const r of rows) out[r.realm] = r.n;
    return out;
  }

  close() { this.db.close(); }
}
