import { Keypair } from '@solana/web3.js';

/**
 * A wallet behind Face ID, with no seed phrase and nothing secret stored.
 *
 * The approach is Ilowa's, ported here because it is already proven in
 * production and it solves a problem that is not obvious until it bites.
 *
 * The obvious design is to generate a random seed, encrypt it, and keep it
 * in browser storage behind a passkey. That fails on iOS. A standalone PWA
 * has its local storage evicted under ITP, the seven day rule and storage
 * pressure, and when it goes the seed goes with it while the passkey
 * survives. The app then mints a brand new wallet on the next open and the
 * user's funds are behind a key nobody has. No web storage survives that,
 * so the fix is not better storage, it is to store nothing.
 *
 * So the seed is derived rather than kept. A discoverable platform passkey
 * is registered with the WebAuthn PRF extension; an assertion against it
 * returns thirty two deterministic bytes keyed to that credential and a
 * fixed salt, and those bytes are the Solana seed. The credential itself
 * lives in iCloud Keychain or Google Password Manager and syncs across the
 * user's devices, so the same face gives the same wallet on a new phone,
 * with nothing to back up and nothing to lose.
 *
 * Older browsers without PRF fall back to a stored seed, which is what
 * everyone had before, so nobody is locked out by the upgrade.
 *
 * Note on why the key is Ed25519 rather than the passkey's own key: Solana
 * verifies Ed25519 on its transaction signatures and WebAuthn produces
 * secp256r1. Solana can verify secp256r1 in a program through the
 * precompile, but a transaction still needs an Ed25519 signer, so a passkey
 * cannot sign one directly. Deriving an Ed25519 key from the passkey keeps
 * the biometric as the only way in without needing a smart wallet program
 * and a relayer in the path.
 */

const RP_NAME = 'Cleat';
const PRF_SALT = new TextEncoder().encode('cleat-wallet-prf-v1');
/** A second, independent derivation for encrypting things kept on device. */
const PRF_SALT_LOCAL = new TextEncoder().encode('cleat-local-secrets-v1');
const MODE_KEY = 'cleat_passkey_mode';
const CRED_KEY = 'cleat_passkey_credid';
const SEED_KEY = 'cleat_passkey_seed';
const SLEEVES_KEY = 'cleat_sleeves';
const ACTIVE_KEY = 'cleat_sleeve_active';

/** A tag so sleeve keys cannot collide with any other use of this passkey. */
const SLEEVE_TAG = new TextEncoder().encode('cleat-sleeve-v1');

/** Browser storage can be absent, full, or throwing. None of that is fatal. */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* a wallet that only works when storage works is the bug above */
    }
  },
  clear() {
    for (const k of [MODE_KEY, CRED_KEY, SEED_KEY, SLEEVES_KEY, ACTIVE_KEY]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* nothing to do */
      }
    }
  },
};

const rpId = () => (typeof location !== 'undefined' ? location.hostname : 'localhost');

const randomBytes = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...u8))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const unb64url = (s: string) => {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const b = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};

const toHex = (u8: Uint8Array) =>
  Array.from(u8).map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** PRF gives arbitrary bytes; hash them to a clean 32 byte Ed25519 root. */
async function rootFromPrf(first: ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', first));
}

/**
 * One passkey, many sleeves.
 *
 * A person does not hold one position. They hold a retirement sleeve they
 * would never touch, a speculative sleeve they check too often, and something
 * in between, and each of those wants its own sentence and its own money. One
 * mandate per person was the wrong shape for that.
 *
 * The obvious fix is to put an index in the program's account seeds, so one
 * key owns many mandates. That works and it costs a redeploy, a republished
 * IDL, and a migration for every account already written. It also publishes
 * the link: every sleeve derived from the same owner key is visibly the same
 * person's, so anyone reading the chain reads the whole portfolio.
 *
 * Deriving instead is cheaper and stricter. The passkey already produces a
 * root through PRF, so hashing that root against an index gives a separate
 * Ed25519 key per sleeve. Each one is its own owner as far as the program is
 * concerned, so each gets its own mandate, its own vault, its own verdict log,
 * its own spending allowance and its own delegation, with nothing in the
 * program to change. On chain the sleeves have no visible relationship to each
 * other, and losing one sleeve's grant does not touch the others.
 *
 * Index zero is the root unchanged, so every key written before sleeves
 * existed is still exactly where it was.
 */
async function sleeveSeed(root: Uint8Array, index: number): Promise<Uint8Array> {
  if (index === 0) return root;
  const buf = new Uint8Array(root.length + SLEEVE_TAG.length + 4);
  buf.set(root, 0);
  buf.set(SLEEVE_TAG, root.length);
  new DataView(buf.buffer).setUint32(root.length + SLEEVE_TAG.length, index, true);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/**
 * The root for this session, so switching sleeve does not ask for the face
 * again.
 *
 * It is the same exposure the unlocked keypair already is: held in memory,
 * gone on reload, never written down. Anything that writes still runs a fresh
 * presence check, so holding this shortens no guarantee, it only stops the
 * app prompting five times to look at five sleeves.
 */
let sessionRoot: Uint8Array | null = null;

export interface Sleeve {
  index: number;
  name: string;
}

const DEFAULT_SLEEVE: Sleeve = { index: 0, name: 'Main' };

export function listSleeves(): Sleeve[] {
  try {
    const raw = store.get(SLEEVES_KEY);
    if (!raw) return [DEFAULT_SLEEVE];
    const parsed = JSON.parse(raw) as Sleeve[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_SLEEVE];
    return parsed
      .filter((x) => Number.isInteger(x?.index) && x.index >= 0)
      .map((x) => ({ index: x.index, name: String(x.name || `Sleeve ${x.index}`) }))
      .sort((a, b) => a.index - b.index);
  } catch {
    return [DEFAULT_SLEEVE];
  }
}

function writeSleeves(list: Sleeve[]) {
  store.set(SLEEVES_KEY, JSON.stringify(list));
}

export function activeSleeve(): number {
  const raw = Number(store.get(ACTIVE_KEY));
  const list = listSleeves();
  return list.some((s) => s.index === raw) ? raw : list[0].index;
}

export function setActiveSleeve(index: number) {
  store.set(ACTIVE_KEY, String(index));
}

/** Add a sleeve at the next free index. The key for it is derived, not made. */
export function addSleeve(name: string): Sleeve {
  const list = listSleeves();
  const index = list.reduce((m, s) => Math.max(m, s.index), 0) + 1;
  const sleeve: Sleeve = { index, name: name.trim() || `Sleeve ${index}` };
  writeSleeves([...list, sleeve]);
  return sleeve;
}

export function renameSleeve(index: number, name: string) {
  writeSleeves(
    listSleeves().map((s) => (s.index === index ? { ...s, name: name.trim() || s.name } : s)),
  );
}

/**
 * Forget a sleeve on this device.
 *
 * It does not and cannot destroy anything. The key is derived from the
 * passkey, so the same index reproduces the same key and whatever is in that
 * vault stays reachable by adding the sleeve back. This only tidies the list.
 */
export function forgetSleeve(index: number) {
  if (index === 0) return;
  const left = listSleeves().filter((s) => s.index !== index);
  writeSleeves(left.length ? left : [DEFAULT_SLEEVE]);
  if (activeSleeve() === index) setActiveSleeve(left.length ? left[0].index : 0);
}

export function passkeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials
  );
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Which kind of key this browser ended up with.
 *
 * `prf` means the seed is reproduced from the passkey itself, so the same
 * passkey on another device gives the same key. `stored` means the
 * authenticator would not do PRF and the seed lives in this browser's
 * storage, which iOS will eventually evict. The app quietly downgraded between
 * the two and never said which one had happened, which is the difference
 * between a key that follows you and one that does not.
 */
/**
 * Ask for the face or the finger before doing something that writes.
 *
 * Unlocking puts a keypair in memory, and everything after that could then
 * sign in silence. That is convenient and it is not what somebody expects from
 * a product that keeps saying the key never leaves your device: writing a
 * mandate or moving money should feel like an act, and an act you were asked
 * about. So every write asks again.
 *
 * It is a presence check, not a second derivation. The key is already here.
 * What this establishes is that the person is too.
 */
export async function confirmPresence(): Promise<boolean> {
  const credId = store.get(CRED_KEY) ?? undefined;
  try {
    return !!(await deriveViaAssertion(credId));
  } catch {
    return false;
  }
}

export function walletSyncMode(): 'prf' | 'stored' | null {
  const m = store.get(MODE_KEY);
  return m === 'prf' || m === 'stored' ? m : null;
}

export function hasWallet(): boolean {
  const mode = store.get(MODE_KEY);
  return (mode === 'prf' && !!store.get(CRED_KEY)) || !!store.get(SEED_KEY);
}

/**
 * Run an assertion and derive the wallet from it.
 *
 * Omitting credId makes it discoverable, which is the restore path: the
 * platform surfaces the synced Cleat passkey and PRF reproduces the same
 * seed even on a device that has never seen this app.
 */
async function deriveViaAssertion(
  credId?: string,
): Promise<{ root: Uint8Array; credId: string } | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rpId: rpId(),
      allowCredentials: credId
        ? [{ type: 'public-key', id: unb64url(credId) as BufferSource }]
        : [],
      userVerification: 'required',
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: PRF_SALT as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('That was cancelled, or the check did not pass.');

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) return null;

  const root = await rootFromPrf(first);
  sessionRoot = root;
  return { root, credId: b64url(assertion.rawId) };
}

/**
 * The key for one sleeve.
 *
 * Uses the session root when there is one, and otherwise asks the passkey,
 * which is what happens on a device that has just been opened.
 */
export async function deriveSleeve(index: number): Promise<Keypair> {
  if (sessionRoot) return Keypair.fromSeed(await sleeveSeed(sessionRoot, index));

  if (store.get(MODE_KEY) === 'stored') {
    const hex = store.get(SEED_KEY);
    if (!hex) throw new Error('The saved key is gone from this browser.');
    return Keypair.fromSeed(await sleeveSeed(fromHex(hex), index));
  }

  const derived = await deriveViaAssertion(store.get(CRED_KEY) ?? undefined);
  if (!derived) throw new Error('This device could not reproduce the key from that passkey.');
  return Keypair.fromSeed(await sleeveSeed(derived.root, index));
}

/** Register a passkey and provision the wallet behind it. */
export async function createWallet(): Promise<Keypair> {
  if (!passkeySupported()) {
    throw new Error(
      'This browser cannot do passkeys. On an iPhone, open Cleat in Safari and add it to your Home Screen.',
    );
  }
  if (!(await platformAuthenticatorAvailable())) {
    throw new Error(
      'Face ID or a fingerprint is not available here. On an iPhone, use Safari and add Cleat to your Home Screen, then try again.',
    );
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: RP_NAME, id: rpId() },
      user: {
        id: randomBytes(16) as BufferSource,
        name: 'cleat-wallet',
        displayName: 'Cleat',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        // Discoverable, so the credential can be found again on a device
        // that has never seen this app and has nothing stored for it.
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: {
        prf: { eval: { first: PRF_SALT as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Setting up the passkey was cancelled.');

  const credId = b64url(cred.rawId);

  try {
    // Some browsers hand back PRF from create() with no second prompt.
    // Safari only returns it from an assertion, so ask again if needed.
    const ext = cred.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    };
    const atCreate = ext.prf?.results?.first;
    if (atCreate) {
      store.set(MODE_KEY, 'prf');
      store.set(CRED_KEY, credId);
      sessionRoot = await rootFromPrf(atCreate);
      return Keypair.fromSeed(await sleeveSeed(sessionRoot, 0));
    }
    const derived = await deriveViaAssertion(credId);
    if (derived) {
      store.set(MODE_KEY, 'prf');
      store.set(CRED_KEY, derived.credId);
      return Keypair.fromSeed(await sleeveSeed(derived.root, 0));
    }
  } catch {
    /* fall through to the stored seed path */
  }

  // No PRF on this authenticator. Keep a seed, which is what every passkey
  // wallet did before PRF existed, so this browser is no worse off.
  const seed = randomBytes(32);
  store.set(MODE_KEY, 'stored');
  store.set(CRED_KEY, credId);
  store.set(SEED_KEY, toHex(seed));
  sessionRoot = seed;
  return Keypair.fromSeed(await sleeveSeed(seed, 0));
}

/** Unlock the existing wallet. Falls back to discoverable if nothing is known. */
export async function unlockWallet(index = 0): Promise<Keypair> {
  const mode = store.get(MODE_KEY);
  const credId = store.get(CRED_KEY) ?? undefined;

  if (mode === 'stored') {
    const hex = store.get(SEED_KEY);
    if (!hex) throw new Error('The saved key is gone from this browser.');
    // Ask for the face, and then actually care about the answer.
    //
    // This used to call the assertion and throw the result away, so the
    // comment claimed the key was not usable just by having the tab while the
    // code handed it over whether the assertion succeeded, failed or was
    // cancelled. A check whose result is discarded is not a check, it is a
    // delay, and in stored mode it was the only thing standing between an open
    // tab and the key.
    let proved = false;
    try {
      proved = !!(await deriveViaAssertion(credId));
    } catch {
      proved = false;
    }
    if (!proved) {
      throw new Error('That was not confirmed, so the key stays locked.');
    }
    const seed = fromHex(hex);
    sessionRoot = seed;
    return Keypair.fromSeed(await sleeveSeed(seed, index));
  }

  const derived = await deriveViaAssertion(credId);
  if (derived) return Keypair.fromSeed(await sleeveSeed(derived.root, index));
  throw new Error('This device could not reproduce the key from that passkey.');
}

/**
 * Recover on a device that has never seen this app.
 *
 * Nothing local is consulted. The platform is asked to show whatever Cleat
 * passkeys the user has, and PRF turns the chosen one back into the same
 * wallet it always was.
 */
export async function restoreWallet(index = 0): Promise<Keypair> {
  const derived = await deriveViaAssertion();
  if (!derived) {
    throw new Error('That passkey cannot rebuild a key on this browser.');
  }
  store.set(MODE_KEY, 'prf');
  store.set(CRED_KEY, derived.credId);
  return Keypair.fromSeed(await sleeveSeed(derived.root, index));
}

/** Forget this browser's pointer to the wallet. The passkey itself survives. */
export function forgetLocal() {
  sessionRoot = null;
  store.clear();
}

/** Drop the session root. Used when locking, so a closed session is closed. */
export function clearSessionRoot() {
  sessionRoot = null;
}

/**
 * A key for encrypting things this browser has to keep, derived from the
 * same passkey and a different salt.
 *
 * The problem it solves: a provider API key sitting in localStorage in
 * plain text is readable by anything that gets script execution on this
 * origin, and it stays readable afterwards because the file persists.
 * Encrypting it under a key that only exists while the passkey has been
 * used turns the stored artifact into something useless on its own.
 *
 * This does not stop an attacker who is executing inside a live session,
 * who can read the decrypted value out of memory. It stops the much more
 * likely case: something that can read storage once, or a device that is
 * later picked up by someone else.
 *
 * A different salt from the wallet's, so this key cannot reconstruct the
 * wallet and the wallet's seed cannot decrypt these.
 */
export async function deriveLocalSecretKey(): Promise<CryptoKey> {
  const credId = store.get(CRED_KEY) ?? undefined;
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rpId: rpId(),
      allowCredentials: credId
        ? [{ type: 'public-key', id: unb64url(credId) as BufferSource }]
        : [],
      userVerification: 'required',
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: PRF_SALT_LOCAL as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('That was cancelled.');

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) throw new Error('This device cannot derive a local key from that passkey.');

  const raw = await crypto.subtle.digest('SHA-256', first);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Seal a string so that what lands on disk is meaningless by itself. */
export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${b64url(iv)}.${b64url(ct)}`;
}

export async function unseal(key: CryptoKey, sealed: string): Promise<string> {
  const [ivPart, ctPart] = sealed.split('.');
  if (!ivPart || !ctPart) throw new Error('That stored value is not in the expected shape.');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64url(ivPart) as BufferSource },
    key,
    unb64url(ctPart) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
