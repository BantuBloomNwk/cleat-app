import React, { useState } from 'react';
import { tactile } from '../utils/haptics';

/**
 * For somebody who has never traded and does not own any crypto.
 *
 * The rest of this app is written for people who already know what a basis
 * point is and what custody means. That is most of the words on every screen,
 * and PRODUCT.md says the market is people who will never open a US brokerage,
 * which is very nearly the opposite audience.
 *
 * So this explains it once, in the fewest words that are still true, and puts
 * the jargon underneath rather than in the way. It opens closed because
 * somebody who already knows should not have to scroll past it.
 */
interface Term {
  word: string;
  plain: string;
}

const TERMS: Term[] = [
  {
    word: 'Mandate',
    plain:
      'The sentence you write about how your money may be handled. It is stored as an account only you can change, and the program checks every proposal against it.',
  },
  {
    word: 'Agent',
    plain:
      'Software that watches the market and suggests trades. It can suggest anything at all. It cannot do anything your sentence does not allow.',
  },
  {
    word: 'Basis point',
    plain:
      'One hundredth of one percent. A hundred basis points is one percent. It is used instead of percentages because the differences that matter here are small.',
  },
  {
    word: 'The book',
    plain:
      'Everything in your account, taken together. "Four percent of the book" means four percent of everything you have here.',
  },
  {
    word: 'Spread',
    plain:
      'The gap between what buyers offer and what sellers ask. A wide gap means you lose money the moment you trade, whichever way the price then goes.',
  },
  {
    word: 'Cleared, trimmed, refused',
    plain:
      'The three things that can happen to a proposal. Cleared means it was allowed. Trimmed means it was allowed but made smaller. Refused means it was not allowed at all.',
  },
  {
    word: 'Tokenized equity',
    plain:
      'A share in a real company, recorded on a public network instead of only inside a broker. It can be held in an ordinary wallet and it trades at all hours.',
  },
  {
    word: 'Custody',
    plain:
      'Who can move your money. Here the program holds it and only your own key can take it out. Nobody at this company can, and neither can the agent.',
  },
  {
    word: 'Passkey',
    plain:
      'The fingerprint or face unlock on your phone, used instead of a password or a seed phrase. The key never leaves your device.',
  },
  {
    word: 'On chain',
    plain:
      'Written to a public record anyone can read and nobody can quietly edit, including us. It is why the refusals on this screen can be checked rather than believed.',
  },
];

export const PlainEnglish: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <section className="plain-english" id="plain-english">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          tactile.selectionTap();
          setOpen((v) => !v);
        }}
        className="w-full flex items-baseline justify-between gap-3 text-left"
      >
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-bold text-[var(--text-primary)]">
            New to this? Start here.
          </span>
          <span className="text-[11.5px] text-[var(--text-secondary)]">
            What it does, in words nobody has to look up.
          </span>
        </span>
        <span className="text-[11px] font-mono text-[var(--verdigris)] shrink-0">
          {open ? 'close' : 'open'}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-[var(--card-border-subtle)]">
          <p className="text-[12.5px] leading-[1.7] text-[var(--text-secondary)]">
            You write one sentence about how your money should be handled.
            Something like{' '}
            <em className="text-[var(--text-primary)]">
              nothing more than a tenth of it in any one industry, and never
              anything to do with oil
            </em>
            . That sentence is saved where only you can change it.
          </p>
          <p className="text-[12.5px] leading-[1.7] text-[var(--text-secondary)]">
            Software then watches the market and suggests things to buy and
            sell. Before any of it happens, the suggestion is checked against
            your sentence. If it breaks the sentence it does not happen, and the
            attempt is written down where you and anyone else can see it.
          </p>
          <p className="text-[12.5px] leading-[1.7] text-[var(--text-secondary)]">
            The part worth understanding is that the software cannot change your
            sentence. Not if it is badly built, not if somebody tricks it, not
            if we wanted it to. Only your own fingerprint or face unlock can.
            That is why the claim is that you do not have to trust it.
          </p>
          <p className="text-[12.5px] leading-[1.7] text-[var(--text-secondary)]">
            You can take your money out whenever you like. There is no notice
            period, no approval and nothing anyone can do to stop it.
          </p>

          <div className="flex flex-col gap-2 mt-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Words used on these screens
            </span>
            {TERMS.map((t) => (
              <div key={t.word} className="flex flex-col gap-0.5">
                <span className="text-[12px] font-bold text-[var(--text-primary)]">
                  {t.word}
                </span>
                <span className="text-[11.5px] leading-[1.6] text-[var(--text-secondary)]">
                  {t.plain}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 mt-1 pt-3 border-t border-[var(--card-border-subtle)]">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              What this is not
            </span>
            <p className="text-[11.5px] leading-[1.7] text-[var(--text-secondary)]">
              It is not advice. Nobody here tells you what to buy or decides
              what is good for you. It is an account you direct, with software
              that places orders inside limits you wrote. That distinction is
              not decoration: it is the difference between this and a managed
              fund, and it is why nobody here needs your permission to be
              regulated as your adviser, because nobody here is acting as one.
            </p>
            <p className="text-[11.5px] leading-[1.7] text-[var(--text-secondary)]">
              It is also not a promise that you will make money. Every boundary
              here is about what cannot happen to your account. None of them
              make a good trade out of a bad one.
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
