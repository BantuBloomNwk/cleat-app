import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app, as an app rather than a browser tab.
 *
 * The Trusted Web Activity that came first always ran inside a browser, and on
 * a phone whose default was Brave it opened as a Brave tab. This runs the
 * live site in the system WebView, so there is no browser anywhere: an icon
 * and a full screen, and a web deploy is an app update the moment it lands.
 * Only native changes need a new APK. `webDir` is still required by the
 * tooling and is not what the app shows.
 */

/** Where the app says it lives. Passkeys bind to this, and so does assetlinks. */
const HOST = process.env.CLEAT_APP_HOST ?? 'cleat-preview.netlify.app';

const config: CapacitorConfig = {
  // Same package the TWA used and signed with the same key, so this installs
  // over it as an update rather than as a second Cleat.
  appId: 'net.getcleat.app',
  appName: 'Cleat',
  webDir: 'dist',

  server: {
    // The real site, over real TLS. The first version served the bundled
    // files under this name instead, and a phone refused passkeys outright:
    // "WebAuthn is not supported on sites with TLS certificate errors". A
    // borrowed name has no certificate behind it. Loading the site itself
    // gives passkeys a genuine one, lets /api calls resolve normally, and
    // means every web deploy reaches the app at once.
    url: `https://${HOST}`,
    androidScheme: 'https',
  },

  android: {
    // Mobile Wallet Adapter turns itself off inside a WebView unless the user
    // agent carries this marker, which is how Solana Mobile tells a sanctioned
    // app shell apart from an embedded browser.
    appendUserAgent: 'Solana Mobile Web Shell',
    // The wallet answers on ws://localhost. With mixed content forbidden the
    // WebView refused that socket, which is how the wallet opened on the
    // phone and never connected. Everything else the page loads is https,
    // and the content security policy still limits where it may connect.
    allowMixedContent: true,
  },
};

export default config;
