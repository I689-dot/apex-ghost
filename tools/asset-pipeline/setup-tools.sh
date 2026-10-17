#!/usr/bin/env bash
# Installs the asset-pipeline tools into ~/.local/opt (no sudo needed, Linux x64):
#   Blender 4.2 LTS (headless USD import + glTF export), Python venv with usd-core, KTX-Software (toktx).
set -euo pipefail
OPT="$HOME/.local/opt"
mkdir -p "$OPT"
cd "$OPT"
if [ ! -x blender-4.2.3-linux-x64/blender ]; then
  echo "▶ Blender 4.2.3"
  curl -fSL -o blender.tar.xz https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz
  tar -xf blender.tar.xz && rm blender.tar.xz
fi
if [ ! -x usdenv/bin/python ]; then
  echo "▶ Python venv with usd-core"
  python3 -m venv usdenv
  ./usdenv/bin/pip install -q usd-core numpy pillow matplotlib
fi
if [ ! -x ktx/bin/toktx ]; then
  echo "▶ KTX-Software 4.4.2"
  curl -fSL -o ktx.tar.bz2 https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.tar.bz2
  mkdir -p ktx && tar -xjf ktx.tar.bz2 -C ktx --strip-components=1 && rm ktx.tar.bz2
fi
echo "✔ tools ready in $OPT (override with BLENDER, USD_PYTHON, KTX_DIR env vars)"
