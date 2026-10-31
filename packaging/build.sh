#!/bin/bash
# Build "Flight Clock.app" and a drag-to-Applications DMG.
#
#   packaging/build.sh            → dist/Flight Clock.app, dist/FlightClock-<version>.dmg
#
# Needs uv (https://docs.astral.sh/uv/). Creates .venv with a native arm64 Python 3.12.
#
# Signing: without a Developer ID the app is ad-hoc signed and friends must use
# System Settings → Privacy & Security → Open Anyway on first launch. With an
# Apple Developer account, set these and the DMG opens cleanly everywhere:
#   SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   NOTARY_PROFILE=flightclock     # created once with: xcrun notarytool store-credentials flightclock
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
PY="$ROOT/.venv/bin/python"

# 1. Shared code: the submodule (or a dev symlink to a local checkout)
if [ -f .gitmodules ] && [ ! -L core-src ]; then
  git submodule update --init
fi
[ -f core-src/core/bootstrap.py ] || { echo "core-src/ is missing or too old (needs core/bootstrap.py)"; exit 1; }

# 2. Build environment
if [ ! -x "$PY" ]; then
  "$UV" venv -p 3.12 .venv
fi
"$UV" pip install -p "$PY" -q -r core-src/requirements.txt -r packaging/requirements-mac.txt

VERSION="$("$PY" -c 'import sys; sys.path.insert(0, "desktop"); from version import __version__; print(__version__)')"
echo "==> Flight Clock $VERSION"

# 3. Art, then the app bundle
"$PY" packaging/make_art.py packaging/art
rm -rf build "dist/Flight Clock" "dist/Flight Clock.app"
"$PY" -m PyInstaller --noconfirm --clean --distpath dist --workpath build packaging/FlightClock.spec

APP="dist/Flight Clock.app"

# 4. Sign (ad-hoc unless a Developer ID is configured)
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --options runtime --timestamp \
    --entitlements packaging/entitlements.plist -s "$SIGN_IDENTITY" "$APP"
else
  codesign --force --deep -s - "$APP"
fi
codesign --verify --deep --strict "$APP"

# 5. DMG
DMG="dist/FlightClock-$VERSION.dmg"
rm -f "$DMG"
"$PY" -m dmgbuild -s packaging/dmg_settings.py -D app="$APP" -D art=packaging/art "Flight Clock" "$DMG"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force -s "$SIGN_IDENTITY" "$DMG"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi

echo "==> $DMG ($(du -h "$DMG" | cut -f1))"
