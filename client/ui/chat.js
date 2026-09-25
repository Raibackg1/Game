// client/ui/chat.js
const CHANNEL_LABEL = { say: 'Dice', realm: 'Reino', global: 'Global', system: 'Sistema', combat: '', error: '' };
const MAX_LINES = 200;

export class Chat {
  constructor(root, sendFn) {
    this.log = root.querySelector('#chat-log');
    this.input = root.querySelector('#chat-input');
    this.channel = root.querySelector('#chat-channel');
    this.sendFn = sendFn;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value.trim();
        this.input.value = '';
        this.input.blur();
        if (!text) return;
        let ch = this.channel.value;
        let body = text;
        const m = text.match(/^\/(r|g|s)\s+(.*)$/i);
        if (m) { ch = { r: 'realm', g: 'global', s: 'say' }[m[1].toLowerCase()]; body = m[2]; this.channel.value = ch; }
        if (body.trim()) this.sendFn(ch, body.trim());
      } else if (e.key === 'Escape') {
        this.input.value = ''; this.input.blur();
      }
      e.stopPropagation();
    });
  }
  focus() { this.input.focus(); }
  isFocused() { return document.activeElement === this.input; }
  add({ ch, from, realm, text, ts }, realmColor) {
    const line = document.createElement('div');
    line.className = `line ch-${ch}`;
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = CHANNEL_LABEL[ch] ?? ch;
    if (from) {
      const f = document.createElement('span');
      f.className = 'from'; f.textContent = from; if (realmColor) f.style.color = realmColor;
      line.append(`[${time}] [${label}] `, f, `: ${text}`);
    } else {
      line.textContent = label ? `[${time}] [${label}] ${text}` : `[${time}] ${text}`;
    }
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
