package net.getcleat.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Passkeys inside the app.
     *
     * The system WebView ships with WebAuthn switched off. With it on for
     * this app, a passkey request goes to Android's Credential Manager, which
     * checks the site's assetlinks.json for this package and signing key
     * before it will create or return one. The published file already lists
     * both, with get_login_creds, so the passkey made here is the same one
     * the website makes.
     *
     * On a WebView too old to support it, nothing changes: the page sees no
     * passkeys and leads with the wallet instead.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                webView.getSettings(),
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        }
    }
}
