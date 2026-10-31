# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Flight Clock for Mac** is a standalone `.app` (shipped as a drag-to-Applications DMG) that runs the Raspberry Pi LED flight clock on a Mac. The Pi version needs a 64×32 RGB LED panel; the Mac app shows that panel in a window.

There is **one plugin codebase**: `core-src/` is the Pi repo (`RoyMan0/flight-clock-and-more`), and it has its own detailed CLAUDE.md. This repo adds only:
- the native shell
- packaging

New Pi plugins reach the Mac app by updating `core-src/`. Never fork plugin code into this repo. Fix it upstream, keeping it Pi-safe.

## Layout

```
core-src/              the Pi repo as a git submodule, tracking its mac-desktop branch
desktop/
  app.py               entry point: runtime.prepare() → shared bootstrap → Flask thread → display thread → Cocoa
  runtime.py           data dir, env vars, sys.path, logging, single-instance lock, port, relaunch
  shell.py             pywebview windows, NSStatusItem menu bar icon, menus, window levels, CoreLocation, update check
  settings.py          Mac-only prefs (desktop.json): window_mode, level, led_style, bezel, glow, launch_at_login, lan_access
  panel/index.html     LED renderer: polls GET /api/display/frame (raw 6,144 bytes) at 10 fps and draws LEDs on a <canvas>
  vendor/rgbmatrix/    no-op rgbmatrix stub (the Pi repo gitignores its own)
  version.py           __version__ and the GitHub repo checked for releases
packaging/
  build.sh             uv venv → make_art.py → PyInstaller → codesign → dmgbuild
  FlightClock.spec     PyInstaller spec (arm64, onedir BUNDLE)
  dmg_settings.py      dmgbuild layout
  make_art.py          draws icon.icns + DMG background into packaging/art/ (gitignored)
  entitlements.plist   only used when signing with a Developer ID
  README-first-launch.md   install instructions for friends (Open Anyway)
```

## Working with the submodule

- Fresh clone: `git clone --recurse-submodules …`, or `git submodule update --init` afterwards.
- Change shared code **in the Pi repo** (`../flight-clock-and-more`, or directly inside `core-src/`), keeping it Pi-safe. Commit and push it there, then bump the pointer here:
  ```bash
  git submodule update --remote core-src && git add core-src && git commit -m "Bump core-src"
  ```
- The submodule tracks `mac-desktop`. Once that branch is merged into the Pi repo's `main`, switch it with `git submodule set-branch -b main core-src`.
- `build.sh` builds whatever commit `core-src` points at.

## Running and building

```bash
# Dev run (uses ~/Library/Application Support/Flight Clock unless overridden)
.venv/bin/python desktop/app.py
FLIGHTCLOCK_DATA_DIR=/tmp/fc-test .venv/bin/python desktop/app.py     # throwaway data dir; logs go to <dir>/logs

# Build the app + DMG
packaging/build.sh        # → dist/Flight Clock.app, dist/FlightClock-<version>.dmg

# Test the built app with a throwaway data dir (the env var is ignored when launched via Finder/open)
FLIGHTCLOCK_DATA_DIR=/tmp/fc-test "dist/Flight Clock.app/Contents/MacOS/Flight Clock"
```

- Use the uv-managed **arm64** Python 3.12 in `.venv`. `/usr/local/bin/python3` and `/usr/local` Homebrew are Intel builds running under Rosetta.
- To release: bump `desktop/version.py`, run `build.sh`, and upload the DMG to a GitHub Release on `RELEASES_REPO` with tag `v<version>`. The app's update check reads `releases/latest` and links to the first `.dmg` asset.

## How it fits together

- **Writable data.** The bundle is read-only, so `runtime.prepare()` sets these before any shared code is imported:
  - `FLIGHTCLOCK_DATA_DIR=~/Library/Application Support/Flight Clock` and `FLIGHTCLOCK_DESKTOP=1`
  - `chdir` into that folder
  - Logs go to `~/Library/Logs/Flight Clock/flightclock.log`.

  The shared code reads these through `core-src/utilities/paths.py`:
  - `APP_ROOT` for assets
  - `DATA_ROOT` for anything written
  - `DESKTOP` for the platform flag
- **First run.** `location.location_home == [0, 0]` means setup mode. The app serves only the Pi's setup wizard (`create_app(setup_mode=True)`) in a window.
  - In desktop mode the wizard has no WiFi step, and its timezone field is hidden.
  - "Use my Mac's location" calls `POST /setup/locate`, which goes to `app.locate_cb` = `Shell.locate`, which uses CoreLocation.
  - "Save & Start" → `/setup/finish` → `app.restart_cb` = `Shell.relaunch`.
- **Relaunch.** `runtime.spawn_relaunch()` starts `sh -c 'sleep 1; open -n <bundle>'` (or re-execs the dev script), then the app quits. The new copy waits up to 6 s for the instance lock. The web UI's Restart Application uses the same hook.
- **Threads.** Cocoa (pywebview) owns the main thread. Flask and `PluginManager.run()` run on daemon threads.
  - Any AppKit call from another thread goes through `AppHelper.callAfter`.
  - pywebview's `js_api` methods also run off the main thread.
- **Quitting.** `shell._patch_app_delegate` adds two methods to pywebview's `AppDelegate`:
  - `applicationShouldTerminate:` makes Cmd-Q quit. Without it, the panel's "hide instead of close" handler would cancel termination.
  - `applicationShouldHandleReopen:` makes a Dock-icon click show the panel.
- **Window modes.**
  - `window` = Regular activation policy (Dock icon).
  - `menubar` = Accessory policy (no Dock icon). The panel is positioned under the status item and hides when it loses key focus.
  - Levels: normal, floating, and desktop. Desktop is `kCGDesktopIconWindowLevel + 1` and joins all Spaces.
- **Settings.** Mac prefs are separate from config.json, so the Pi schema never sees them.
  - They're edited from the "Mac App" card in `config.html`, which renders only when `desktop`, and from the menus.
  - Both paths use `Shell.set_prefs`, which applies them live. `lan_access` needs a restart (it changes the Flask bind host).
- **Web server.** It binds to `127.0.0.1` on 8080, or a free port if 8080 is taken. With `lan_access` it binds to `0.0.0.0`; that's off by default, so there's no firewall prompt.

## Packaging gotchas

- **Asset allowlist.** The spec lists datas explicitly. The Pi repo tracks the owner's `close.txt`, `farthest.txt` and `web/static/maps/*.html` (personal flight history and a map of home), and those must never ship.
  - Never switch to "bundle every tracked file".
  - After building, check the bundle for `close.txt`, `config.json`, `secrets.json` and `data/` (see Verification below).
- **`module_collection_mode="pyz+py"`** is required for the shared packages. The code builds paths like `utilities/../fonts`, which fail with ENOENT unless the `utilities/` folder exists on disk; in the PYZ archive it doesn't.
- **Plugin modules are imported by name** in `core/bootstrap.py`, so the spec walks `core-src` and adds every module to `hiddenimports`. If the log shows "X plugin failed to import" in the built app but not in dev, a library needs `collect_submodules`/`collect_data_files`.
- **`NSAppTransportSecurity.NSAllowsLocalNetworking`** lets WKWebView load `http://127.0.0.1` inside the bundle.
- **Signing.** The app is ad-hoc signed (required on Apple Silicon), so Gatekeeper rejects it until the user clicks Open Anyway. Setting `SIGN_IDENTITY` (and `NOTARY_PROFILE`) in `build.sh` switches to Developer ID with hardened runtime + notarization. No code changes are needed.
- **Launch at login** (`SMAppService.mainAppService`) only works from the installed `.app`. In dev it reports "unavailable".
- **Screenshots of the panel need Screen Recording permission.** To check rendering without it:
  - Fetch `/api/display/frame` and convert the bytes with PIL: `Image.frombytes("RGB", (64, 32), data)`.
  - Exercise the panel JS with `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`, since there's no Node.

## Verification checklist (before a release)

1. `packaging/build.sh` succeeds.
2. Run the built binary with a throwaway `FLIGHTCLOCK_DATA_DIR` and check:
   - The log has no "failed to import" lines.
   - All plugins appear in `GET /api/status`.
   - `/`, `/config`, `/about`, `/flights` and `/display` return 200.
3. Audit the bundle for personal files and secrets:
   ```bash
   find "dist/Flight Clock.app" -name close.txt -o -name farthest.txt -o -name secrets.json -o -name config.json -o -path "*static/maps*"
   ```
   It must print nothing.
4. Mount the DMG and check it holds the app plus an Applications link.
5. On a second Mac or user account, test a download from the GitHub Release: Open Anyway, then the setup wizard.
