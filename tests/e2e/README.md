# Browser checks

Each one drives the real app on a phone-sized screen and prints pass or fail.
They caught things no unit test here would have: a white screen from a
browser-illegal `Buffer`, a wallet socket the content security policy was
silently blocking, a sponsor wallet drained to zero, and a demo that had been
failing quietly for two days.

```
cd tests/e2e && npm install
node boot.mjs https://<deploy>.netlify.app
```

Chrome or Chromium must be installed; set `CHROME_PATH` if it is not at
`/usr/bin/chromium`. Screenshots and JSON reports land in `./out`.

| Check | What it proves | Writes to devnet |
|---|---|---|
| `boot.mjs` | every tab loads with no errors and no sideways scroll | no |
| `social.mjs` | follow, the Following feed, a refusal receipt, the shared link | no |
| `perf.mjs` | tab open times and dropped frames with the CPU slowed 6x | no |
| `passkey.mjs` | a first visit with a passkey, through to a sentence on chain | yes |
| `wallet.mjs` | the same through a wallet, with a stand-in wallet | yes |
| `owner.mjs` | stop, start, private and delete, on a fresh account | yes, then deletes it |
| `screenshots.mjs` | the store screenshots at 1080 by 1920 | no |

Passkeys only work on a real origin, so run the writing checks against a
deployed URL, not a local preview. Each new key costs the devnet sponsor
about 0.012 SOL; check its balance after a long session.

## Before promoting a deploy

1. `netlify deploy` without `--prod` gives a draft URL.
2. Run `boot.mjs` and `passkey.mjs` against the draft.
3. Promote only if both pass, then run `boot.mjs` against production.
