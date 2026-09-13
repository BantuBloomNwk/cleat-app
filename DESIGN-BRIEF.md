# Cleat, design brief

Everything a designer needs to produce the app. Read `PRODUCT.md` for the why and
`DESIGN.md` for tokens; this is the surface inventory.

**One line:** an agent manages part of your tokenized stock portfolio and is
cryptographically blind to what you hold. "An agent you don't have to trust."

**Non negotiables, repeated here so they cannot be missed:** dark default with a
light switch, warm dark ground never blue black, verdigris primary
`oklch(0.70 0.082 187)`, ember `oklch(0.74 0.09 55)` for human actions only,
colour means only whether the boundary held (cleared verdigris, trimmed amber,
refused rust), gain and loss are NEVER red or green, a serif carries only the
user's own words, no em-dashes, no crypto vocabulary anywhere in the UI (no
wallet, seed, zk, MPC, protocol, gas, non-custodial), 44px targets, WCAG 2.2 AA,
`prefers-reduced-motion` honoured, works at 400px.

---

## Screens

### 1. Onboarding
Three steps, no more. Passkey, no seed phrase, no wallet language.
- **Welcome.** The claim in one sentence and nothing else on screen.
- **Sign in.** Passkey only. Face or fingerprint. One button.
- **Write your first mandate.** A text field that looks like a sheet of paper,
  not a form. **Voice input is a first class affordance here**, because speaking
  a sentence is more natural than typing it. Three example sentences underneath,
  tappable to start from. A live preview showing the caps the sentence implies,
  so the user sees their words becoming rules.
- **Empty state after onboarding:** the diary with no entries yet, saying what
  will appear here overnight rather than "no data".

### 2. Diary, the home screen
The daily surface. Never portfolio value, never a hero number.
- Mandate card: the sentence in the serif as the largest type on screen, with
  held-for, version, and how many people run it.
- Period control: overnight, week, month.
- Decision entries, newest first, expanding in place to show sector, size as a
  share of the book, and the reason. Never an instrument, never an amount.
- A line making the safety explicit: nothing here names a company or an amount.
- **Try to break it:** feed the agent a poisoned headline and watch the chain
  refuse it. This is the demo and it should feel like a toy you want to press.

### 3. Chart
- Real price for an instrument, with every published mandate's decisions marked
  on the time axis, refusals clustering at spikes.
- Tapping any mark says what the rules did at that moment.
- A discipline heatmap view: at this level, N mandates were stopped.
- Timeframe control. This must serve a day trader as well as an investor, so
  intraday matters as much as months.

### 4. Mandates, the social surface
The unit is a **standing order**: a sentence currently running, with a pulse, a
lineage and a record. Not a feed of trades.
- Browse sentences. Each shows its prose, verified return, adopt count, and how
  many times it was refused.
- **Adopt**, not fork, not copy. One tap runs someone's sentence against your own
  book at your own size. Show the lineage back to the original.
- Sort by adoptions, never by return.
- Empty state: a few well written mandates to read.

### 5. Mandate detail and editor
- The sentence, editable as prose. Voice input again.
- Version history, because editing bumps a version on chain.
- The caps it compiles to, in plain words.
- **The published or private switch lives here**, with plain language beside it:
  published means other people can read this sentence and its decision record,
  which is what lets them adopt it; private publishes nothing at all. Say plainly
  that a published record reveals the shape of the strategy over time, never
  positions or amounts.

### 6. You
- Tallies: cleared, trimmed, refused.
- The discipline line as a sentence, counting decisions rather than days so it
  reads honestly for a day trader and an investor alike.
- Verified return as a figure, never a colour.
- **Rule card**, the shareable object: the sentence, its verified return, how many
  times it was refused. Never a trade card, because a trade card leaks the
  instrument and the size.

### 7. What we can and cannot see
The transparency page, and the answer to the privacy question.
- Shows the operator's own view: an encrypted blob, a verdict, and nothing else.
  **Proving the absence is more convincing than claiming it.**
- This is the only place the technologies get named, for the reader who wants
  them, with the measured numbers: attested execution at 36ms, seal 180ms, read
  17ms, attestation verified in 1.6 to 1.8 seconds.
- No toggle between them. They are layers, not alternatives.

### 8. Agent settings
- Which model runs the agent, user choosable, because the boundary is the moat
  and a swappable model proves it.
- Grant: who, for how long, up to what size. Revoke, always available, immediate.
- **Voice writes rules only and never places a trade.** Say why in one line:
  audio the agent hears is ingestion, and ingestion is the channel that empties
  wallets.

---

## Persistent chrome

- **App bar:** wordmark, a live "agent watching" pulse, and a **sealed indicator**
  that is status rather than a control. It never turns off, so it is a statement
  of fact, not a setting.
- **Bottom tabs:** Diary, Chart, Mandates, You. Four, not five.

## Components to specify

Mandate card, decision entry with expand, verdict badge in three states, adopt
button with lineage, rule card for sharing, agent status pulse, period segmented
control, voice input affordance, publish switch, empty states for every list,
and the refusal motion.

## Motion

One real moment: a refusal. The proposal arrives, the policy line draws across
it, the row settles. It should feel like a door closing firmly, never like an
error shaking. Everything else settles with ease-out, nothing bounces. Under
reduced motion the line is simply already drawn.

## States that must be designed, not left to chance

No agent granted. Agent expired. Mandate edited so an in-flight proposal is
stale. Nothing happened overnight. Offline. A refusal that is the first thing a
new user ever sees.
