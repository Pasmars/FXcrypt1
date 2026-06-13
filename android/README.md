# FXcrypt — Android app (Trusted Web Activity)

The Android app is a **TWA wrapper** around the deployed PWA at
https://fxcrypt-app.web.app — same app, same backend, full-screen native feel.

## Option A — Install directly as a PWA (no APK needed)

On any Android phone:
1. Open **https://fxcrypt-app.web.app** in Chrome
2. Tap the **⋮ menu → "Install app"** (or the install banner)
3. FXcrypt appears in the app drawer / home screen like a native app

## Option B — Build the APK (this folder)

`twa-manifest.json` is the complete app definition (package id `app.web.fxcrypt`,
icons, theme, shortcuts). Build with Bubblewrap (auto-installs JDK + Android SDK):

```powershell
cd android
npx @bubblewrap/cli update          # generates the Android project from twa-manifest.json
npx @bubblewrap/cli build           # produces app-release-signed.apk + .aab
```

- First run asks permission to download the JDK and Android SDK — answer **Y**.
- `build` creates/uses `android.keystore`. Set passwords via env vars to skip prompts:
  `BUBBLEWRAP_KEYSTORE_PASSWORD` and `BUBBLEWRAP_KEY_PASSWORD`.
- Output: `app-release-signed.apk` → copy to the phone and install
  (enable "Install unknown apps" for your file manager).

## Removing the URL bar (digital asset links)

A TWA shows Chrome's URL bar until the site proves it trusts the app:
1. After building, get the SHA-256: `npx @bubblewrap/cli fingerprint list`
2. Put it in `web/public/.well-known/assetlinks.json` (template below) and redeploy hosting:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "app.web.fxcrypt",
    "sha256_cert_fingerprints": ["<SHA256-FROM-STEP-1>"]
  }
}]
```

## Zero-setup alternative

Upload `https://fxcrypt-app.web.app` at **https://www.pwabuilder.com** → Android →
download a signed APK/AAB without installing any local toolchain.
