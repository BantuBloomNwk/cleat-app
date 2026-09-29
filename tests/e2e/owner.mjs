// The controls only an owner has: stop everything and start again, keep a
// sentence out of the room, and delete the account. Makes a fresh passkey
// account first, so it never touches anyone else's. Writes to devnet, and
// finishes by deleting what it made, which returns the rent.
//
//   node owner.mjs [url]
import { addVirtualPasskey, launch, openApp, phonePage, press, report, target, textOf, wait } from './lib.mjs';

const url = target();
const b = await launch();
const p = await phonePage(b);
await addVirtualPasskey(p);
await openApp(p, url, { dismiss: false });
await press(p, /Set up your vault/);
await wait(1000);
await press(p, /Create a new key/);
await wait(4500);
await press(p, /Write it on chain/);
for (let i = 0; i < 90 && /Signing and sending/.test(await textOf(p, '.onboarding-card')); i++) await wait(1000);
const written = /Written\./.test(await textOf(p, '.onboarding-card'));
await press(p, /Done, take me in/);
await wait(1500);
await p.tap('#tabNav-you');
await wait(5000);

/** Press, then wait until the panel stops saying it is busy. */
const act = async (re) => {
  const pressed = await press(p, re, '#owner-controls');
  await wait(800);
  for (let i = 0; i < 60 && /Sending…|Deleting…/.test(await textOf(p, '#owner-controls')); i++) await wait(1000);
  return pressed;
};
await act(/Stop everything/);
const stopped = /Start again/.test(await textOf(p, '#owner-controls'));
await act(/Start again/);
const started = /Stop everything/.test(await textOf(p, '#owner-controls'));
await act(/Keep it out of the room/);
const hidden = /Put it back in the room/.test(await textOf(p, '#owner-controls'));
await act(/Delete my account/);
const deleted = await press(p, /Yes, delete everything/, '#owner-controls');
await wait(9000);
// After deleting, the page reloads with nothing of the account left on it.
const gone = !(await p.evaluate(() => /Unlocked on this device/.test(document.body.innerText)));
report('owner', [
  ['a fresh account was written', written],
  ['stop everything lands on chain', stopped],
  ['start again lands on chain', started],
  ['keep it out of the room lands on chain', hidden],
  ['delete was confirmed', !!deleted],
  ['the account is gone from the device', gone],
  ['no page errors', p.errors.filter((e) => e.startsWith('pageerror')).length === 0],
]);
await b.close();
