/**
 * Which of the eight robots a key is, without loading a renderer to find out.
 *
 * The colours and the index live here rather than next to the geometry so
 * that a twenty six pixel avatar can put the right colour on screen in the
 * first frame, while three is still being fetched in the background. It is
 * the difference between a grey hole and a thing that was always there.
 */

export interface Palette {
  body: string;
  trim: string;
  accent: string;
}

export const PALETTES: Palette[] = [
  { body: '#4ec2a5', trim: '#27665a', accent: '#e0ac3c' },
  { body: '#e88d43', trim: '#7d4a1d', accent: '#4ec2a5' },
  { body: '#9a8cff', trim: '#413a80', accent: '#4ec2a5' },
  { body: '#e8553e', trim: '#742518', accent: '#f0c674' },
  { body: '#dfe3ea', trim: '#7e848f', accent: '#4ec2a5' },
  { body: '#44506a', trim: '#232a3a', accent: '#e0ac3c' },
  { body: '#f0c674', trim: '#836420', accent: '#4ec2a5' },
  { body: '#54a0e8', trim: '#1f4c79', accent: '#f0c674' },
];

export const BUILD_COUNT = PALETTES.length;

/** Stable and cheap. Same key, same robot, on every device, forever. */
export function hashOf(s: string): number {
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  return a;
}

/** Which of the eight this key and this choice land on. */
export const buildIndex = (seed: string, variant: number) =>
  (hashOf(seed) + variant) % BUILD_COUNT;

/** What each one is called, so a picker can name what is in front of you. */
export const BUILD_NAMES = [
  'Verdigris',
  'Ember',
  'Violet',
  'Rust',
  'Bone',
  'Slate',
  'Brass',
  'Cobalt',
];
