#!/usr/bin/env bash
# Creates the release signing key once, OUTSIDE the repository:
#   ~/.android-keys/apex-ghost-release.jks         the keystore (back it up: updates must be signed with it)
#   ~/.android-keys/apex-ghost-release.properties  its passwords, read by android/app/build.gradle
# Never commit either file. Losing them means users must uninstall the app before installing a new build.
set -euo pipefail
DIR="${APEX_KEY_DIR:-$HOME/.android-keys}"
KS="$DIR/apex-ghost-release.jks"
PROPS="$DIR/apex-ghost-release.properties"
JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk/current}"
mkdir -p "$DIR"
chmod 700 "$DIR"
if [ -f "$KS" ]; then
  echo "Keystore already exists: $KS"
  exit 0
fi
if [ -f "$DIR/.pw" ]; then PW=$(cat "$DIR/.pw"); else PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28); fi
"$JAVA_HOME/bin/keytool" -genkeypair -v -keystore "$KS" -storetype PKCS12 -alias apexghost -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PW" -keypass "$PW" -dname "CN=APEX GHOST, O=APEX GHOST, C=ES"
cat > "$PROPS" <<EOF
storeFile=$KS
storePassword=$PW
keyAlias=apexghost
keyPassword=$PW
EOF
chmod 600 "$KS" "$PROPS"
rm -f "$DIR/.pw"
echo "Keystore: $KS"
echo "Passwords: $PROPS"
