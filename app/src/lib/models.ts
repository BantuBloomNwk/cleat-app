/**
 * Which model the agent thinks with, and who pays for it.
 *
 * Three tiers, and the reason there are three is not choice for its own
 * sake. PRODUCT.md already argues the model has to be swappable so that
 * the boundary is obviously what does the work, and you demonstrate that
 * by switching it mid demo and watching the same refusal land. What
 * follows is what swappable has to mean in practice.
 *
 *   own key    the client's own account at a provider. The key is kept on
 *              their device and the call goes from their browser straight
 *              to the provider. It never reaches us, so we never pay for
 *              it and never see the prompt.
 *   metered    no key needed. The agent pays per call out of the on chain
 *              allowance, over x402. Convenient, and it costs the client
 *              money rather than us.
 *   local      a model on the client's own machine. Nothing leaves the
 *              device at all.
 *
 * The privacy ordering is the reverse of the convenience ordering, which
 * is the usual shape and worth saying out loud rather than hiding.
 *
 * ## What actually needs a model, and what does not
 *
 * Only the proposing side. Refusal is deterministic and on chain: the caps
 * live in the mandate account, the check runs in the program, and no model
 * is consulted. So an agent with no model, no key and no allowance stops
 * having ideas. It cannot degrade into guessing and it cannot degrade into
 * acting.
 *
 * The one genuinely sensitive prompt is compiling the client's sentence,
 * because that sentence is the only private thing the agent ever sees. A
 * client who cares should compile locally or with their own key; the
 * proposing loop reads public market data and leaks nothing by being
 * hosted.
 */

export type Tier = 'own-key' | 'metered' | 'local';

export interface Provider {
  id: string;
  name: string;
  tier: Tier;
  /** Where the browser sends the request. Local models are on the device. */
  endpoint: string;
  /** What the client should understand about privacy, in one sentence. */
  privacy: string;
  /** Whether this one can run with nothing configured. */
  needsKey: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    tier: 'own-key',
    endpoint: 'https://api.anthropic.com/v1/messages',
    privacy: 'Your key, your account, straight from your browser. We never see the key or the prompt.',
    needsKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tier: 'own-key',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    privacy: 'Your key, your account, straight from your browser. We never see the key or the prompt.',
    needsKey: true,
  },
  {
    id: 'google',
    name: 'Gemini',
    tier: 'own-key',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    privacy: 'Your key, your account, straight from your browser. We never see the key or the prompt.',
    needsKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama, on this machine',
    tier: 'local',
    endpoint: 'http://localhost:11434/api/chat',
    privacy: 'Nothing leaves your device. The most private option and the one that needs the most setup.',
    needsKey: false,
  },
  {
    id: 'metered',
    name: 'Pay per call',
    tier: 'metered',
    endpoint: '/api/inference',
    privacy:
      'No key to manage. The agent pays for each call out of the allowance you set on chain, and the prompt passes through our proxy.',
    needsKey: false,
  },
];

import { deriveLocalSecretKey, seal, unseal } from './passkey';

const KEY_PREFIX = 'cleat_model_key_';
const CHOICE_KEY = 'cleat_model_choice';

/**
 * Keys live in this browser, sealed, and are never transmitted to us.
 *
 * Deliberately not sent anywhere for safekeeping. A provider key is the
 * client's own credential at somebody else's company, and the only honest
 * place for it is their device. Clearing the browser loses it, which is
 * correct: we cannot lose what we never held.
 *
 * What lands on disk is ciphertext, under a key derived from the same
 * passkey with a different salt. The reason is a smaller attack than it
 * sounds and a more likely one: a plain text key in localStorage stays
 * readable forever by anything that gets one moment of script execution,
 * and by anyone who picks the device up later. Sealed, the stored file is
 * useless on its own.
 *
 * It does not defend against an attacker executing inside a live session,
 * who can read the decrypted value out of memory while it is in use. That
 * is a genuinely harder attack and it is not what this is for.
 *
 * The decrypted key is held in memory for the session and never written
 * back out.
 */
const live = new Map<string, string>();

export const keyStore = {
  /** The decrypted key, if this session has already unsealed it. */
  get(providerId: string): string | null {
    return live.get(providerId) ?? null;
  },

  /** Ask the passkey once, then unseal whatever this browser has stored. */
  async unlock(): Promise<number> {
    let secret: CryptoKey;
    try {
      secret = await deriveLocalSecretKey();
    } catch {
      return 0;
    }
    let opened = 0;
    for (const p of PROVIDERS) {
      let sealed: string | null = null;
      try {
        sealed = localStorage.getItem(KEY_PREFIX + p.id);
      } catch {
        sealed = null;
      }
      if (!sealed) continue;
      try {
        live.set(p.id, await unseal(secret, sealed));
        opened++;
      } catch {
        /* written under a different passkey, or corrupt. Leave it. */
      }
    }
    return opened;
  },

  async set(providerId: string, key: string) {
    live.set(providerId, key);
    try {
      const secret = await deriveLocalSecretKey();
      localStorage.setItem(KEY_PREFIX + providerId, await seal(secret, key));
    } catch {
      // Sealing failed, so this key lives for the session and is not
      // written. Better than writing it in the clear.
    }
  },

  clear(providerId: string) {
    live.delete(providerId);
    try {
      localStorage.removeItem(KEY_PREFIX + providerId);
    } catch {
      /* nothing to do */
    }
  },

  /** Whether a key is usable right now, which needs it unsealed. */
  has(providerId: string) {
    return live.has(providerId);
  },

  /** Whether something is stored, even if this session has not opened it. */
  stored(providerId: string) {
    try {
      return !!localStorage.getItem(KEY_PREFIX + providerId);
    } catch {
      return false;
    }
  },
};

export function chosenProvider(): Provider {
  let id: string | null = null;
  try {
    id = localStorage.getItem(CHOICE_KEY);
  } catch {
    /* fall through to the default */
  }
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

export function chooseProvider(id: string) {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    /* the choice just will not persist */
  }
}

/** Whether the chosen provider can actually be used right now. */
export function providerReady(p: Provider): boolean {
  return !p.needsKey || keyStore.has(p.id);
}
