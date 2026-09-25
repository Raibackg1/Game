// client/input.js
// Teclado y ratón. Ignora teclas mientras se escribe en un campo de texto.
export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: [false, false, false], dragging: false, dragButton: -1, dx: 0, dy: 0, moved: 0 };
    this.wheel = 0;
    this.keyHandlers = new Set();
    this.clickHandlers = new Set();
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (this._typing()) return;
      const first = !this.keys.has(e.code);
      this.keys.add(e.code);
      for (const fn of this.keyHandlers) fn(e, first);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    element.addEventListener('contextmenu', (e) => e.preventDefault());
    element.addEventListener('mousedown', (e) => {
      this.mouse.down[e.button] = true;
      this.mouse.dragging = true; this.mouse.dragButton = e.button; this.mouse.moved = 0;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (document.activeElement && document.activeElement.blur && this._typing()) document.activeElement.blur();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.dragging) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
        this.mouse.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.down[e.button] = false;
      if (this.mouse.dragging && this.mouse.dragButton === e.button) {
        if (this.mouse.moved < 6 && e.target === element.querySelector('canvas')) {
          for (const fn of this.clickHandlers) fn(e.clientX, e.clientY, e.button);
        }
        this.mouse.dragging = false; this.mouse.dragButton = -1;
      }
    });
    element.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    // táctil básico: arrastrar gira la cámara
    let lastTouch = null;
    element.addEventListener('touchstart', (e) => { if (e.touches.length === 1) lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    element.addEventListener('touchmove', (e) => {
      if (lastTouch && e.touches.length === 1) {
        const t = e.touches[0];
        this.mouse.dx += t.clientX - lastTouch.x; this.mouse.dy += t.clientY - lastTouch.y;
        lastTouch = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    element.addEventListener('touchend', () => { lastTouch = null; });
  }
  _typing() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }
  isDown(code) { return this.enabled && this.keys.has(code); }
  onKey(fn) { this.keyHandlers.add(fn); return () => this.keyHandlers.delete(fn); }
  onClick(fn) { this.clickHandlers.add(fn); return () => this.clickHandlers.delete(fn); }
  consumeDrag() { const d = { dx: this.mouse.dx, dy: this.mouse.dy }; this.mouse.dx = 0; this.mouse.dy = 0; return d; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  /** Vector de movimiento (adelante, derecha) en [-1,1]. */
  moveAxes() {
    let f = 0, r = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) f += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) f -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) r += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) r -= 1;
    return { f, r };
  }
}
