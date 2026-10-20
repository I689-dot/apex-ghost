#!/usr/bin/env bash
# Optional: an Android emulator to try the APK (needs /dev/kvm). Installs the emulator and an Android 14 image
# in ~/Android/Sdk, creates the "apex" AVD once, boots it headless and installs the APK.
#   bash tools/mobile/emulator.sh [path/to/apk]
set -euo pipefail
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk/current}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDM="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
ADB="$ANDROID_HOME/platform-tools/adb"
IMG="system-images;android-34;google_apis;x86_64"
APK="${1:-$(cd "$(dirname "$0")/../.." && pwd)/apps/client/public/downloads/apex-ghost.apk}"
[ -d "$ANDROID_HOME/emulator" ] && [ -d "$ANDROID_HOME/system-images/android-34" ] || "$SDKM" "emulator" "$IMG"
if ! "$AVDM" list avd | grep -q "Name: apex"; then
  echo no | "$AVDM" create avd -n apex -k "$IMG" -d pixel_6
  # landscape-friendly, enough RAM for WebGL
  printf 'hw.ramSize=3072\nhw.gpu.enabled=yes\nhw.gpu.mode=swiftshader_indirect\nhw.keyboard=yes\n' >> "$HOME/.android/avd/apex.avd/config.ini"
fi
if ! "$ADB" devices | grep -q emulator; then
  nohup "$ANDROID_HOME/emulator/emulator" -avd apex -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > "$HOME/Android/emulator.log" 2>&1 &
fi
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
"$ADB" install -r "$APK"
"$ADB" shell am start -n app.apexghost.racing/.MainActivity
echo "running: adb exec-out screencap -p > shot.png to take a screenshot"
