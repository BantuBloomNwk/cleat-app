/**
 * A refusal receipt: one decision, drawn as a card somebody can post.
 *
 * Refusal first on purpose. A refusal is the safest thing in the product to
 * share, because nothing touched a market: it carries the sentence, the rule
 * that said no, the sector and when, and never a company or an amount. It
 * links to the sentence, not to the transaction.
 */
import { SECTORS, reasonText } from './chain';

export interface Receipt {
  sentence: string;
  mandate: string;
  outcome: number; // 0 cleared, 1 trimmed, 2 refused
  reason: number;
  category: number;
  proposedBps: number;
  allowedBps: number;
  when: Date;
  /** Whose it is. Posting someone else's decision cannot say "my sentence". */
  theirs?: boolean;
}

const WORD = ['CLEARED', 'TRIMMED', 'REFUSED'];
const INK = ['#4ec2a5', '#e0ac3c', '#e8553e'];
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

export const receiptLink = (mandate: string) => `${location.origin}/?s=${mandate}`;

export function receiptText(r: Receipt): string {
  const why = reasonText(r.reason).replace(/^Triggered boundary: /, '');
  const [agent, sentence] = r.theirs ? ['An agent', 'This sentence'] : ['My agent', 'My sentence'];
  const sector = SECTORS[r.category] ?? 'a sector';
  const what = r.outcome === 2
    ? `${agent} asked for ${pct(r.proposedBps)} into ${sector}. ${sentence} said no: ${why.toLowerCase()}.`
    : r.outcome === 1
      ? `${agent} asked for ${pct(r.proposedBps)} into ${sector}. ${sentence} cut it to ${pct(r.allowedBps)}: ${why.toLowerCase()}.`
      : `${agent} asked for ${pct(r.allowedBps)} into ${sector} and it cleared every line.`;
  return `"${r.sentence}"\n\n${what}\n\nDecided on Solana, not by the agent.`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** 1080 square, in the app's colours. */
export async function receiptImage(r: Receipt): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1080;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try { await document.fonts.ready; } catch { /* system fonts will do */ }
  ctx.fillStyle = '#0c0b0a'; ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = INK[r.outcome]; ctx.fillRect(0, 0, 1080, 14);

  ctx.fillStyle = '#b3ada3';
  ctx.font = '600 30px "JetBrains Mono", monospace';
  ctx.fillText('CLEAT  ·  A DECISION ON SOLANA', 80, 120);

  ctx.fillStyle = INK[r.outcome];
  ctx.font = '800 150px "Space Grotesk", sans-serif';
  ctx.fillText(WORD[r.outcome], 72, 300);

  ctx.fillStyle = '#ece8e1';
  ctx.font = 'italic 500 54px "Fraunces", Georgia, serif';
  const lines = wrap(ctx, `“${r.sentence}”`, 920).slice(0, 5);
  lines.forEach((l, i) => ctx.fillText(l, 80, 420 + i * 70));

  const y = 420 + lines.length * 70 + 60;
  ctx.fillStyle = '#b3ada3';
  ctx.font = '500 34px "Plus Jakarta Sans", sans-serif';
  const why = reasonText(r.reason).replace(/^Triggered boundary: /, '');
  const facts = [
    `Asked for ${pct(r.proposedBps)} of the book into ${SECTORS[r.category] ?? 'a sector'}`,
    r.outcome === 0 ? 'Inside every line' : `Because: ${why.toLowerCase()}`,
    r.when.toUTCString().replace(/:\d\d GMT$/, ' UTC'),
  ];
  facts.forEach((f, i) => wrap(ctx, f, 920).slice(0, 2).forEach((l, j) => ctx.fillText(l, 80, y + i * 64 + j * 44)));

  ctx.fillStyle = '#6f6a62';
  ctx.font = '500 28px "JetBrains Mono", monospace';
  ctx.fillText('No company, no amount. Decided on chain, not by the agent.', 80, 1000);

  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/**
 * Share it however this device can. A phone's share sheet with the image
 * when it has one; otherwise a post to X with the words and the link.
 */
export async function shareReceipt(r: Receipt): Promise<'shared' | 'x' | 'cancelled'> {
  const text = receiptText(r);
  const url = receiptLink(r.mandate);
  try {
    const blob = await receiptImage(r);
    const file = blob ? new File([blob], 'cleat-decision.png', { type: 'image/png' }) : null;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (file && nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text: `${text}\n${url}` });
      return 'shared';
    }
    if (nav.share) {
      await nav.share({ text, url });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
  }
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
  return 'x';
}
