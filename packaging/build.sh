#!/bin/bash
# Build "Flight Clock.app" and a drag-to-Applications DMG for each Mac chip.
#
#   packaging/build.sh              → both:
#       dist/Flight Clock.app        + dist/FlightClock-<version>-AppleSilicon.dmg   (arm64, .venv)
#       dist/intel/Flight Clock.app  + dist/FlightClock-<version>-Intel.dmg          (x86_64, .venv-intel)
#   packaging/build.sh arm64 | intel → just one
#
# Needs uv (https://docs.astral.sh/uv/). The Intel build uses an x86_64 Python 3.12
# that runs under Rosetta, so it builds on an Apple Silicon Mac. Two separate apps,
# not one universal app: some wheels (Pillow…) only ship per-architecture.
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
TARGETS="${1:-arm64 intel}"

# 1. Shared code: the submodule (or a dev symlink to a local checkout)
if [ -f .gitmodules ] && [ ! -L core-src ]; then
  git submodule update --init
fi
[ -f core-src/core/bootstrap.py ] || { echo "core-src/ is missing or too old (needs core/bootstrap.py)"; exit 1; }

build() {   # build <arm64|intel>
  local target="$1" venv arch dist label py
  case "$target" in
    arm64) venv=.venv;       arch=arm64;  dist=dist;       label=AppleSilicon; py=cpython-3.12-macos-aarch64 ;;
    intel) venv=.venv-intel; arch=x86_64; dist=dist/intel; label=Intel;        py=cpython-3.12-macos-x86_64 ;;
    *) echo "unknown target: $target (arm64 or intel)"; exit 1 ;;
  esac
  local PY="$ROOT/$venv/bin/python"

  # 2. Build environment
  [ -x "$PY" ] || "$UV" venv -p "$py" "$venv"
  # Intel Macs are often on older macOS: take wheels that run on 11 (uv otherwise picks
  # wheels for the build Mac's macOS, e.g. numpy's macOS 14 build)
  local platform=()
  [ "$arch" = x86_64 ] && platform=(--python-platform x86_64-apple-darwin)
  MACOSX_DEPLOYMENT_TARGET="$([ "$arch" = x86_64 ] && echo 11.0 || echo 13.0)" \
    "$UV" pip install -p "$PY" -q ${platform[@]+"${platform[@]}"} -r core-src/requirements.txt -r packaging/requirements-mac.txt
  local got; got="$(arch "-$arch" "$PY" -c 'import platform; print(platform.machine())')"
  [ "$got" = "$arch" ] || { echo "$venv is $got, expected $arch"; exit 1; }

  VERSION="$("$PY" -c 'import sys; sys.path.insert(0, "desktop"); from version import __version__; print(__version__)')"
  echo "==> Flight Clock $VERSION ($label)"

  # The Command Line Tools may be arm64-only (macOS 27 dropped Intel), so an x86_64
  # process can't run lipo/codesign/xcrun. Shims make PyInstaller's calls run them native.
  local shims="$ROOT/build/shims"
  if [ "$arch" = x86_64 ] && [ "$(uname -m)" = arm64 ]; then
    mkdir -p "$shims"
    for tool in lipo codesign install_name_tool otool strip xcrun SetFile GetFileInfo Rez DeRez; do
      printf '#!/bin/sh\nexec arch -arm64 /usr/bin/%s "$@"\n' "$tool" > "$shims/$tool"
      chmod +x "$shims/$tool"
    done
  fi

  # 3. Art, then the app bundle
  PATH="$shims:$PATH" arch "-$arch" "$PY" packaging/make_art.py packaging/art
  rm -rf "build/$target" "$dist/Flight Clock" "$dist/Flight Clock.app"
  PATH="$shims:$PATH" FC_ARCH="$arch" arch "-$arch" "$PY" -m PyInstaller --noconfirm --clean --distpath "$dist" \
    --workpath "build/$target" packaging/FlightClock.spec

  local APP="$dist/Flight Clock.app"

  # 4. Sign (ad-hoc unless a Developer ID is configured)
  if [ -n "${SIGN_IDENTITY:-}" ]; then
    codesign --force --deep --options runtime --timestamp \
      --entitlements packaging/entitlements.plist -s "$SIGN_IDENTITY" "$APP"
  else
    codesign --force --deep -s - "$APP"
  fi
  codesign --verify --deep --strict "$APP"

  # 5. DMG
  local DMG="dist/FlightClock-$VERSION-$label.dmg"
  rm -f "$DMG"
  # dmgbuild only copies files but calls /usr/bin/SetFile directly: run it native when possible
  local DMGPY="$PY"
  [ "$(uname -m)" = arm64 ] && [ -x "$ROOT/.venv/bin/python" ] && DMGPY="$ROOT/.venv/bin/python"
  "$DMGPY" -m dmgbuild -s packaging/dmg_settings.py -D app="$APP" -D art=packaging/art "Flight Clock" "$DMG"

  if [ -n "${SIGN_IDENTITY:-}" ]; then
    codesign --force -s "$SIGN_IDENTITY" "$DMG"
    if [ -n "${NOTARY_PROFILE:-}" ]; then
      xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
      xcrun stapler staple "$DMG"
    fi
  fi
  echo "==> $DMG ($(du -h "$DMG" | cut -f1))"
}

for t in $TARGETS; do build "$t"; done
