import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app, as an app rather than a browser tab.
 *
 * The Trusted Web Activity that came first always ran inside a browser, and on
 * a phone whose default was Brave it opened as a Brave tab. This ships the
 * built site inside the APK and runs it in the system WebView, so there is no
 * browser anywhere: an icon, a full screen, and updates that arrive over the
 * air the way Ilowa's do.
 *
 * `webDir` is the same dist/ that Netlify serves, so the web app and the
 * installed one are the same build.
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
    // The bundled files are served as if from the real site. Same origin, so
    // passkeys made in the app are the ones the site makes, and relative
    // /api/ calls resolve to the real host.
    hostname: HOST,
    androidScheme: 'https',
  },

  android: {
    // Mobile Wallet Adapter turns itself off inside a WebView unless the user
    // agent carries this marker, which is how Solana Mobile tells a sanctioned
    // app shell apart from an embedded browser. Without it the Seed Vault
    // Wallet door never appears.
    appendUserAgent: 'Solana Mobile Web Shell',
    allowMixedContent: false,
  },

  plugins: {
    // The bundled files answer for HOST, so a plain fetch of /api/rpc would be
    // looked for inside the APK. Native HTTP sends it to the real server.
    CapacitorHttp: { enabled: true },

    // Over the air, self hosted. The app asks /api/ota whether a newer build
    // exists, downloads it, and switches on the next start. Nothing goes to a
    // third party: stats and channel lookups are off.
    CapacitorUpdater: {
      autoUpdate: true,
      updateUrl: `https://${HOST}/api/ota`,
      statsUrl: '',
      channelUrl: '',
      // A build that does not call notifyAppReady within this long is rolled
      // back, which is the safety net against shipping one that will not start.
      appReadyTimeout: 15000,
      responseTimeout: 20,
    },
  },
};

export default config;
