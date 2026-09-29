// Sign up with a passkey and write a sentence on chain, the way a first
// visitor does. Writes to devnet: a new key, a sentence, a vault and a log,
// and the sponsor pays about 0.012 SOL for it. Needs a deployed URL.
//
//   node passkey.mjs [url]
import { addVirtualPasskey, launch, openApp, phonePage, press, report, target, textOf, wait } from './lib.mjs';

const url = target();
const b = await launch();
const p = await phonePage(b);
await addVirtualPasskey(p);
await openApp(p, url, { dismiss: false });
await press(p, /Set up your vault/);
await wait(1000);
const step2 = await textOf(p, '.onboarding-card');
await press(p, /Create a new key/);
await wait(4500);
const writingTo = (await textOf(p, '.onboarding-card')).match(/Writing to \S+/)?.[0];
await press(p, /Write it on chain/);
for (let i = 0; i < 90 && /Signing and sending/.test(await textOf(p, '.onboarding-card')); i++) await wait(1000);
const after = await textOf(p, '.onboarding-card');
const tx = await p.$$eval('a', (as) => as.map((a) => a.href).find((h) => /explorer.solana.com\/tx/.test(h)) ?? null);
await press(p, /Done, take me in/);
await wait(1500);
await p.tap('#tabNav-you').catch(() => {});
await wait(6000);
const vault = await p.evaluate(() => document.body.innerText.match(/Your key:\s*[^\n]*/)?.[0] ?? '');
report('passkey', [
  ['the passkey step is offered', /Create a new key/.test(step2)],
  ['a key was made and the address shown', !!writingTo, writingTo],
  ['the sentence was written', /Written\./.test(after), /Not enough|run out|could not/i.test(after) ? after.slice(-160) : ''],
  ['there is a transaction to check', !!tx, tx ?? ''],
  ['the Vault shows the key unlocked', /Unlocked on this device/.test(vault), vault],
  ['no errors', p.errors.length === 0, p.errors.slice(0, 3).join(' | ')],
]);
await b.close();
