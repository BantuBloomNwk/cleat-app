/**
 * What has happened since you last looked.
 *
 * The log was written to be read once. It is a beautiful record of every
 * decision ever made and it gives somebody who already knows the product no
 * reason at all to open it on a Tuesday, because the top of it looks the
 * same as it did yesterday.
 *
 * So remember where they got to. One number and one timestamp, per account,
 * in this browser. Nothing is sent anywhere and nothing is worth anything to
 * anyone who steals it: it is a count of decisions the chain already
 * publishes, and the reason it lives here rather than on chain is that where
 * somebody stopped reading is not a fact about the account, it is a fact
 * about the person, and the account is public.
 */

const KEY = 'cleat_last_seen';

export interface Seen {
  /** Total decisions in the log the last time this account was looked at. */
  count: number;
  /** When that was, so the copy can say Tuesday rather than a number. */
  at: number;
}

type Store = Record<string, Seen>;

const read = (): Store => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
};

export function lastSeen(owner: string | null | undefined): Seen | null {
  if (!owner) return null;
  return read()[owner] ?? null;
}

export function markSeen(owner: string | null | undefined, count: number) {
  if (!owner) return;
  try {
    const all = read();
    all[owner] = { count, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* a browser that will not remember is not a broken browser */
  }
}

/** "yesterday", "on Tuesday", "three weeks ago". */
export function whenWord(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) {
    return `on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}`;
  }
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
