#!/usr/bin/env node
/**
 * Accounts and friends in real browsers: two players create accounts from the menu (nickname + password), one asks
 * the other to be friends, the other accepts; the first opens a room and the second must see "In lobby <code>" on
 * their friends list and join it from there. With --lap the room runs a qualifying on Zandvoort with both cars on
 * the AI, and the first timed lap must turn up in the records (the server records laps itself). Needs `pnpm dev`
 * with the accounts database (apps/server/.dev.vars). The accounts made are named e2e<number>.
 *
 *   CHROME=/path/to/chrome node tools/e2e/accounts.mjs [--url http://127.0.0.1:5173] [--lap]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const LAP = args.includes('--lap');
const SERVER = URL.replace(/:\d+$/, ':8787');
const tag = String(Date.now()).slice(-6);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const fail = async (msg) => {
  console.log(`  FAILED: ${msg}`);
  await browser.close();
  process.exit(1);
};
const mk = async (nick) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  page.on('pageerror', (e) => console.log(`  [${nick}] pageerror`, String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'x', quality: 'low', qualityAuto: false, language: 'en', camera: 'chase' }));
  });
  await page.goto(URL);
  await page.waitForSelector('.menu');
  await page.waitForTimeout(1000);
  // create the account from the menu
  await page.click('button:has-text("Sign in / create account")');
  await page.fill('.sign-in input[type=text]', nick);
  await page.fill('.sign-in input[type=password]', 'secret1');
  await page.click('.sign-in button:has-text("Create account")');
  await page.waitForSelector(`.account-bar:has-text("Signed in as ${nick}")`, { timeout: 15_000 }).catch(() => fail(`${nick} could not create an account`));
  return page;
};
const a = await mk(`e2eA${tag}`);
const b = await mk(`e2eB${tag}`);
console.log(`  accounts created: e2eA${tag}, e2eB${tag}`);
// A asks B; B accepts from the friends list
await a.fill('.friends input', `e2eB${tag}`);
await a.click('.friends button:has-text("Add")');
await a.waitForSelector('.friend:has-text("Request sent")', { timeout: 10_000 }).catch(() => fail('no "Request sent"'));
await b.reload();
await b.waitForSelector('.friend:has-text("Wants to be your friend")', { timeout: 15_000 }).catch(() => fail('B sees no request'));
await b.click('.friend button:has-text("Accept")');
await b.waitForSelector(`.friend:has-text("e2eA${tag}") >> text=Online`, { timeout: 15_000 }).catch(() => fail('B does not see A online'));
console.log('  friends: request sent, accepted, A shown online in the menu');
// A opens a room; B sees it on the friends list and joins from there
await a.click('button:has-text("Create room")');
await a.waitForSelector('.car-card', { timeout: 30_000 });
const code = await a.evaluate(() => window.__app.conn.code);
await b.bringToFront();
await b.waitForSelector(`.friend:has-text("In lobby ${code}")`, { timeout: 40_000 }).catch(async () => {
  const seen = await b.evaluate(async (server) => {
    const token = JSON.parse(localStorage.getItem('apexghost.account')).token;
    return (await fetch(`${server}/api/friends`, { headers: { Authorization: `Bearer ${token}` } })).text();
  }, SERVER);
  const shown = await b.textContent('.friends');
  await fail(`B does not see A in lobby ${code}: API ${seen} · panel: ${shown}`);
});
await b.click(`.friend:has-text("In lobby ${code}") button:has-text("Join")`);
await b.waitForSelector('.car-card', { timeout: 30_000 }).catch(() => fail('B could not join from the friends list'));
const nicks = await a.evaluate(() => window.__app.room.players.map((p) => p.nick));
console.log(`  B joined ${code} from the friends list; room: ${nicks.join(', ')}`);
if (!nicks.includes(`e2eB${tag}`)) await fail('B is not in the room');

if (LAP) {
  await a.selectOption('.prep .prep-row:nth-of-type(1) select', 'zandvoort');
  await a.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
  for (const [p, n] of [
    [a, 0],
    [b, 1],
  ]) {
    await p.click(`.car-card >> nth=${n}`);
    await p.click('.lobby-actions button:has-text("Ready")');
  }
  await a.waitForTimeout(600);
  await a.click('button:has-text("Start race")');
  for (const p of [a, b]) await p.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
  for (const p of [a, b]) await p.waitForSelector('.race-ui', { timeout: 240_000 });
  for (const p of [a, b]) {
    await p.keyboard.press('Enter');
    await p.evaluate(() => {
      const s = window.__apex.session;
      const ai = new window.__apex.AiDriver(s.trackData, s.vehicle, 0.95, 0);
      s.smoother.update = (dt) => ai.update(dt, s.startAt !== null && s.conn.serverNow() >= s.startAt, s.vehicle.weatherGrip * s.vehicle.tyreGripAvg);
    });
  }
  console.log('  qualifying on Zandvoort, both cars on the AI: waiting for a timed lap');
  let rows = [];
  for (let k = 0; k < 40 && !rows.length; k++) {
    await a.waitForTimeout(10_000);
    rows = (await (await fetch(`${SERVER}/api/records?track=zandvoort`)).json()).rows.filter((r) => r.nick.endsWith(tag));
  }
  if (!rows.length) await fail('no lap in the records after 400 s');
  console.log(`  records: ${rows.map((r) => `${r.nick} ${(r.lapMs / 1000).toFixed(3)} s`).join(', ')}`);
}
await browser.close();
console.log('  OK');
