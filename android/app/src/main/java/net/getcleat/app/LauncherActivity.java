/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package net.getcleat.app;

import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    /**
     * Which browser engine runs the app underneath.
     *
     * By default the helper hands the app to whatever the phone's default
     * browser is. On a phone where that is Brave, Cleat opened as a Brave tab
     * with Brave's own bars, because Brave does not carry the full-screen
     * verified mode through. Chrome does, and it is also what hands a Mobile
     * Wallet Adapter request to the Seed Vault Wallet. So Chrome when it is
     * there, and the default picker only when it is not.
     */
    private static final String[] PREFERRED = {
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev",
    };

    @Override
    protected com.google.androidbrowserhelper.trusted.TwaLauncher createTwaLauncher() {
        PackageManager pm = getPackageManager();
        for (String pkg : PREFERRED) {
            try {
                if (pm.getApplicationInfo(pkg, 0).enabled) {
                    return new com.google.androidbrowserhelper.trusted.TwaLauncher(this, pkg);
                }
            } catch (PackageManager.NameNotFoundException ignored) {
                // not installed, try the next
            }
        }
        return super.createTwaLauncher();
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        

        return uri;
    }
}
