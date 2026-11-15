/**
 * Line icons drawn as inline SVG in the text colour: the game shows no emoji (a phone draws arrow, triangle and lock
 * characters as coloured emoji pictures).
 */
const svg = (body: string) =>
  `<svg class="svg-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2a3 3 0 1 0 0 5.6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  download: svg('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  left: svg('<path d="M15 5 8 12l7 7" stroke-width="2.6"/>'),
  right: svg('<path d="m9 5 7 7-7 7" stroke-width="2.6"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5" stroke-width="2.6"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>'),
  car: svg(
    '<path d="M3 15.5V13l2.2-4.6A2 2 0 0 1 7 7.3h10a2 2 0 0 1 1.8 1.1L21 13v2.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5z"/><path d="M3.5 12.5h17"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>',
  ),
  chat: svg('<path d="M4 5h16v10H9l-5 4z"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  send: svg('<path d="M4 12 20 4l-6 16-3-7z"/>'),
  eyeOff: svg(
    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ),
};
