# Ferrum for Android

A Trusted Web Activity around `https://ferrum.life-as-code.com` — the same PWA, in a launcher
icon, with no browser chrome. There is no second implementation of the logger here: this module
is the Android shell and nothing else.

```bash
./dev-install.sh              # build with the release key + install on the connected device
./dev-install.sh --build-only
```

The script finds a JDK inside Android Studio when none is on `PATH`, pulls the key from the
Keychain, builds `app/build/outputs/apk/release/app-release.apk` and installs it in place.

## The signing key is the app's identity

Android refuses to upgrade an installed app whose signature changed, and the browser only drops
the URL bar for an APK whose certificate is named by the site. So every build — here or anywhere
else — uses one key:

| Where             | What                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| macOS Keychain    | `ferrum-android-keystore-b64`, `ferrum-android-keystore-password` (alias `android`) |
| `assetlinks.json` | `apps/pwa/public/.well-known/assetlinks.json` names the certificate's SHA-256       |

`CN=Ferrum`, SHA-256
`26:E3:57:03:0C:F9:31:C0:22:DA:10:DA:D2:5A:ED:02:AD:42:3D:D2:D9:91:83:D9:72:D8:97:EF:70:E2:A7:3E`.
Regenerating it strips every installed copy of its upgrade path, so don't. Keystores are
gitignored; `dev-install.sh` writes one to disk for the length of a build and deletes it on exit.

The fingerprint lives in the repo rather than in a deploy-time variable because it is public
information — anyone can read it out of the APK — and because the two halves of a Digital Asset
Links pair only work as a pair. Splitting them across a Helm value gives a build that succeeds
and an app that quietly shows a URL bar.

## When the URL bar appears

That is the one failure mode of this app, and it always means the same thing: the browser could
not match the APK to the site. In order of likelihood:

1. `https://ferrum.life-as-code.com/.well-known/assetlinks.json` is not being served as JSON.
   A missing file does not 404 — the single-page fallback answers it with `index.html` and a 200. `apps/pwa/tests/e2e/pwa.spec.ts` asserts the content type for this reason.
2. The fingerprint there is not the one in the APK. `dev-install.sh` prints the APK's signer
   certificate on every build; compare them.
3. The change is deployed but the device cached the old answer. Reinstalling re-runs
   verification: `adb shell pm get-app-links com.ferrum.app` reports the state.

## Regenerating the project

`app/build.gradle` is the single source of truth for what Bubblewrap would call the TWA manifest,
and this module is built with Gradle directly — Bubblewrap itself is not a dependency and no
`twa-manifest.json` is kept, because a second copy of the same values is a second thing to
forget. Launcher and splash icons are resized from
`apps/pwa/public/icons/ferrum-icon-512{,-maskable}.png`; the values in `app/build.gradle` mirror
`apps/pwa/public/manifest.webmanifest`, which Chrome fetches at run time and compares.

The template's notification delegation and launcher shortcuts are both deliberately absent —
nothing in the PWA posts a notification and no shortcut is defined, so keeping them would declare
`POST_NOTIFICATIONS`, export a service any app on the device could bind to, and prompt the lifter
on first launch for a capability that does not exist. Add either back in the same change that
first uses it.
