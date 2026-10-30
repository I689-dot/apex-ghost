import { h } from '../ui/dom';
import { t } from '../i18n';
import { uiAsset } from '../ui/images';
import { ICONS } from '../ui/icons';
import { APK_BETA_PATH, APK_PATH, APK_URL, isIOS } from './platform';

const apkHref = (): string => `${import.meta.env.BASE_URL}${APK_PATH}`;
const betaHref = (): string => `${import.meta.env.BASE_URL}${APK_BETA_PATH}`;

/** The beta download: a second, smaller button with what it brings. */
function betaLink(): HTMLElement {
  return h(
    'div.install-beta',
    {},
    h(
      'a.install-btn.small',
      { href: betaHref(), download: 'apex-ghost-beta.apk', type: 'application/vnd.android.package-archive' },
      h('span.install-ico', { html: ICONS.download }),
      h('b', { text: t('Try the beta') }),
    ),
    h('p.muted', {
      text: t('The newest changes before everyone else. Installs next to the normal app as “APEX GHOST Beta”.'),
    }),
  );
}

/** The website opened on a phone: still desktop-only, with a big button to install the Android app. */
export function installScreen(): HTMLElement {
  const ios = isIOS();
  const page = h(
    'div.desktop-only.install-page',
    {},
    h('div.logo', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
    h('h2', { text: t('Desktop only') }),
    h('p', {
      text: t('The website is made for a keyboard. On your phone, race with the APEX GHOST app: touch or tilt steering, the same rooms as your friends.'),
    }),
    h(
      'a.install-btn',
      { href: apkHref(), download: 'apex-ghost.apk', type: 'application/vnd.android.package-archive' },
      h('span.install-ico', { html: ICONS.download }),
      h('span', {}, h('b', { text: t('Install the app') }), h('small', { text: t('Android 7 or newer · APK') })),
    ),
    h('p.install-help', { text: t('After the download, open the file and allow your browser to install apps when Android asks.') }),
    betaLink(),
    h('p.install-ios', {
      text: ios
        ? t('iPhone and iPad: the iOS app is not available yet. Play on a computer meanwhile.')
        : t('iPhone and iPad: the iOS app is not available yet.'),
    }),
  );
  page.style.setProperty('--install-bg', `url(${uiAsset('photo_grid.webp')})`);
  return page;
}

/** Desktop menu footer: a small link with the download address and a QR code to scan with the phone. */
export function mobileAppLink(): HTMLElement {
  return h('button.ghost.get-app', { text: t('Get the mobile app'), onclick: () => void openGetApp() });
}

async function openGetApp(): Promise<void> {
  const close = () => modal.remove();
  const qrBox = h('div.qr');
  const modal: HTMLElement = h(
    'div.modal',
    { onclick: (e: Event) => e.target === modal && close() },
    h(
      'div.modal-card.get-app-card',
      {},
      h('header', {}, h('h2', { text: t('APEX GHOST on your phone') }), h('button.icon', { html: ICONS.close, title: t('Close'), onclick: close })),
      h(
        'div.get-app-body',
        {},
        qrBox,
        h(
          'div',
          {},
          h('p', { text: t('Scan the code with your Android phone, or open this website on it and tap “Install the app”.') }),
          h(
            'a.install-btn.small',
            { href: apkHref(), download: 'apex-ghost.apk' },
            h('span.install-ico', { html: ICONS.download }),
            h('b', { text: t('Download the APK') }),
          ),
          h('p.muted', { text: t('Touch or tilt steering, phone graphics, the same rooms and solo races. Android 7 or newer.') }),
          betaLink(),
          h('p.muted', { text: t('iPhone and iPad: the iOS app is not available yet.') }),
        ),
      ),
    ),
  );
  document.body.append(modal);
  try {
    const { default: qrcode } = await import('qrcode-generator');
    const qr = qrcode(0, 'M');
    qr.addData(APK_URL);
    qr.make();
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    qrBox.remove();
  }
}
