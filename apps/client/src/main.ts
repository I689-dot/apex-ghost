import './styles.css';
import { App } from './app';
import { h } from './ui/dom';
import { setLang, t } from './i18n';
import { settings } from './settings';
import { IS_APP, isMobileDevice } from './mobile/platform';
import { installScreen } from './mobile/installScreen';
import { initAppShell } from './mobile/appShell';

setLang(settings.language === 'es' ? 'es' : 'en');
const root = document.getElementById('app') as HTMLElement;

if (!IS_APP && isMobileDevice()) {
  // the website stays desktop-only (keyboard driving); phones get the app instead
  root.append(installScreen());
} else {
  try {
    if (IS_APP) initAppShell();
    const app = new App(root);
    app.showMenu();
    if (import.meta.env.DEV) (window as unknown as { __app?: App }).__app = app; // e2e tools
  } catch (e) {
    root.append(h('div.fatal', {}, h('h2', { text: t('Cannot start') }), h('p', { text: (e as Error).message })));
  }
}
