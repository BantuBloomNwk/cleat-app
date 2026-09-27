/**
 * Robot stills already drawn on this device, readable without loading
 * three.js. The avatar asks here first; only a miss pulls in the renderer,
 * and only when the phone is idle.
 */
import { BUILD_COUNT } from './agentBuilds';

// v2: v1 held lossy WebP stills that looked soft. Bumping drops them.
const STORE_KEY = 'cleat_portraits_v2';
const BUILDS = BUILD_COUNT;

export const stills = new Map<number, string>();
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Record<string, string> | null;
  if (saved) for (const [k, v] of Object.entries(saved)) stills.set(Number(k), v);
} catch { /* nothing saved, render as needed */ }

export const norm = (index: number) => ((index % BUILDS) + BUILDS) % BUILDS;

export function saveStills() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(stills)));
  } catch { /* full or blocked: kept for this session only */ }
}

/** Run when the main thread has nothing better to do. */
export const whenIdle = (fn: () => void) => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 2500 });
  else setTimeout(fn, 200);
};
