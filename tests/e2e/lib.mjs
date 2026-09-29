// Shared by every check here: a phone-sized browser, a virtual passkey, and a
// few ways to find and press things by what they say.
//
// Chrome or Chromium is needed. CHROME_PATH points at it; the default is where
// Debian and Kali put Chromium. Screenshots and reports go to ./out.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export const URL_DEFAULT = 'https://cleat-preview.netlify.app';
export const target = () => process.argv.find((a) => a.startsWith('http')) ?? process.env.CLEAT_URL ?? URL_DEFAULT;
export const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

/** A Seeker, roughly. A Galaxy A13 is the same width at a lower density. */
export const PHONE = { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Seeker) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ webgl = false, profile } = {}) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  // Software WebGL, so the 3D robot and the chart render without a GPU.
  if (webgl) args.push('--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader');
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
    headless: 'new',
    args,
    userDataDir: profile,
  });
}

/** A page dressed as an Android phone that records every error it sees. */
export async function phonePage(browser, { cpuSlowdown = 1 } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(ANDROID_UA);
  await page.setViewport(PHONE);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 400) page.errors.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`); });
  if (cpuSlowdown > 1) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
  }
  return page;
}

/**
 * A platform passkey that says yes to everything, PRF included. Passkeys only
 * work on a real origin, so these checks run against a deployed URL, not a
 * local preview on 127.0.0.1.
 */
export async function addVirtualPasskey(page) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      automaticPresenceSimulation: true, hasPrf: true,
    },
  });
}

/** Press the first enabled button whose text matches, inside `within`. */
export const press = (page, re, within = 'body') =>
  page.evaluate((src, root) => {
    const b = [...(document.querySelector(root)?.querySelectorAll('button') ?? [])]
      .find((x) => new RegExp(src).test(x.textContent) && !x.disabled);
    if (b) { b.click(); return b.textContent.trim().replace(/\s+/g, ' '); }
    return null;
  }, re.source, within);

export const textOf = (page, sel) =>
  page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

/** Open the app and get past the setup sheet, as a first visit would. */
export async function openApp(page, url, { dismiss = true } = {}) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
  await wait(2500);
  if (dismiss) { await press(page, /Look around first/); await wait(800); }
}

export const TABS = [['tabNav-diary', 'log'], ['tabNav-chart', 'chart'], ['tabNav-mandates', 'sentences'], ['tabNav-you', 'vault']];

/** Pass or fail, printed, and the exit code a script runner can read. */
export function report(name, checks, extra = {}) {
  const failed = checks.filter(([, ok]) => !ok);
  for (const [what, ok, detail] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  fs.writeFileSync(`${OUT}${name}.json`, JSON.stringify({ checks, ...extra }, null, 2));
  console.log(failed.length ? `\n${name}: ${failed.length} failed` : `\n${name}: all passed`);
  process.exitCode = failed.length ? 1 : 0;
}
