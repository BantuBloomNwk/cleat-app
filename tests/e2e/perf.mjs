// How the app feels on a budget phone: each tab opened and scrolled with the
// CPU slowed six times, which is roughly a Galaxy A13. Numbers, not a verdict,
// because a software renderer cannot judge scrolling the way a phone's GPU
// does. Compare runs before and after a change.
//
//   node perf.mjs [url]            (add ?lite=1 to the url to force lite mode)
import { TABS, launch, openApp, phonePage, report, target, wait } from './lib.mjs';

const url = target();
const b = await launch({ webgl: true });
const p = await phonePage(b);
await openApp(p, url);
const cdp = await p.target().createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
const lite = await p.evaluate(() => document.documentElement.classList.contains('lite'));
const numbers = { lite };
for (const [id, name] of TABS.slice(1).concat([TABS[0]])) {
  const t = Date.now();
  await p.tap(`#${id}`);
  await p.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});
  const openMs = Date.now() - t;
  const scroll = await p.evaluate(async () => {
    const gaps = []; let last = performance.now(); let run = true;
    const tick = (now) => { gaps.push(now - last); last = now; if (run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const H = document.documentElement.scrollHeight;
    for (let y = 0; y < Math.min(H, 4000); y += 60) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 16)); }
    run = false; window.scrollTo(0, 0);
    return { frames: gaps.length, slowFrames: gaps.filter((g) => g > 50).length, worstMs: Math.round(Math.max(...gaps)) };
  });
  numbers[name] = { openMs, ...scroll };
  await wait(300);
}
console.log(JSON.stringify(numbers, null, 1));
report('perf', [['no errors under a slow CPU', p.errors.length === 0, p.errors.slice(0, 3).join(' | ')]], { numbers });
await b.close();
