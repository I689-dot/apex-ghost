import { LICENCE_COLOUR, LICENCE_NAME, levelOf, loadCareer, type CareerGain } from '../career';
import { t } from '../i18n';
import { h } from './dom';

/** What a session gave the career (results screen): the XP line by line, the level bar, the licence and its Safety Rating. */
export function careerBlock(g: CareerGain): HTMLElement {
  const c = loadCareer();
  const lv = levelOf(c.xp);
  const dSr = g.srAfter - g.srBefore;
  const srText = `${Math.abs(dSr) < 0.005 ? '±' : dSr > 0 ? '+' : '−'}${Math.abs(dSr).toFixed(2)}`;
  return h(
    'div.career-gain',
    {},
    h('h3', { text: t('Career') }),
    h(
      'div.career-row',
      {},
      h(
        'div.career-xp',
        {},
        ...g.lines.map(([label, xp]) => h('div', {}, h('span', { text: t(label) }), h('b', { text: `+${xp} XP` }))),
        h('div.total', {}, h('span', { text: t('Total') }), h('b', { text: `+${g.xp} XP` })),
        // coins (off for now):
        // ...g.coinLines.map(([label, n]) => h('div.coin', {}, h('span', { text: t(label) }), h('b', { text: `+${n.toLocaleString()}` }))),
        // g.coins
        //   ? h('div.total.coin', {}, h('span', { text: t('Coins') }), h('b', { text: `+${g.coins.toLocaleString()} · ${c.coins.toLocaleString()}` }))
        //   : null,
      ),
      h(
        'div.career-side',
        {},
        h('div.career-level', {}, h('span', { text: t('Level {n}', { n: lv.level }) }), h('small', { text: `${lv.into} / ${lv.need} XP` })),
        h('div.career-bar', {}, h('i', { style: `width:${Math.round((lv.into / lv.need) * 100)}%` })),
        g.levelAfter > g.levelBefore ? h('p.career-up', { text: t('Level up! Level {n}', { n: g.levelAfter }) }) : null,
        h(
          'div.career-lic',
          {},
          h('b.lic', { text: `${g.licenceAfter} ${c.sr.toFixed(2)}`, style: `background:${LICENCE_COLOUR[g.licenceAfter]}` }),
          h('span', { text: `${t(LICENCE_NAME[g.licenceAfter])} · ${t('Safety Rating')} ${srText}` }),
        ),
        g.licenceAfter !== g.licenceBefore
          ? h('p.career-up', {
              text:
                'RDCBAP'.indexOf(g.licenceAfter) > 'RDCBAP'.indexOf(g.licenceBefore)
                  ? t('Promoted to {lic}!', { lic: t(LICENCE_NAME[g.licenceAfter]) })
                  : t('Back to {lic}: keep it clean', { lic: t(LICENCE_NAME[g.licenceAfter]) }),
            })
          : null,
      ),
    ),
  );
}
