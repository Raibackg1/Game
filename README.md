# Reinos en Guerra — MMORPG de guerra entre reinos

MMORPG en navegador inspirado en *Champions of Regnum* y *World of Warcraft*:
tres reinos enfrentados, nueve razas, tres clases base con seis especializaciones,
niveles 1–60, monstruos por zonas, PvP en la zona de guerra central y **fuertes y castillos
capturables** que otorgan bonificaciones a todo el reino.

- **Servidor autoritativo** en Node.js 22 (`ws` + `node:sqlite` + `scrypt`). Todo el movimiento,
  combate, XP, muerte y capturas se calculan y validan en el servidor.
- **Cliente 3D** en Three.js (ES modules, sin bundler): cámara en tercera persona, terreno
  procedural determinista compartido con el servidor, HUD completo, minimapa y mapa del mundo.
- **Persistencia real** en SQLite: cuentas, sesiones, personajes (posición, nivel, XP, oro,
  estadísticas) y propiedad de estructuras con historial de capturas.

## Requisitos

- Node.js **≥ 22.13** (usa el módulo nativo `node:sqlite`).
- Navegador con WebGL 2.

## Instalación y arranque

```bash
npm install
npm start          # http://localhost:8080
```

Variables de entorno (todas opcionales):

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP + WebSocket |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `DB_PATH` | `./data/game.db` | Fichero SQLite |
| `SESSION_TTL_SECONDS` | `604800` | Duración de las sesiones (7 días) |
| `MAX_CHARACTERS_PER_ACCOUNT` | `6` | Personajes por cuenta |
| `SAVE_INTERVAL_SECONDS` | `30` | Guardado periódico de personajes |
| `MAX_CONNECTIONS` | `500` | Conexiones simultáneas |
| `LOGIN_ATTEMPTS_PER_MINUTE` | `10` | Límite de intentos de acceso por IP |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Pruebas

```bash
npm test               # 24 pruebas: unitarias, integración del mundo, guerra entre reinos y extremo a extremo por WebSocket
npm run e2e:browser    # prueba en Chromium headless (Playwright): registro → personaje → mundo → combate
npm run balance        # simulación de balance: cada clase contra los monstruos de su nivel (tiempo y vida restante)
```

## El juego

### Reinos y razas

| Reino | Bioma | Razas |
|---|---|---|
| **Norheim** | hielo, montañas | Nordo, Enano, Gigante de Utgard |
| **Pyrrhos** | desierto volcánico | Ignar, Beliak, Cinerio |
| **Eldwyn** | bosque | Elfo, Semielfo, Silvano |

### Clases

| Base | Nivel 10 → especialización |
|---|---|
| Guerrero | Caballero (tanque) · Bárbaro (daño melé) |
| Arquero | Cazador (control) · Tirador (daño a distancia) |
| Mago | Conjurador (sanador) · Brujo (daño mágico) |

27 habilidades en total (daño, área, curación, escudos, buffs, raíces, ralentización, provocación,
drenaje, daño/curación periódica). Ver `shared/constants.js`.

### Mundo

- Cada reino tiene una **zona interior segura** (sin PvP) con monstruos de nivel 1–25 en anillos
  alrededor del altar (punto de reaparición).
- La **zona de guerra** central tiene monstruos de nivel 25–55, el **Dragón del Cráter** (nivel 60, élite)
  en el centro y las **6 estructuras capturables**: un castillo y un fuerte por reino.
- **Captura**: derriba la puerta (entidad atacable), entra y canaliza 30 s junto a la bandera sin
  moverte ni recibir daño. Los guardias cambian de bando, la puerta se restaura y todo el reino recibe
  **+2 % de daño y XP por estructura** poseída.
- **Invasión**: un reino solo puede cruzar la frontera de un reino enemigo si posee su castillo.
- Las puertas destruidas se reparan solas a los 10 minutos si nadie las está capturando.

### Controles

`W A S D` moverse · arrastrar ratón girar cámara · rueda zoom · clic seleccionar · `Tab` enemigo más
cercano · `1-9` habilidades · `T` atacar · `F` capturar bandera · `Enter` chat (`/r` reino, `/g` global,
`/s` decir) · `M` mapa del mundo · `H` ayuda · `R` reaparecer.

## Arquitectura

```
shared/      constantes de juego, mapa del mundo, terreno y protocolo (usados por ambos lados)
server/      HTTP estático + WebSocket, SQLite, autenticación, mundo (entidades, combate, IA, estructuras)
client/      Three.js: escena, terreno, entidades, estructuras, cámara; UI: pantallas, HUD, chat, minimapa
tests/       node:test
scripts/     prueba de navegador con Playwright
```

Protocolo: JSON sobre WebSocket (`shared/messages.js`). El servidor simula a 20 Hz y envía snapshots
a 10 Hz solo de las entidades dentro del radio de interés (170 u) de cada jugador; el cliente interpola
con 120 ms de retardo y predice localmente el movimiento propio con reconciliación suave.

API HTTP de solo lectura: `GET /api/status` (estado del mundo) y `GET /api/leaderboard`.

## Estado del proyecto

🟡 **MVP jugable**. Funciona de punta a punta con persistencia real. Pendiente para producción:
TLS/reverse proxy, protección anti-bots y CAPTCHA en el registro, inventario y equipo, misiones,
grupos/party, gremios, modelos y animaciones artísticas, audio, escalado horizontal del servidor.
