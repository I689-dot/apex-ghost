/** Tiny DOM helper: h('div.cls#id', {attrs}, children) */
export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Record<string, string | number | boolean | ((e: Event) => void) | null | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = sel.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--.---';
  const neg = ms < 0;
  const t = Math.abs(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const r = Math.floor(t % 1000);
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export function fmtDelta(ms: number): string {
  const s = (ms / 1000).toFixed(3);
  return ms >= 0 ? `+${s}` : s;
}

/** Text setter that only touches the DOM when the value changes. */
export class LazyText {
  private v = '';
  constructor(readonly el: HTMLElement) {}
  set(v: string): void {
    if (v !== this.v) {
      this.v = v;
      this.el.textContent = v;
    }
  }
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(msg: string, ms = 3500): void {
  if (!toastEl) {
    toastEl = h('div.toast');
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), ms);
}
