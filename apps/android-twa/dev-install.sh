#!/usr/bin/env bash
# Build a release APK with the canonical Ferrum key and install it on the connected
# device. Same key as any other build, so it upgrades in place instead of failing with
# INSTALL_FAILED_UPDATE_INCOMPATIBLE.
set -euo pipefail
cd "$(dirname "$0")"

PKG="com.ferrum.app"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$SDK/platform-tools/adb"
APK="app/build/outputs/apk/release/app-release.apk"
KEYSTORE="$PWD/keystore.jks" # gitignored

cleanup() { rm -f "$KEYSTORE"; }
trap cleanup EXIT

[[ -x "$ADB" ]] || {
  echo "ERROR: no Android SDK at $SDK — set ANDROID_HOME" >&2
  exit 1
}

# Gradle needs a JDK and this machine has none on PATH; Android Studio ships one.
if [[ -z "${JAVA_HOME:-}" ]] && ! java -version >/dev/null 2>&1; then
  JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  [[ -x "$JAVA_HOME/bin/java" ]] || {
    echo "ERROR: no JDK found — install one or set JAVA_HOME" >&2
    exit 1
  }
  export JAVA_HOME
fi

echo "==> Loading the release key from the Keychain"
security find-generic-password -a "$USER" -s "ferrum-android-keystore-b64" -w | base64 -d >"$KEYSTORE"
STORE_PW="$(security find-generic-password -a "$USER" -s "ferrum-android-keystore-password" -w)"
[[ -s "$KEYSTORE" ]] || {
  echo "ERROR: keystore not in the Keychain (ferrum-android-keystore-b64)" >&2
  exit 1
}

echo "==> Building the release APK"
ANDROID_HOME="$SDK" KEYSTORE_FILE="$KEYSTORE" KEYSTORE_PASSWORD="$STORE_PW" \
  KEY_ALIAS="android" KEY_PASSWORD="$STORE_PW" \
  ./gradlew assembleRelease --no-daemon -q

# The fingerprint printed here is what has to be in assetlinks.json. If they diverge the
# app still launches, just with a URL bar across the top of every screen.
APKSIGNER="$(find "$SDK/build-tools" -name apksigner 2>/dev/null | sort -V | tail -1)"
if [[ -n "$APKSIGNER" ]]; then
  echo "==> Signer certificate"
  "$APKSIGNER" verify --print-certs "$APK" | grep -i "SHA-256 digest"
fi

if [[ "${1:-}" == "--build-only" ]]; then
  echo "==> Built: $APK"
  exit 0
fi

echo "==> Installing on $("$ADB" devices | sed -n 2p | cut -f1)"
INSTALL_LOG="$(mktemp)"
if ! "$ADB" install -r -d "$APK" 2>"$INSTALL_LOG"; then
  if grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE\|signatures do not match" "$INSTALL_LOG"; then
    echo "==> Installed copy is signed with a different key — uninstalling once, then reinstalling"
    "$ADB" uninstall "$PKG" >/dev/null
    "$ADB" install "$APK"
  else
    cat "$INSTALL_LOG" >&2
    exit 1
  fi
fi
echo "==> Installed $PKG"
