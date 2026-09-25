// shared/messages.js
// Tipos de mensaje del protocolo WebSocket (JSON). C2S = cliente→servidor, S2C = servidor→cliente.
export const C2S = Object.freeze({
  REGISTER: 'register',
  LOGIN: 'login',
  RESUME: 'resume',           // reanudar sesión con token
  LOGOUT: 'logout',
  CREATE_CHAR: 'create_char',
  DELETE_CHAR: 'delete_char',
  ENTER: 'enter',             // entrar al mundo con un personaje
  LEAVE: 'leave',             // volver a la selección de personaje
  INPUT: 'input',             // movimiento
  TARGET: 'target',
  ATTACK: 'attack',           // activar/desactivar autoataque
  CAST: 'cast',
  INTERACT: 'interact',       // capturar bandera
  CHAT: 'chat',
  RESPAWN: 'respawn',
  CHOOSE_SUBCLASS: 'choose_subclass',
  PING: 'ping',
});
export const S2C = Object.freeze({
  ERROR: 'error',
  AUTH: 'auth',
  CHARS: 'chars',
  WELCOME: 'welcome',
  LEFT: 'left',
  SNAPSHOT: 'snap',
  SELF: 'self',
  EVENT: 'ev',
  CHAT: 'chat',
  STRUCTURE: 'struct',
  PONG: 'pong',
});
/** Sub-tipos de S2C.EVENT */
export const EV = Object.freeze({
  DAMAGE: 'damage',
  HEAL: 'heal',
  MISS: 'miss',
  CAST_START: 'cast_start',
  CAST_END: 'cast_end',
  DEATH: 'death',
  RESPAWN: 'respawn',
  LEVEL_UP: 'level_up',
  XP: 'xp',
  GOLD: 'gold',
  BUFF: 'buff',
  CAPTURE_PROGRESS: 'capture_progress',
  CAPTURE_CANCEL: 'capture_cancel',
  STRUCTURE_CAPTURED: 'structure_captured',
  DOOR_DESTROYED: 'door_destroyed',
  SYSTEM: 'system',
});
/** Códigos de error */
export const ERR = Object.freeze({
  BAD_REQUEST: 'bad_request',
  RATE_LIMIT: 'rate_limit',
  AUTH_REQUIRED: 'auth_required',
  INVALID_CREDENTIALS: 'invalid_credentials',
  USERNAME_TAKEN: 'username_taken',
  NAME_TAKEN: 'name_taken',
  INVALID_NAME: 'invalid_name',
  INVALID_PASSWORD: 'invalid_password',
  INVALID_REALM: 'invalid_realm',
  INVALID_RACE: 'invalid_race',
  INVALID_CLASS: 'invalid_class',
  MAX_CHARACTERS: 'max_characters',
  NOT_FOUND: 'not_found',
  ALREADY_IN_WORLD: 'already_in_world',
  NOT_IN_WORLD: 'not_in_world',
  DEAD: 'dead',
  OUT_OF_RANGE: 'out_of_range',
  NO_TARGET: 'no_target',
  INVALID_TARGET: 'invalid_target',
  ON_COOLDOWN: 'on_cooldown',
  NO_MANA: 'no_mana',
  CASTING: 'casting',
  UNKNOWN_SKILL: 'unknown_skill',
  SUBCLASS_NOT_AVAILABLE: 'subclass_not_available',
  SESSION_EXPIRED: 'session_expired',
  SERVER_ERROR: 'server_error',
});
