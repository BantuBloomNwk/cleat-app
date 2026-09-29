// Does every tab load on a phone, without errors and without sideways scroll?
// Read only. Run it against a draft deploy before promoting it, and against
// production after.
//
//   node boot.mjs [url]
import { TABS, launch, openApp, OUT, phonePage, report, target, wait } from './lib.mjs';

const url = target();
const b = await launch({ webgl: true });
const p = await phonePage(b);
await openApp(p, url);
const checks = [];
checks.push(['the app mounted', await p.evaluate(() => !!document.querySelector('#root')?.children.length)]);
for (const [id, name] of TABS) {
  await p.tap(`#${id}`).catch(() => {});
  await wait(3500);
  await p.screenshot({ path: `${OUT}boot-${name}.png` });
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  checks.push([`${name}: no sideways scroll`, wide <= 1, wide > 1 ? `${wide}px too wide` : '']);
}
checks.push(['no errors in the console or the network', p.errors.length === 0, p.errors.slice(0, 5).join(' | ')]);
report('boot', checks);
await b.close();
