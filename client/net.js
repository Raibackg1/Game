// client/net.js
// Cliente WebSocket: reconexión con retroceso exponencial, despacho por tipo de mensaje y medición de latencia.
export class Net {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.latency = 0;
    this.serverOffset = 0;   // serverTime - clientTime
    this.online = 0;
    this._pingTimer = null;
    this._reconnectDelay = 1000;
    this._manuallyClosed = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  _emit(type, msg) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) {
      try { fn(msg); } catch (err) { console.error(`Error en manejador de '${type}':`, err); }
    }
  }

  connect() {
    this._manuallyClosed = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this._reconnectDelay = 1000;
        this._startPing();
        this._emit('_open', {});
        if (!settled) { settled = true; resolve(); }
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); }
        catch (err) { console.error('Mensaje no JSON del servidor:', ev.data); return; }
        if (msg.t === 'pong') {
          const now = Date.now();
          this.latency = Math.max(0, now - msg.ts);
          this.serverOffset = msg.serverTime - (now - this.latency / 2);
          this.online = msg.online;
        }
        this._emit(msg.t, msg);
        this._emit('*', msg);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('No se pudo conectar con ' + this.url)); }
      };
      ws.onclose = (ev) => {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopPing();
        this._emit('_close', { code: ev.code, reason: ev.reason, wasConnected });
        if (!settled) { settled = true; reject(new Error('Conexión cerrada antes de abrir (' + ev.code + ')')); }
        if (!this._manuallyClosed && ev.code !== 4000) this._scheduleReconnect();
      };
    });
  }

  _scheduleReconnect() {
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(15000, this._reconnectDelay * 1.8);
    this._emit('_reconnecting', { delay });
    setTimeout(() => {
      if (this._manuallyClosed) return;
      this.connect().catch(() => { /* onclose reprograma */ });
    }, delay);
  }

  close() {
    this._manuallyClosed = true;
    this._stopPing();
    if (this.ws) this.ws.close(1000, 'cliente');
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  serverNow() { return Date.now() + this.serverOffset; }

  _startPing() {
    this._stopPing();
    const ping = () => this.send({ t: 'ping', ts: Date.now() });
    ping();
    this._pingTimer = setInterval(ping, 5000);
  }
  _stopPing() { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } }
}
