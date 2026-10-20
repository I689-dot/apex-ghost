import './styles.css';
import { App } from './app';
import { h } from './ui/dom';
import { setLang, t } from './i18n';
import { settings } from './settings';

function isMobile(): boolean {
  const ua = navigator.userAgent;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || touchOnly || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua) && screen.width < 1400);
}

setLang(settings.language === 'es' ? 'es' : 'en');
const root = document.getElementById('app') as HTMLElement;

if (isMobile()) {
  root.append(
    h(
      'div.desktop-only',
      {},
      h('div.logo', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
      h('h2', { text: t('Desktop only') }),
      h('p', { text: t('This is a keyboard sim racer. Open it on a desktop or laptop with Chrome, Edge or Firefox.') }),
    ),
  );
} else {
  try {
    const app = new App(root);
    app.showMenu();
    if (import.meta.env.DEV) (window as unknown as { __app?: App }).__app = app; // e2e tools
  } catch (e) {
    root.append(h('div.fatal', {}, h('h2', { text: t('Cannot start') }), h('p', { text: (e as Error).message })));
  }
}
