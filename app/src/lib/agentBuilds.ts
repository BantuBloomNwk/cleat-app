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

/**
 * Who each one is.
 *
 * Eight robots that all wave are one robot in eight colours. A face that
 * resets to neutral the moment its trick finishes is a puppet rather than a
 * character. So each build gets a move nobody else does and an expression it
 * keeps: the brow angle and the mouth curve below are its resting face, not
 * a reaction, and it wears them on the vault, in the header and in the line
 * up.
 *
 * The one thing personality is not allowed to touch is the ranking. Whoever
 * this one is, a refusal is still the biggest thing it does and it is never
 * more pleased to have cleared a trade than to have stopped one. Character
 * decides how it looks while it holds the line, not whether it holds it.
 *
 * brow: radians, positive drives the inner ends down, which is a scowl.
 * curve: positive lifts the corners into a smile, negative pulls them down.
 * open: nothing at zero, a laugh at one.
 */
export type MoveKind =
  | 'ninja'
  | 'bboy'
  | 'moonwalk'
  | 'karate'
  | 'laugh'
  | 'warrior'
  | 'flex'
  | 'flip';

export interface Persona {
  move: MoveKind;
  /** The resting face. Kept, because it is who this one is. */
  brow: number;
  curve: number;
  open: number;
  /** What the expression is called, for the picker and for a screen reader. */
  mood: string;
  /** What it says when it is picked, in its own register. */
  line: string;
}

export const PERSONAS: Persona[] = [
  {
    move: 'ninja', brow: 0.16, curve: 0, open: 0, mood: 'quiet',
    line: 'I work at night. You will hear about it in the morning.',
  },
  {
    move: 'bboy', brow: -0.12, curve: 0.5, open: 0.35, mood: 'thrilled',
    line: 'Been up all night and I have never been better. Point me at it.',
  },
  {
    move: 'moonwalk', brow: -0.05, curve: 0.42, open: 0, mood: 'smooth',
    line: 'Relax. Nothing gets past your sentence while I am on it.',
  },
  {
    move: 'karate', brow: 0.42, curve: -0.34, open: 0.5, mood: 'furious',
    line: 'Show me what wants through. I will tell you what it broke.',
  },
  {
    move: 'laugh', brow: -0.18, curve: 0.62, open: 0.85, mood: 'laughing',
    line: 'Ha. Wait until you see what I tried to buy at four in the morning.',
  },
  {
    move: 'warrior', brow: 0.3, curve: -0.06, open: 0, mood: 'immovable',
    line: 'I do not move. That is the entire job description.',
  },
  {
    move: 'flex', brow: 0.08, curve: 0.36, open: 0.15, mood: 'certain',
    line: 'Nine boundaries. I have walked into all of them. They held.',
  },
  {
    move: 'flip', brow: -0.22, curve: 0.5, open: 0.5, mood: 'restless',
    line: 'Awake, wired, and fenced in by one sentence. Perfect.',
  },
];

export const personaOf = (index: number): Persona =>
  PERSONAS[((index % BUILD_COUNT) + BUILD_COUNT) % BUILD_COUNT];
