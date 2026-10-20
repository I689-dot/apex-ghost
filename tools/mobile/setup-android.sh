#!/usr/bin/env bash
# Installs a JDK 21 and a command-line Android SDK in ~/Android (no sudo), for `pnpm app:android`.
#   ~/Android/jdk/current   Temurin JDK 21
#   ~/Android/Sdk           cmdline-tools, platform-tools, platform 36, build-tools 36.0.0
set -euo pipefail
ROOT="${ANDROID_ROOT:-$HOME/Android}"
SDK="$ROOT/Sdk"
mkdir -p "$ROOT/dl" "$ROOT/jdk" "$SDK/cmdline-tools"

if [ ! -x "$ROOT/jdk/current/bin/javac" ]; then
  echo "Downloading JDK 21 (Temurin)…"
  curl -fsSL -o "$ROOT/dl/jdk21.tar.gz" "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  tar xzf "$ROOT/dl/jdk21.tar.gz" -C "$ROOT/jdk"
  ln -sfn "$(find "$ROOT/jdk" -maxdepth 1 -type d -name 'jdk-21*' | sort | tail -1)" "$ROOT/jdk/current"
fi

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Downloading Android command-line tools…"
  ZIP=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml | grep -o 'commandlinetools-linux-[0-9]*_latest.zip' | sort -t- -k3 -n | tail -1)
  curl -fsSL -o "$ROOT/dl/cmdline.zip" "https://dl.google.com/android/repository/$ZIP"
  rm -rf "$SDK/cmdline-tools/latest" "$SDK/cmdline-tools/cmdline-tools"
  unzip -q -o "$ROOT/dl/cmdline.zip" -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi

export JAVA_HOME="$ROOT/jdk/current"
export ANDROID_HOME="$SDK"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKM" --licenses > /dev/null 2>&1 || true
"$SDKM" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
echo "Android SDK ready in $SDK (JDK: $JAVA_HOME)"
