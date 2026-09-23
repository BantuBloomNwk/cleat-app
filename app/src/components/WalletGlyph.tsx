import React from 'react';

/**
 * A mark that means you, derived from your own key.
 *
 * The app had nothing anywhere that said "this is mine". Every card was the
 * system talking, in the system's voice, about the system, and the only
 * thing on screen belonging to the person was the sentence they wrote. That
 * is why it reads as somebody else's console.
 *
 * A photo is the obvious fix and the wrong one here. There is no social
 * graph of faces, uploading one means holding it, and a product whose whole
 * argument is that it does not hold your things should not start by asking
 * for a picture.
 *
 * So the mark is computed from the address. Same key, same mark, on every
 * device, forever, with nothing stored and nothing collected. Three bands
 * of colour and a rotation, which is enough for two wallets to look
 * obviously different at sixteen pixels and is the point: you should be
 * able to tell at a glance that the thing on screen is yours.
 */

/** Cheap, stable, and good enough for colour. Not a hash for anything else. */
function seedOf(s: string): number[] {
  let a = 0x811c9dc5;
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
    if (i % 4 === 3) out.push(a);
  }
  while (out.length < 4) out.push((a = Math.imul(a ^ out.length, 0x01000193) >>> 0));
  return out;
}

export const WalletGlyph: React.FC<{
  address: string | null | undefined;
  size?: number;
  className?: string;
}> = ({ address, size = 22, className = '' }) => {
  // No key yet is a real state and should look like one: an empty ring
  // rather than a mark belonging to nobody.
  if (!address) {
    return (
      <span
        className={`wallet-glyph wallet-glyph-empty ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  const [a, b, c, d] = seedOf(address);
  const h1 = a % 360;
  const h2 = (h1 + 60 + (b % 120)) % 360;
  const h3 = (h1 + 200 + (c % 100)) % 360;
  const angle = d % 360;

  return (
    <span
      className={`wallet-glyph ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage:
          `linear-gradient(${angle}deg, hsl(${h1} 64% 52%) 0%, ` +
          `hsl(${h2} 58% 44%) 48%, hsl(${h3} 62% 38%) 100%)`,
      }}
      title="Your key, as a mark. Computed from the address, stored nowhere."
      aria-hidden="true"
    />
  );
};
