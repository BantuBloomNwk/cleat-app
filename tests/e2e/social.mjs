// The social loop: follow sentences, see their decisions, share a refusal, and
// land on the sentence from the shared link. Writes nothing to chain; follows
// live in this throwaway browser's storage.
//
//   node social.mjs [url]
import fs from 'node:fs';
import { launch, openApp, OUT, phonePage, press, report, target, textOf, wait } from './lib.mjs';

const url = target();
const b = await launch();
const p = await phonePage(b);
// Stand in for the phone's share sheet and keep what it is handed.
await p.evaluateOnNewDocument(() => {
  navigator.canShare = () => true;
  navigator.share = async (d) => {
    const f = d.files?.[0];
    window.__shared = {
      text: d.text,
      img: f ? await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }) : null,
    };
  };
});
await openApp(p, url);
await p.tap('#tabNav-mandates');
await wait(6000);
const followed = await p.$$eval('#published-mandates article button', (bs) => {
  let n = 0;
  for (const x of bs) if (x.textContent.trim() === 'follow') { x.click(); n++; }
  return n;
});
await wait(6000);
const feed = await textOf(p, '#following');
// Only refusals and trims can be shared. The newest decisions are sometimes
// all clears, and then there is simply nothing to share yet.
const shareable = await p.$$eval('#following button', (bs) => bs.filter((x) => /share this/.test(x.textContent)).length);
await press(p, /share this (refusal|trim)/, '#following');
await wait(3000);
const shared = await p.evaluate(() => window.__shared ?? null);
if (shared?.img) fs.writeFileSync(`${OUT}receipt.png`, Buffer.from(shared.img.split(',')[1], 'base64'));
const target_ = shared?.text?.match(/\?s=(\w+)/)?.[1];

const checks = [
  ['sentences can be followed', followed > 0, `${followed} followed`],
  ['the Following feed shows decisions', /Refused|Trimmed|Cleared/.test(feed)],
];
if (shareable === 0) {
  checks.push(['sharing skipped: the newest decisions are all clears', true, 'nothing to share yet']);
} else {
  checks.push(['a refusal shares as an image', !!shared?.img]);
  checks.push(["someone else's refusal is not called mine", !!shared && !/My sentence/.test(shared.text ?? '')]);
  checks.push(['the share carries a link to the sentence', !!target_]);
}
if (target_) {
  const q = await phonePage(b);
  await q.goto(`${url}/?s=${target_}`, { waitUntil: 'networkidle2', timeout: 120000 });
  await wait(6000);
  const land = await q.evaluate(() => ({
    tab: document.querySelector('.dock-tab-btn.active')?.textContent.trim(),
    lit: !!document.querySelector('.deep-linked'),
    sheet: !!document.querySelector('.onboarding-card'),
  }));
  checks.push(['the link opens on Sentences', land.tab === 'Sentences']);
  checks.push(['the linked sentence is highlighted', land.lit]);
  checks.push(['no setup sheet in the way', !land.sheet]);
}
checks.push(['no errors', p.errors.length === 0, p.errors.slice(0, 3).join(' | ')]);
report('social', checks);
await b.close();
