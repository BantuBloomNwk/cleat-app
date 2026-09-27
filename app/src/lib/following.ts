import { useEffect, useState } from 'react';

/**
 * Sentences this person follows, kept on this device.
 *
 * Following is a reading list, not a relationship, so it needs no server
 * and tells nobody anything: the decisions it surfaces are public already.
 */
const KEY = 'cleat_following';
const EVENT = 'cleat:following';

const read = (): string[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
};

export function toggleFollow(mandate: string) {
  const now = new Set(read());
  if (now.has(mandate)) now.delete(mandate); else now.add(mandate);
  try { localStorage.setItem(KEY, JSON.stringify([...now])); } catch { /* this session only */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useFollowing(): Set<string> {
  const [set, setSet] = useState(() => new Set(read()));
  useEffect(() => {
    const sync = () => setSet(new Set(read()));
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return set;
}
