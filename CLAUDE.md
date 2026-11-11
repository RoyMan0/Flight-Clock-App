# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Flight Clock for Mac and Windows** runs the Raspberry Pi LED flight clock on a computer. The Pi version needs a 64×32 RGB LED panel; the desktop app shows that panel in a window.
- Mac: a standalone `.app`, shipped as a drag-to-Applications DMG: one for Apple Silicon, one for Intel.
- Windows: an Inno Setup installer plus a portable zip, built on GitHub Actions (an `.exe` can't be built on a Mac).

There is **one plugin codebase**: `core-src/` is the Pi repo (`RoyMan0/flight-clock-and-more`), and it has its own detailed CLAUDE.md. This repo adds only:
- the native shells (Mac, Windows)
- packaging

New Pi plugins reach the Mac app by updating `core-src/`. Never fork plugin code into this repo. Fix it upstream, keeping it Pi-safe.

## Layout

```
core-src/              the Pi repo as a git submodule, tracking its main branch
desktop/
  app.py               entry point: runtime.prepare() → shared bootstrap → Flask thread → display thread → Cocoa
  runtime.py           data dir, env vars, sys.path, logging, single-instance lock, port, relaunch
  shell_common.py      ShellBase: the menu as a platform-neutral model, look(), module control, update check
  shell_mac.py         Mac: pywebview windows, NSStatusItem menu bar icon, NSMenu, window levels, CoreLocation
  shell_win.py         Windows: pywebview (WinForms + WebView2) windows, tray, window levels, winrt location
  win_tray.py          the Windows tray icon + popup menu, straight on Win32 via ctypes
  settings.py          Mac-only prefs (desktop.json) + the SCREENS / CASES catalogue (names, colours, window sizes)
  panel/               the panel window page (see "Display styles" below)
    index.html         host page; css/panel.css (screens), css/cases.css (case art)
    js/core.js         applies prefs, polls the app, feeds the active screen; ?fixture= preview mode
    js/screens/        led.js (64×32 LEDs), flipboard.js (split flaps), eink.js (colour e-ink canvas)
    js/board.js        the Board model (24×8 grid of cells) + helpers; js/layouts/<plugin>.js → Board
    js/art.js          weather icons, world map / radar / ISS / pixel painters; js/world.js land outline
    js/viz.js          Now Playing visualizers (Winamp/iTunes style): analyser port + 7 canvas presets
    js/fixtures.js     sample describe() models for the gallery and tests
    gallery.html       /desktop/gallery: every module × screen, every case × colour; "Use this style"
    tests/run.sh       layout tests under JavaScriptCore (no Node)
  vendor/rgbmatrix/    no-op rgbmatrix stub (the Pi repo gitignores its own)
  version.py           __version__ and the GitHub repo checked for releases
packaging/
  bundle.py            what ships (asset allowlist + module list), shared by both specs
  build.sh             Mac: per chip, uv venv → make_art.py → PyInstaller → codesign → dmgbuild
  FlightClock.spec     Mac PyInstaller spec (FC_ARCH=arm64 | x86_64, onedir BUNDLE)
  build-win.ps1        Windows: uv venv → make_art.py → PyInstaller → audit → zip → Inno Setup
  FlightClock-win.spec Windows PyInstaller spec (x64, onedir, UTF-8 mode)
  installer.iss        Inno Setup script (per-user install, no admin prompt)
  smoke-win.ps1        headless smoke test of the built Windows app (CI runs it)
  dmg_settings.py      dmgbuild layout
  make_art.py          draws icon.icns, icon.ico + DMG background into packaging/art/ (gitignored)
  entitlements.plist   only used when signing with a Developer ID
  README-first-launch.md          Mac install instructions for friends (Open Anyway)
  README-first-launch-windows.md  Windows install instructions (SmartScreen: Run anyway)
.github/workflows/windows.yml     builds + smoke-tests the Windows app on every push to main; v* tags attach it to the release
```

## Working with the submodule

- Fresh clone: `git clone --recurse-submodules …`, or `git submodule update --init` afterwards.
- Change shared code **in the Pi repo** (`../flight-clock-and-more`, or directly inside `core-src/`), keeping it Pi-safe. Commit and push it there, then bump the pointer here:
  ```bash
  git submodule update --remote core-src && git add core-src && git commit -m "Bump core-src"
  ```
- The submodule tracks the Pi repo's `main` branch.
- `build.sh` builds whatever commit `core-src` points at.

## Running and building

```bash
# Dev run (uses ~/Library/Application Support/Flight Clock unless overridden)
.venv/bin/python desktop/app.py
FLIGHTCLOCK_DATA_DIR=/tmp/fc-test .venv/bin/python desktop/app.py     # throwaway data dir; logs go to <dir>/logs

# Build the app + DMG
packaging/build.sh        # → dist/Flight Clock.app + dist/FlightClock-<version>-AppleSilicon.dmg,
                          #   dist/intel/Flight Clock.app + dist/FlightClock-<version>-Intel.dmg
packaging/build.sh arm64  # or `intel`: just one

# Test the built app with a throwaway data dir (the env var is ignored when launched via Finder/open)
FLIGHTCLOCK_DATA_DIR=/tmp/fc-test "dist/Flight Clock.app/Contents/MacOS/Flight Clock"
```

- Windows (on a PC): `powershell -ExecutionPolicy Bypass -File packaging\build-win.ps1` → `dist\Flight Clock\`, `dist\FlightClock-Setup-<version>.exe`, `dist\FlightClock-<version>-portable.zip`. Dev run: `.venv\Scripts\python desktop\app.py` (it restarts itself in Python's UTF-8 mode). From the Mac, push and download the artifact from the "Windows build" Actions run (`gh run download`).
- Use the uv-managed **arm64** Python 3.12 in `.venv`. `/usr/local/bin/python3` and `/usr/local` Homebrew are Intel builds running under Rosetta.
- **Intel build:** `.venv-intel` holds an x86_64 Python 3.12 that runs under Rosetta. Three gotchas, all handled in `build.sh`:
  - The Command Line Tools on macOS 27 are arm64-only, so an x86_64 process can't run `lipo`/`codesign`/`xcrun`. Shims in `build/shims` run them with `arch -arm64`; dmgbuild (which calls `/usr/bin/SetFile` by full path) runs from the arm64 `.venv`.
  - uv picks wheels for the build Mac's macOS (numpy's x86_64 wheel needs macOS 14), so the Intel install uses `--python-platform x86_64-apple-darwin` with `MACOSX_DEPLOYMENT_TARGET=11.0`. The Intel `LSMinimumSystemVersion` is 11.0; check no binary's `minos` exceeds it after dependency bumps.
  - Launch at login (`SMAppService`) needs macOS 13; on 11–12 the card reports it unavailable.
- To release: bump `desktop/version.py`, run `build.sh`, and upload both DMGs to a GitHub Release on `RELEASES_REPO` with tag `v<version>`; pushing the tag makes the Windows workflow attach the installer and zip. The update check reads `releases/latest` and links to the `-AppleSilicon.dmg` / `-Intel.dmg` asset for the Mac's chip (`hw.optional.arm64`, so an Intel build under Rosetta is pointed at the native one) or the `.exe` (Windows).

## How it fits together

- **Writable data.** The bundle is read-only, so `runtime.prepare()` sets these before any shared code is imported:
  - `FLIGHTCLOCK_DATA_DIR=~/Library/Application Support/Flight Clock` (Windows: `%APPDATA%\Flight Clock`) and `FLIGHTCLOCK_DESKTOP=1`
  - `chdir` into that folder
  - Logs go to `~/Library/Logs/Flight Clock/flightclock.log` (Windows: `%LOCALAPPDATA%\Flight Clock\Logs`).

  The shared code reads these through `core-src/utilities/paths.py`:
  - `APP_ROOT` for assets
  - `DATA_ROOT` for anything written
  - `DESKTOP` for the platform flag, `DESKTOP_OS` (`mac` / `windows`). Templates get `desktop_os` and `pc` ("Mac" / "PC") for wording.
- **Two shells, one menu.** `app.py` picks `shell_mac` or `shell_win`. Both subclass `shell_common.ShellBase`, whose `menu_model()` returns `Item`s that each shell draws natively (NSMenu; Win32 popup menu in `win_tray.py`). Change menus in `shell_common`, not per platform.
- **First run.** `location.location_home == [0, 0]` means setup mode. The app serves only the Pi's setup wizard (`create_app(setup_mode=True)`) in a window.
  - In desktop mode the wizard has no WiFi step, and its timezone field is hidden.
  - "Use my Mac's/PC's location" calls `POST /setup/locate`, which goes to `app.locate_cb` = `Shell.locate`: CoreLocation on the Mac, winrt `Geolocator` on Windows.
  - "Save & Start" → `/setup/finish` → `app.restart_cb` = `Shell.relaunch`.
- **Relaunch.** `runtime.spawn_relaunch()` starts `sh -c 'sleep 1; open -n <bundle>'` (Windows: a detached copy of the exe; dev: re-runs the script), then the app quits. The new copy waits up to 6 s for the instance lock. The web UI's Restart Application uses the same hook.
- **Threads.** Cocoa (pywebview) owns the main thread. Flask and `PluginManager.run()` run on daemon threads.
  - Any AppKit call from another thread goes through `AppHelper.callAfter`.
  - pywebview's `js_api` methods also run off the main thread.
- **Threads (Windows).** WinForms (pywebview) owns the main thread. pywebview's window methods are thread-safe; anything touching the `Form` goes through `shell_win._run_on_ui`. The tray runs its own message loop on a daemon thread.
- **Quitting.** `shell_mac._patch_app_delegate` adds two methods to pywebview's `AppDelegate`:
  - `applicationShouldTerminate:` makes Cmd-Q quit. Without it, the panel's "hide instead of close" handler would cancel termination.
  - `applicationShouldHandleReopen:` makes a Dock-icon click show the panel.
- **Window modes.**
  - `window` = Regular activation policy (Dock icon).
  - `menubar` = Accessory policy (no Dock icon). The panel is positioned under the status item and hides when it loses key focus.
  - Levels: normal, floating, and desktop. Desktop is `kCGDesktopIconWindowLevel + 1` and joins all Spaces.
  - Windows: `menubar` = "Tray only": the panel gets `WS_EX_TOOLWINDOW` (no taskbar button), pops up beside the tray and hides on `Deactivate`. Desktop level = `HWND_BOTTOM`, re-applied on every activation. Windows has no aspect-ratio lock, so `_keep_ratio` fixes the height after a resize settles.
- **Settings.** Mac prefs are separate from config.json, so the Pi schema never sees them.
  - They're edited from the "Mac App" / "Windows App" card in `config.html`, which renders only when `desktop`, and from the menus.
  - Both paths use `Shell.set_prefs`, which applies them live. `lan_access` needs a restart (it changes the Flask bind host).
- **Display styles.** Two independent prefs: `screen` (`led` · `flipboard` · `eink`) and `case` (`none` · `bedside` · `midcentury` · `mac_se` · `imac_g3`, plus `case_color`). Any screen works in any case.
  - The LED screen draws `GET /api/display/frame`. Flip board and e-ink draw **high-res content**: they poll `GET /api/display/model` (each plugin's `describe()`, in core-src) at 4 Hz, run `FC.layouts[plugin](model, {now})` to get a Board, and draw it. Layouts re-run every 250 ms, so they page and tick on their own (the countdown's seconds, headline pages) without new models.
  - A Board is cells on a 24×8 grid: `text` (h > 1 = big h×h characters), `icon`, `bar`, `graphic` (painters in `art.js`). Text that scrolled on the LED panel is paged. `B.pad()` results carry their alignment, which e-ink uses because it sets proportional type.
  - No layout, or `describe()` returns None, or the model has `pixels: true` (maze): the board shows the panel's raw pixels, so a new Pi plugin still appears.
  - Flip board: DOM flaps that step through the drum to the new character, with a top-left → bottom-right cascade on a page turn. E-ink: a canvas with a refresh flash on page turns, ≤ 1 update/s, and faint ghosting.
  - **End animations on timers, never on `onfinish`/`animationend`.** WebKit pauses animations in hidden or covered windows (including offscreen snapshots), but timers keep running.
  - Cases are pure CSS in `cases.css`, keyed by `body[data-case][data-color]`, with no Apple logos or names drawn. Each case's window size and ratio live in `settings.CASES`; `Shell._apply_case_size` reshapes the window around its top-left and locks the ratio. The screen inside (`#well`) stays 2:1, so update the `#well` percentages if you change a case's size.
  - Adding a case colour: add it to `settings.CASES` **and** to `cases.css`. Adding a plugin layout: `js/layouts/<id>.js`, a `<script>` tag in `index.html`, a fixture in `js/fixtures.js`, then `desktop/panel/tests/run.sh`.
- **Visualizers.** Now Playing styles `viz_<preset>` (vortex, spectrum, reflection, rays, kaleido, plasma, spiral, or cycle; desktop-only options in the Now Playing card) draw `js/viz.js` on `#viz` over any screen. It runs a JS port of `eq.py`'s Analyzer at full frame rate from `describe()`'s `features`, `position` and `seed`; the model only says which song, where, and paused. Presets draw a scene (`v.ctx`, reused by `feedback()`: zoom/rotate/fade of the last frame, the MilkDrop trick) plus an optional crisp `overlay`. Offscreen snapshots don't run requestAnimationFrame: `window.__viz.step(n)` renders n frames; `/desktop/panel?fixture=N&viz=<preset>` previews one, and the gallery has a Visualizers tab. The LED frame (and the Pi) show `eq` meanwhile.
- **Now Playing ⏮ ⏯ ⏭.** `#np-controls` in `panel/index.html` is a bar at the bottom of the screen that fades in on hover while the active module is `now_playing` with `can_skip` (core.js also polls the model once a second on the LED screen for this); `body.np-paused` swaps the play/pause icon. Clicks go to `POST /api/now_playing/control`. The buttons stop `mousedown`/`dblclick`, so they don't drag the window (Windows easy_drag) or toggle full screen. `Shell.media_control` (set as `app.media_cb`) controls a Spotify app on the same computer first: AppleScript on the Mac, media keys on Windows.
- **Web server.** It binds to `127.0.0.1` on 8080, or a free port if 8080 is taken. With `lan_access` it binds to `0.0.0.0`; that's off by default, so there's no firewall prompt.

## Packaging gotchas

- **Windows-specific:**
  - The built exe runs in Python's **UTF-8 mode** (`("X utf8", None, "OPTION")` in the spec): the shared code opens text files without an encoding, which on Windows means cp1252. Dev runs restart themselves with `PYTHONUTF8=1`.
  - No `%-d` in `strftime`, no `os.getuid`, no `sh -c` on Windows. Keep new shared code free of them (or guarded by `sys.platform`).
  - pywebview needs the Edge **WebView2 Runtime** (built into Windows 11; most Windows 10 PCs have it). The installer and the app both offer the download link when it's missing.
  - Unsigned: SmartScreen warns until the user clicks More info → Run anyway. A code-signing certificate would remove that.

- **Asset allowlist.** The spec lists datas explicitly. The Pi repo tracks the owner's `close.txt`, `farthest.txt` and `web/static/maps/*.html` (personal flight history and a map of home), and those must never ship.
  - Never switch to "bundle every tracked file".
  - After building, check the bundle for `close.txt`, `config.json`, `secrets.json` and `data/` (see Verification below).
- **`module_collection_mode="pyz+py"`** is required for the shared packages. The code builds paths like `utilities/../fonts`, which fail with ENOENT unless the `utilities/` folder exists on disk; in the PYZ archive it doesn't.
- **Plugin modules are imported by name** in `core/bootstrap.py`, so the spec walks `core-src` and adds every module to `hiddenimports`. If the log shows "X plugin failed to import" in the built app but not in dev, a library needs `collect_submodules`/`collect_data_files`.
- **`NSAppTransportSecurity.NSAllowsLocalNetworking`** lets WKWebView load `http://127.0.0.1` inside the bundle.
- **Signing.** The app is ad-hoc signed (required on Apple Silicon), so Gatekeeper rejects it until the user clicks Open Anyway. Setting `SIGN_IDENTITY` (and `NOTARY_PROFILE`) in `build.sh` switches to Developer ID with hardened runtime + notarization. No code changes are needed.
- **Launch at login** (`SMAppService.mainAppService`) only works from the installed `.app`. In dev it reports "unavailable".
- **Screenshots of the panel need Screen Recording permission.** To check rendering without it:
  - Run `FLIGHTCLOCK_HEADLESS=1 .venv/bin/python desktop/app.py` (backend only, no windows), then render pages with an offscreen `WKWebView` via PyObjC (`takeSnapshotWithConfiguration`). That snapshots the page itself, so it needs no permission. `/desktop/panel?fixture=N&screen=…&case=…&color=…` previews any fixture.
  - Fetch `/api/display/frame` and convert the bytes with PIL: `Image.frombytes("RGB", (64, 32), data)`.
  - Exercise the panel JS with `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`, since there's no Node.

## Verification checklist (before a release)

1. `packaging/build.sh` succeeds.
2. Run each built binary (the Intel one runs under Rosetta) with a throwaway `FLIGHTCLOCK_DATA_DIR` and check:
   - The log has no "failed to import" lines.
   - All plugins appear in `GET /api/status`.
   - `/`, `/config`, `/about`, `/flights` and `/display` return 200.
3. Audit the bundle for personal files and secrets:
   ```bash
   find "dist/Flight Clock.app" "dist/intel/Flight Clock.app" -name close.txt -o -name farthest.txt -o -name secrets.json -o -name config.json -o -path "*static/maps*"
   ```
   It must print nothing.
4. Mount the DMG and check it holds the app plus an Applications link.
5. On a second Mac or user account, test a download from the GitHub Release: Open Anyway, then the setup wizard.
