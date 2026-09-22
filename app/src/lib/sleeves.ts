/**
 * Sleeves: several accounts behind one key.
 *
 * One mandate per person was the wrong shape. Nobody holds a single
 * position. There is money that must not be touched and money that is being
 * played with, and they do not want the same sentence or the same balance.
 *
 * A sleeve is an index. The program puts it in the seeds of the mandate, the
 * vault, the verdict log and the spending allowance, so one key owns several
 * of each and they cannot reach into one another. Index zero contributes no
 * bytes at all, which is why everything written before sleeves existed is
 * still exactly where it was.
 *
 * The first attempt at this derived a separate key per sleeve from the
 * passkey. It worked, and it was wrong: it gave you a different address for
 * every sleeve, which is several wallets to fund and several addresses to
 * keep track of, and the point was one address holding several accounts.
 *
 * Nothing here is secret. It is the names a person gave their sleeves and
 * which one they were last looking at. The accounts themselves are on chain
 * and a browser that loses this file loses only the labels.
 */

const NAMES_KEY = 'cleat_sleeves';
const ACTIVE_KEY = 'cleat_sleeve_active';

export interface Sleeve {
  index: number;
  name: string;
}

const DEFAULT: Sleeve = { index: 0, name: 'Main' };

/** Storage can be absent, full, or throwing, and none of that is fatal. */
const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* the labels are a convenience, not the account */
  }
};

export function listSleeves(): Sleeve[] {
  try {
    const raw = read(NAMES_KEY);
    if (!raw) return [DEFAULT];
    const parsed = JSON.parse(raw) as Sleeve[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT];
    const clean = parsed
      .filter((x) => Number.isInteger(x?.index) && x.index >= 0 && x.index <= 65535)
      .map((x) => ({ index: x.index, name: String(x.name || `Sleeve ${x.index}`) }))
      .sort((a, b) => a.index - b.index);
    return clean.length ? clean : [DEFAULT];
  } catch {
    return [DEFAULT];
  }
}

const save = (list: Sleeve[]) => write(NAMES_KEY, JSON.stringify(list));

export function activeSleeve(): number {
  const n = Number(read(ACTIVE_KEY));
  const list = listSleeves();
  return list.some((s) => s.index === n) ? n : list[0].index;
}

export function setActiveSleeve(index: number) {
  write(ACTIVE_KEY, String(index));
}

/** Add a sleeve at the next free index. Nothing is written on chain yet. */
export function addSleeve(name: string): Sleeve {
  const list = listSleeves();
  const index = list.reduce((m, s) => Math.max(m, s.index), 0) + 1;
  const sleeve: Sleeve = { index, name: name.trim() || `Sleeve ${index}` };
  save([...list, sleeve]);
  return sleeve;
}

export function renameSleeve(index: number, name: string) {
  save(listSleeves().map((s) => (s.index === index ? { ...s, name: name.trim() || s.name } : s)));
}

/**
 * Forget a sleeve's label on this device.
 *
 * It destroys nothing. The accounts are on chain under the same key and the
 * same index, so adding a sleeve back at that index finds everything still
 * there. This only tidies the list.
 */
export function forgetSleeve(index: number) {
  if (index === 0) return;
  const left = listSleeves().filter((s) => s.index !== index);
  save(left.length ? left : [DEFAULT]);
  if (activeSleeve() === index) setActiveSleeve(left.length ? left[0].index : 0);
}
