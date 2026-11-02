#!/usr/bin/env bash
# One command: web bundle (app mode) → Capacitor sync → signed release APK → apps/client/public/downloads.
#   pnpm app:android            (from the repo root)
#   pnpm app:android:beta       the separate "APEX GHOST Beta" app (APEX_BETA=1) → downloads/apex-ghost-beta.apk
# Needs: JDK 21 + Android SDK (tools/mobile/setup-android.sh installs both in ~/Android, no sudo)
#        and the release keystore (scripts/make-keystore.sh, kept in ~/.android-keys, never in git).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk/current}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -x "$JAVA_HOME/bin/javac" ] || [ ! -d "$ANDROID_HOME/platforms" ]; then
  echo "JDK or Android SDK missing: run tools/mobile/setup-android.sh first" >&2
  exit 1
fi
PROPS="${APEX_KEYSTORE_PROPS:-$HOME/.android-keys/apex-ghost-release.properties}"
if [ ! -f "$PROPS" ]; then
  echo "No release keystore ($PROPS): creating one with scripts/make-keystore.sh"
  bash "$here/scripts/make-keystore.sh"
fi

echo "▶ web bundle (vite --mode app)"
pnpm --dir "$repo" --filter @apex/shared build
pnpm --dir "$repo" --filter @apex/client build:app

echo "▶ capacitor sync"
cd "$here"
npx cap sync android

echo "sdk.dir=$ANDROID_HOME" > "$here/android/local.properties"
export APEX_VERSION_CODE="${APEX_VERSION_CODE:-$(date -u +%y%m%d%H)}"
# the version players see: a plain number, one step per build (apps/mobile/version.json keeps the count); the
# version code stays date-based so Android always accepts the update over an older build
VERSION_FILE="$here/version.json"
[ -f "$VERSION_FILE" ] || echo '{"major":1,"minor":0}' > "$VERSION_FILE"
NEXT_MINOR=$(node -e "const v=require(process.argv[1]);process.stdout.write(String(v.minor+1))" "$(realpath "$VERSION_FILE")")
MAJOR=$(node -e "const v=require(process.argv[1]);process.stdout.write(String(v.major))" "$(realpath "$VERSION_FILE")")
if [ -z "${APEX_VERSION_NAME:-}" ]; then
  export APEX_VERSION_NAME="$MAJOR.$NEXT_MINOR"
  node -e "const fs=require('fs');const f=process.argv[1];const v=JSON.parse(fs.readFileSync(f));v.minor++;fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')" "$(realpath "$VERSION_FILE")"
fi
echo "▶ gradle assembleRelease (version $APEX_VERSION_NAME, code $APEX_VERSION_CODE)"
cd "$here/android"
./gradlew --no-daemon -q assembleRelease

APK="$here/android/app/build/outputs/apk/release/app-release.apk"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
"$BT/apksigner" verify --print-certs "$APK" | head -3
SUFFIX=""
if [ "${APEX_BETA:-}" = 1 ]; then SUFFIX="-beta"; fi
OUT="$repo/apps/client/public/downloads/apex-ghost$SUFFIX.apk"
mkdir -p "$(dirname "$OUT")"
cp "$APK" "$OUT"
echo "✔ $OUT ($(du -h "$OUT" | cut -f1))"
