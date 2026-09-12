# Design Reference

## Theme

**Dark default, with a light switch.** Reversed from the first pass on founder feedback:
light mode hurts his eyes, and he is the first user.

The scene sentence still matters, it just no longer decides the default. Someone on a
mid-range Android glancing once at whether the agent acted and whether the boundary held,
sometimes at 7am in hard morning light and sometimes at 11pm in the dark. That is a real
two-state audience, so both themes are designed properly and the light one is not an
afterthought. The switch is a first-class control, not buried in settings.

The dark ground is **warm**, not blue-black. Blue-black is the crypto reflex and would put
this next to every Solana dApp. Warm dark reads as paper at night.

## Colour strategy

**Restrained.** Tinted warm neutrals carry the surface. One cold accent, under 10%,
reserved entirely for policy state.

The concept: warm paper for the human half, a cold mineral accent for the machine half.
Your words are warm, its execution is cold. That opposition is the product.

Reflex check, both altitudes. First order, finance goes navy and gold, crypto goes neon
on black. Both rejected by the founder and both avoided. Second order, fintech that is
not navy-and-gold reflexively becomes editorial black-and-white with a big serif display
face. Avoided by the split in Typography below: the serif is the user's voice and never
the product's, so this never becomes a magazine.

### Light

| Role | OKLCH | Use |
|---|---|---|
| ground | `oklch(0.958 0.009 78)` | page, warm paper, never `#fff` |
| surface | `oklch(0.988 0.005 78)` | raised, mandate rows |
| ink | `oklch(0.22 0.015 55)` | primary text, warm near-black, never `#000` |
| ink-muted | `oklch(0.485 0.012 60)` | secondary text, labels |
| rule | `oklch(0.89 0.008 78)` | hairlines, 1px only |
| accent | `oklch(0.52 0.078 205)` | petrol, the machine, policy chrome |

### Dark

| Role | OKLCH |
|---|---|
| ground | `oklch(0.185 0.012 60)` warm dark, deliberately not blue-black |
| surface | `oklch(0.235 0.013 60)` |
| ink | `oklch(0.945 0.008 78)` |
| ink-muted | `oklch(0.70 0.010 70)` |
| rule | `oklch(0.32 0.012 60)` |
| accent | `oklch(0.70 0.085 205)` |

### The primary colour, decided

**Mineral teal-petrol, `oklch(0.70 0.085 205)` on dark.** Four reasons it is the answer to
"cool but serious and secure" without being a cliche:

- Cool hues read as serious and secure. Warm ones read as social and playful, and the
  security claim is what this product is selling, so the primary commits to cool.
- **Chroma held at 0.085 keeps it mineral rather than electric.** That single number is
  what separates it from neon cyan and from the purple-to-cyan Solana gradient. It is a
  stone colour, not a screen colour.
- Teal is genuinely absent from the finance palette, which is dominated by navy, gold and
  trading green. So it is distinctive in the category without being loud in it.
- It clears WCAG AA on the warm dark ground and on the warm paper ground, which a
  saturated navy or a neon cyan does not do in both directions.

**The social warmth does not come from the primary.** It comes from the ground being warm
and from human content carrying a warm ember tone on the fork affordance only. Cool
machine, warm hand. That is the same opposition as the type split.

### Policy state, the only place colour carries meaning

| State | Light | Meaning |
|---|---|---|
| cleared | `oklch(0.52 0.078 205)` at low emphasis | the trade passed the mandate |
| clamped | `oklch(0.675 0.105 70)` amber | the trade was shrunk to fit |
| refused | `oklch(0.475 0.140 32)` rust | the boundary held |

Rust rather than a pure red, so refusal never reads as a loss indicator. Refusal is the
single strongest colour moment in the product and nothing else competes with it.

**Gain and loss are never encoded in colour.** Direction is carried by a sign, an arrow
glyph and weight. This is the accessibility requirement and the strategic position at the
same time: in every other trading product colour means money moved, here colour means the
boundary held.

## Typography

Two faces, split by who is speaking.

- **The user's words: `"Source Serif 4", Georgia, serif`.** Mandates only. A mandate is
  prose a person wrote and it is the hero content of the whole product, so it is set as
  reading text, not as a label.
- **The product's chrome and all figures: `"IBM Plex Sans", system-ui, sans-serif`**, with
  `"IBM Plex Mono"` for amounts, caps and percentages that must align in a column. Plex
  rather than Inter, deliberately: Inter is the default everywhere, and Ilowa already runs
  Sora and Inter, so this must not read as the same house.

| Step | Size / line-height | Use |
|---|---|---|
| mandate-lg | 22px / 1.55, measure 34ch | a mandate on its own screen |
| mandate | 19px / 1.6, measure 38ch | a mandate in the list |
| body | 15px / 1.5 | product chrome |
| label | 12.5px / 1.3, 0.06em tracking, uppercase | section eyebrows |
| figure | 17px / 1.2, Plex Mono, tabular | percentages, amounts |

Scale ratio stays at or above 1.25 between adjacent display steps. Body measure never
exceeds 65ch; mandate measures are deliberately narrower because short prose reads better
tight.

## Layout

Single column, mobile first, 16px side gutter minimum at every width.

Mandates are a **single-column list of naturally varying heights**, because sentences vary
in length. This is why it does not become an identical card grid: the content refuses to
be uniform. Do not normalise the heights.

Spacing rhythm is deliberately uneven. Tight inside a mandate row (8px, 12px), generous
between sections (40px, 56px). Uniform padding everywhere is the monotony to avoid.

No container wrapping things that do not need one. No nested cards, ever.

## Motion

Ease-out-expo and ease-out-quart only. Nothing bounces, nothing is elastic. Things settle.

Transform and opacity only, never layout properties.

**The refusal is the one real motion moment in the product.** The proposed trade arrives,
the policy line draws across it, the row settles back. It should feel like a door closing
firmly, not like an error shaking. Under `prefers-reduced-motion` the line does not draw;
the state change is immediate and the colour and copy carry it alone.

## Components

- **Mandate row.** Serif prose, then a verified figure and a fork count in Plex, then a
  fork affordance. No avatar, no follower count, no timestamp competing with the sentence.
- **Policy verdict.** A single line stating what happened in plain words: cleared, shrunk
  to fit, refused. Never a badge, never an icon alone.
- **Agent activity.** Reverse-chronological, capped and finite. Not an infinite feed.
- **Fork sheet.** The forked sentence, editable in place as text. Editing a mandate is
  editing prose, not filling a form.

## Anti-patterns

Hard bans, on top of the four product anti-references:

- Side-stripe borders. No coloured `border-left` on rows or callouts.
- Gradient text. No `background-clip: text`.
- Glassmorphism, glow, neon.
- The hero-metric template: big number, small label, supporting stats.
- Identical card grids.
- Modal as the first thought. The fork sheet is the only sheet.
- Red and green as gain and loss.
- Confetti, streaks, celebration, progress rings, any nudge toward volume.
- Crypto vocabulary in the interface: wallet, seed, shielded, zk, MPC, protocol, gas,
  non-custodial.
