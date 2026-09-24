import { PROVIDERS, chosenProvider, keyStore, type Provider } from './models';

/**
 * The agent having an idea, using whichever model the client brought.
 *
 * This is the only place in Cleat a language model is consulted, and that is
 * deliberate rather than incidental. Refusal is deterministic and on chain:
 * the caps live in the mandate account, the check runs in the program, and
 * no model is asked. So the worst a bad model can do is propose something
 * stupid, which the sentence then refuses, which is the whole argument the
 * product makes. An agent with no model and no key simply stops having
 * ideas; it cannot degrade into guessing and it cannot degrade into acting.
 *
 * The call goes from the browser straight to the provider. Not through us,
 * because the client's key is their credential at somebody else's company
 * and routing it through our origin would mean holding it, and because the
 * three provider hosts are already the only outside origins the content
 * policy allows for exactly this reason.
 *
 * What comes back is parsed strictly and clamped. A model that returns prose,
 * a sector that does not exist, or nineteen thousand basis points gets
 * refused here rather than being passed to a gate that would have to refuse
 * it anyway. Being strict at the boundary is cheaper than being clever
 * afterwards.
 */

export const SECTORS = [
  'Unspecified',
  'Technology',
  'Energy',
  'Healthcare',
  'Financials',
  'Consumer',
] as const;

export interface Draft {
  /** Index into SECTORS. */
  category: number;
  /** Size of the ask, in basis points of the book. */
  bps: number;
  /** 0 to add, 1 to reduce. */
  side: number;
  /** The agent's own one line reason, in its words. */
  why: string;
}

const SYSTEM = [
  'You are an order entry assistant for a self directed account.',
  'Turn the request into one proposal and nothing else.',
  'Reply with only a JSON object, no prose and no code fence, shaped exactly:',
  '{"sector":"<one of: Technology, Energy, Healthcare, Financials, Consumer>",',
  ' "bps":<integer 1 to 2000, the size as basis points of the book>,',
  ' "side":<0 to add, 1 to reduce>,',
  ' "why":"<one short sentence, under 120 characters>"}',
  'One percent is 100 bps. Never give advice, never predict a price, and',
  'never mention a company by name. If the request names no sector, use the',
  'closest one. If it names no size, use 200.',
].join(' ');

/** Everything a provider can go wrong with, said in one line a person reads. */
export class ProposeError extends Error {}

async function callAnthropic(key: string, intent: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Without this the API refuses a request that carries an Origin, which
      // is every request a browser makes. It is the documented opt in for
      // calling from a page, and it is the whole point of bring your own key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: intent }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new ProposeError(body?.error?.message ?? `Claude said ${res.status}`);
  return String(body?.content?.[0]?.text ?? '');
}

async function callOpenAI(key: string, intent: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: intent },
      ],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new ProposeError(body?.error?.message ?? `OpenAI said ${res.status}`);
  return String(body?.choices?.[0]?.message?.content ?? '');
}

async function callGemini(key: string, intent: string): Promise<string> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
    encodeURIComponent(key);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: intent }] }],
      generationConfig: { maxOutputTokens: 200 },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new ProposeError(body?.error?.message ?? `Gemini said ${res.status}`);
  return String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function callOllama(intent: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: intent },
        ],
      }),
    });
  } catch {
    throw new ProposeError(
      'Nothing answered on localhost:11434. Start Ollama and pull a model first.',
    );
  }
  const body = await res.json();
  if (!res.ok) throw new ProposeError(`Ollama said ${res.status}`);
  return String(body?.message?.content ?? '');
}

/**
 * Read a model's answer without trusting it.
 *
 * Models put fences round JSON, add a sentence before it, and occasionally
 * return a number where a string belongs. Pulling the first brace to the last
 * and clamping every field afterwards handles all three without a schema
 * library, and anything left over after that was never going to be a trade.
 */
function parse(text: string): Draft {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new ProposeError('The model answered in prose rather than a proposal.');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    throw new ProposeError('The model answered with something that is not a proposal.');
  }

  const name = String(raw.sector ?? '').trim().toLowerCase();
  const category = SECTORS.findIndex((s) => s.toLowerCase() === name);
  const bps = Math.round(Number(raw.bps));
  const side = Number(raw.side) === 1 ? 1 : 0;
  const why = String(raw.why ?? '').slice(0, 160);

  if (category < 1) throw new ProposeError(`No sector called "${raw.sector}" exists here.`);
  if (!Number.isFinite(bps) || bps < 1) throw new ProposeError('The model asked for no size.');

  // Clamped rather than refused. Two thousand basis points is a fifth of the
  // book and no sentence in this app allows anything near it, so the gate
  // will refuse it on the merits, which is a better answer than an error.
  return { category, bps: Math.min(bps, 2000), side, why };
}

export async function draftProposal(intent: string): Promise<{ draft: Draft; provider: Provider }> {
  const provider = chosenProvider();
  const key = keyStore.get(provider.id);
  if (provider.needsKey && !key) {
    throw new ProposeError(`Add your ${provider.name} key first, then it can think.`);
  }

  let text: string;
  switch (provider.id) {
    case 'anthropic': text = await callAnthropic(key!, intent); break;
    case 'openai': text = await callOpenAI(key!, intent); break;
    case 'google': text = await callGemini(key!, intent); break;
    case 'ollama': text = await callOllama(intent); break;
    default: throw new ProposeError(`${provider.name} is not wired up.`);
  }
  return { draft: parse(text), provider };
}

export const providerList = PROVIDERS;
