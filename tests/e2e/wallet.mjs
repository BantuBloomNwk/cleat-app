// Sign up with a wallet instead of a passkey, using a stand-in Wallet
// Standard wallet that holds a real ed25519 key, then write a sentence on
// chain. Proves the whole wallet door except the wallet app itself, which
// only a phone can test. Writes to devnet like passkey.mjs.
//
//   node wallet.mjs [url]
import { launch, openApp, PHONE, press, report, target, textOf, wait } from './lib.mjs';

const url = target();
const b = await launch();
const p = await b.newPage();
await p.setViewport(PHONE);
p.errors = [];
p.on('pageerror', (e) => p.errors.push(e.message));
p.on('console', (m) => { if (m.text().startsWith('[mock]')) p.log = [...(p.log ?? []), m.text()]; });
await p.evaluateOnNewDocument(() => {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes) => { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of bytes) { if (x === 0) s = '1' + s; else break; } return s; };
  const readLen = (u, o) => { let len = 0, size = 0; for (;;) { const e = u[o + size]; len |= (e & 0x7f) << (size * 7); size++; if (!(e & 0x80)) break; } return [len, size]; };
  const keyP = crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const acct = keyP.then(async (k) => { const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey)); return { publicKey: pub, address: b58(pub), chains: ['solana:devnet'], features: ['solana:signTransaction', 'solana:signMessage'] }; });
  const sign = async (bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', (await keyP).privateKey, bytes));
  const wallet = {
    version: '1.0.0', name: 'Test Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { const a = await acct; wallet.accounts = [a]; console.log('[mock] connected'); return { accounts: [a] }; } },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signMessage': { version: '1.0.0', signMessage: async (...ins) => Promise.all(ins.map(async (i) => ({ signedMessage: i.message, signature: await sign(i.message) }))) },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], signTransaction: async (...ins) => Promise.all(ins.map(async (i) => {
        const tx = new Uint8Array(i.transaction); const [nSig, sz] = readLen(tx, 0); const msg = tx.slice(sz + nSig * 64);
        const [nKeys, ksz] = readLen(msg, 3); const me = (await acct).publicKey; let idx = -1;
        for (let k = 0; k < Math.min(msg[0], nKeys); k++) { const key = msg.slice(3 + ksz + k * 32, 3 + ksz + (k + 1) * 32); if (key.every((v, j) => v === me[j])) idx = k; }
        if (idx < 0) throw new Error('not a signer on this transaction');
        const out = tx.slice(); out.set(await sign(msg), sz + idx * 64); console.log('[mock] signed'); return { signedTransaction: out };
      })) },
    },
  };
  const reg = ({ register }) => register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => reg(e.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: reg }));
});
await openApp(p, url, { dismiss: false });
await press(p, /Set up your vault/);
await wait(1000);
const door = await press(p, /Use a Solana wallet|Use the wallet on this phone/);
await wait(3000);
await press(p, /Write it on chain/);
for (let i = 0; i < 90 && /Signing and sending/.test(await textOf(p, '.onboarding-card')); i++) await wait(1000);
const after = await textOf(p, '.onboarding-card');
report('wallet', [
  ['the wallet door is offered', !!door, door ?? ''],
  ['the wallet connected', (p.log ?? []).includes('[mock] connected')],
  ['the wallet signed', (p.log ?? []).includes('[mock] signed')],
  ['the sentence was written', /Written\./.test(after), after.slice(-160)],
  ['no page errors', p.errors.length === 0, p.errors.slice(0, 3).join(' | ')],
]);
await b.close();
