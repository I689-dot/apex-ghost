import './styles.css';
import { App } from './app';
import { h } from './ui/dom';

function isMobile(): boolean {
  const ua = navigator.userAgent;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || touchOnly || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua) && screen.width < 1400);
}

const root = document.getElementById('app') as HTMLElement;

if (isMobile()) {
  root.append(
    h(
      'div.desktop-only',
      {},
      h('div.logo', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
      h('h2', { text: 'Desktop only' }),
      h('p', { text: 'This is a keyboard sim racer. Open it on a desktop or laptop with Chrome, Edge or Firefox.' }),
    ),
  );
} else {
  try {
    const app = new App(root);
    app.showMenu();
  } catch (e) {
    root.append(h('div.fatal', {}, h('h2', { text: 'Cannot start' }), h('p', { text: (e as Error).message })));
  }
}
