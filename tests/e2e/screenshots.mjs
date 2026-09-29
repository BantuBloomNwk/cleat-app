// The dApp Store screenshots: 360 by 640 at three times density, which is
// exactly the 1080 by 1920 the store asks for, and also the narrowest common
// Android width. Written to ./out/screenshots; copy the good ones to
// store/screenshots by hand after looking at them.
//
//   node screenshots.mjs [url]
import fs from 'node:fs';
import { addVirtualPasskey, launch, OUT, press, report, target, wait } from './lib.mjs';

const url = target();
const dir = `${OUT}screenshots/`;
fs.mkdirSync(dir, { recursive: true });
const b = await launch({ webgl: true });
const p = await b.newPage();
await p.setViewport({ width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await addVirtualPasskey(p);
await p.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
await wait(3500);
await p.screenshot({ path: `${dir}01-welcome.png` });
await press(p, /Look around first/);
await wait(1500);
const shots = [['tabNav-diary', '02-log'], ['tabNav-chart', '03-chart'], ['tabNav-mandates', '04-sentences'], ['tabNav-you', '05-vault']];
const wide = [];
for (const [id, name] of shots) {
  await p.tap(`#${id}`);
  await wait(4500);
  await p.evaluate(() => window.scrollTo(0, 0));
  await wait(700);
  await p.screenshot({ path: `${dir}${name}.png` });
  wide.push(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
}
report('screenshots', [['nothing overflows at 360px', !wide.some(Boolean)]], { dir });
await b.close();
