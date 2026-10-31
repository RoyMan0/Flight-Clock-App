"""
The native Mac shell: the LED panel window, the Settings window, the menu bar
icon, and the menus that drive them.

Two window modes (Settings → Mac App, or the menu):
  window   the panel is an ordinary window (frameless, resizable) and the app has
           a Dock icon; the menu bar icon opens the menu.
  menubar  no Dock icon. Clicking the menu bar icon drops the panel down under it
           (it hides again when you click elsewhere); right-click opens the menu.

pywebview owns the Cocoa main thread; anything touching AppKit from another
thread goes through AppHelper.callAfter.
"""

import json
import logging
import os
import subprocess
import threading
import time
import urllib.request

import AppKit
import Foundation
import objc
import Quartz
import webview
from PyObjCTools import AppHelper
from webview.platforms.cocoa import BrowserView

import runtime
import settings
from version import __version__, RELEASES_REPO

log = logging.getLogger("desktop.shell")

PANEL_SIZE = (640, 320)

# Names as the web UI shows them (web/templates/base.html PLUGIN_NAMES)
PLUGIN_NAMES = {
    "clock_weather": "Clock & Weather", "flight_tracker": "Flight Tracker",
    "specific_flight_tracker": "Specific Flight Tracker", "stock_ticker": "Stock Ticker",
    "snow_report": "Snow Report", "sports": "Sports", "world_daylight": "World Daylight",
    "ap_news": "Breaking News", "event_countdown": "Event Countdown",
    "transit": "Transit Arrivals/Departures", "world_clock": "World Clock",
    "now_playing": "Now Playing", "system_stats": "System Stats", "ai_usage": "AI Usage",
    "calendar": "Calendar", "maze": "Maze",
}
HIDDEN_PLUGINS = {"snow_report"}            # hidden everywhere until it's fixed (see the Pi CLAUDE.md)


def _plugin_name(pid):
    return PLUGIN_NAMES.get(pid) or pid.replace("_", " ").title()


# ----------------------------------------------------------------------
# Objective-C glue
# ----------------------------------------------------------------------

class _Target(AppKit.NSObject):
    """Receives menu clicks, the status item click and window notifications."""

    def initWithShell_(self, shell):
        self = objc.super(_Target, self).init()
        if self is not None:
            self.shell = shell
        return self

    def menuAction_(self, sender):
        self.shell._run_action(str(sender.representedObject()))

    def statusClicked_(self, sender):
        self.shell._status_clicked()

    def panelResignedKey_(self, notification):
        self.shell._panel_resigned_key()


class _LocationDelegate(AppKit.NSObject):
    def initWithDone_(self, done):
        self = objc.super(_LocationDelegate, self).init()
        if self is not None:
            self.done = done
        return self

    def locationManagerDidChangeAuthorization_(self, manager):
        status = manager.authorizationStatus()
        if status in (3, 4):                     # authorised always / when in use
            manager.requestLocation()
        elif status in (1, 2):                   # restricted / denied
            self.done(None, "Location access is off for Flight Clock in System Settings → "
                            "Privacy & Security → Location Services")

    def locationManager_didUpdateLocations_(self, manager, locations):
        loc = locations[-1].coordinate()
        self.done((loc.latitude, loc.longitude), None)

    def locationManager_didFailWithError_(self, manager, error):
        self.done(None, str(error.localizedDescription()))


def _patch_app_delegate(shell):
    """Make Cmd-Q / Quit actually quit, and a Dock-icon click bring the panel back."""

    def applicationShouldTerminate_(self, app):
        shell._prepare_quit()
        return AppKit.NSTerminateNow

    def applicationShouldHandleReopen_hasVisibleWindows_(self, app, flag):
        AppHelper.callAfter(shell.show_panel)
        return True

    objc.classAddMethods(BrowserView.AppDelegate, [
        objc.selector(applicationShouldTerminate_, selector=b"applicationShouldTerminate:", signature=b"I@:@"),
        objc.selector(applicationShouldHandleReopen_hasVisibleWindows_,
                      selector=b"applicationShouldHandleReopen:hasVisibleWindows:", signature=b"Z@:@Z"),
    ])


# ----------------------------------------------------------------------
# JS bridge for the panel page (window.pywebview.api.*)
# ----------------------------------------------------------------------

class PanelApi:
    def __init__(self, shell):
        self._shell = shell

    def context_menu(self):
        AppHelper.callAfter(self._shell._popup_context_menu)

    def toggle_fullscreen(self):
        self._shell.toggle_fullscreen()


# ----------------------------------------------------------------------
# Shell
# ----------------------------------------------------------------------

class Shell:
    def __init__(self, base_url, pm=None, setup_mode=False, lan_url=None):
        self.base_url = base_url
        self.lan_url = lan_url
        self.pm = pm
        self.setup_mode = setup_mode
        self.prefs = settings.load()
        self.panel = None
        self.settings_win = None
        self._quitting = False
        self._status_item = None
        self._target = None
        self._actions = {}
        self._update = None                      # {"version", "url"} once a newer release is found
        self._location_mgr = None

    # --- startup ------------------------------------------------------

    def run(self):
        """Create the windows and block in the Cocoa run loop."""
        if self.setup_mode:
            # First launch: only the setup wizard. Closing it quits.
            self.settings_win = webview.create_window(
                "Flight Clock Setup", f"{self.base_url}/setup", width=760, height=860, min_size=(480, 600))
        else:
            self.panel = webview.create_window(
                "Flight Clock", f"{self.base_url}/desktop/panel", js_api=PanelApi(self),
                width=PANEL_SIZE[0], height=PANEL_SIZE[1], min_size=(256, 128),
                frameless=True, easy_drag=True, transparent=True, background_color="#000000",
                hidden=self.prefs["window_mode"] == "menubar",
            )
            self.panel.events.closing += self._on_panel_closing
        webview.start(self._started, private_mode=False,
                      storage_path=os.path.join(runtime.DATA_DIR, "webview"))

    def _started(self):
        # Runs on a pywebview worker thread once the GUI loop is up
        AppHelper.callAfter(self._setup_native)
        threading.Thread(target=self._check_for_updates, daemon=True, name="update-check").start()

    def _setup_native(self):
        _patch_app_delegate(self)
        self._target = _Target.alloc().initWithShell_(self)
        self._make_status_item()
        if self.panel:
            win = self.panel.native
            win.setCollectionBehavior_(AppKit.NSWindowCollectionBehaviorFullScreenPrimary)
            self._restore_panel_frame()
            Foundation.NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
                self._target, "panelResignedKey:", AppKit.NSWindowDidResignKeyNotification, win)
            self.panel.events.moved += lambda *a: self._save_panel_frame_soon()
            self.panel.events.resized += lambda *a: self._save_panel_frame_soon()
        self._apply_window_prefs()

    # --- menu bar icon ------------------------------------------------

    def _make_status_item(self):
        bar = AppKit.NSStatusBar.systemStatusBar()
        self._status_item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)
        button = self._status_item.button()
        image = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_("airplane", "Flight Clock")
        if image:
            image.setTemplate_(True)
            button.setImage_(image)
        else:
            button.setTitle_("✈")
        button.setTarget_(self._target)
        button.setAction_("statusClicked:")
        button.sendActionOn_(AppKit.NSEventMaskLeftMouseUp | AppKit.NSEventMaskRightMouseUp)

    def _status_clicked(self):
        event = AppKit.NSApp.currentEvent()
        right = event is not None and (
            event.type() == AppKit.NSEventTypeRightMouseUp
            or event.modifierFlags() & AppKit.NSEventModifierFlagControl)
        if self.panel and self.prefs["window_mode"] == "menubar" and not right:
            self.toggle_panel(under_status_item=True)
            return
        item = self._status_item
        item.setMenu_(self._build_menu())
        item.button().performClick_(None)        # shows the menu attached to the item
        item.setMenu_(None)                       # …then detach, so the next click comes back here

    def _popup_context_menu(self):
        self._build_menu().popUpMenuPositioningItem_atLocation_inView_(
            None, AppKit.NSEvent.mouseLocation(), None)

    # --- menus ----------------------------------------------------------

    def _item(self, menu, title, action=None, checked=False, key=""):
        item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            title, "menuAction:" if action else None, key)
        if action:
            name = f"a{len(self._actions)}"
            self._actions[name] = action
            item.setTarget_(self._target)
            item.setRepresentedObject_(name)
        if checked:
            item.setState_(AppKit.NSControlStateValueOn)
        menu.addItem_(item)
        return item

    def _submenu(self, menu, title):
        sub = AppKit.NSMenu.alloc().initWithTitle_(title)
        item = self._item(menu, title)
        item.setSubmenu_(sub)
        return sub

    def _build_menu(self):
        self._actions = {}
        m = AppKit.NSMenu.alloc().initWithTitle_("Flight Clock")
        m.setAutoenablesItems_(False)
        p = self.prefs

        if self.setup_mode:
            self._item(m, "Show Setup…", self.open_settings)
        else:
            visible = bool(self.panel and self.panel.native and self.panel.native.isVisible())
            self._item(m, "Hide Panel" if visible else "Show Panel", self.toggle_panel)
            self._item(m, "Settings…", lambda: self.open_settings("/config"), key=",")
            self._item(m, "Dashboard…", lambda: self.open_settings("/"))
            m.addItem_(AppKit.NSMenuItem.separatorItem())

            if self.pm:
                status = self.pm.get_status()
                held, active = status.get("held"), status.get("active_plugin")
                sub = self._submenu(m, "Show Module")
                self._item(sub, "Return to Rotation", self._return_to_rotation, checked=not held)
                sub.addItem_(AppKit.NSMenuItem.separatorItem())
                for pid in sorted(self.pm._plugins, key=_plugin_name):
                    if pid in HIDDEN_PLUGINS:
                        continue
                    self._item(sub, _plugin_name(pid), lambda pid=pid: self._show_module(pid),
                               checked=pid == held)
                if active:
                    self._item(m, f"Now showing: {_plugin_name(active)}").setEnabled_(False)
                m.addItem_(AppKit.NSMenuItem.separatorItem())

            sub = self._submenu(m, "Window Mode")
            self._item(sub, "Window + Menu Bar Icon", lambda: self.set_prefs(window_mode="window"),
                       checked=p["window_mode"] == "window")
            self._item(sub, "Menu Bar Only", lambda: self.set_prefs(window_mode="menubar"),
                       checked=p["window_mode"] == "menubar")
            sub = self._submenu(m, "Panel Position")
            for value, title in (("normal", "Normal Window"), ("floating", "Always on Top"),
                                 ("desktop", "On the Desktop (behind windows)")):
                self._item(sub, title, lambda v=value: self.set_prefs(level=v), checked=p["level"] == value)
            sub = self._submenu(m, "LED Style")
            for value, title in (("round", "Round LEDs"), ("square", "Square LEDs"), ("sharp", "Sharp Pixels")):
                self._item(sub, title, lambda v=value: self.set_prefs(led_style=v), checked=p["led_style"] == value)
            sub.addItem_(AppKit.NSMenuItem.separatorItem())
            self._item(sub, "Bezel", lambda: self.set_prefs(bezel=not p["bezel"]), checked=p["bezel"])
            self._item(sub, "Glow", lambda: self.set_prefs(glow=not p["glow"]), checked=p["glow"])
            self._item(m, "Full Screen", self.toggle_fullscreen)
            m.addItem_(AppKit.NSMenuItem.separatorItem())
            self._item(m, "Open in Browser", lambda: self._open_url(self.base_url))

        if self._update:
            self._item(m, f"Update Available: {self._update['version']}…",
                       lambda: self._open_url(self._update["url"]))
        else:
            self._item(m, "Check for Updates…", lambda: threading.Thread(
                target=self._check_for_updates, args=(True,), daemon=True).start())
        self._item(m, f"Flight Clock {__version__}").setEnabled_(False)
        m.addItem_(AppKit.NSMenuItem.separatorItem())
        self._item(m, "Quit Flight Clock", self.quit, key="q")
        return m

    def _run_action(self, name):
        action = self._actions.get(name)
        if action:
            try:
                action()
            except Exception:
                log.exception("[shell] menu action failed")

    # --- panel window -------------------------------------------------

    def _on_panel_closing(self):
        if self._quitting:
            return True
        AppHelper.callAfter(self.hide_panel)         # Cmd-W hides; the Dock icon / menu brings it back
        return False

    def show_panel(self, under_status_item=False):
        if not self.panel or not self.panel.native:
            return
        win = self.panel.native
        if under_status_item:
            self._position_under_status_item(win)
        win.makeKeyAndOrderFront_(None)
        AppKit.NSApp.activateIgnoringOtherApps_(True)

    def hide_panel(self):
        if self.panel and self.panel.native:
            self.panel.native.orderOut_(None)

    def toggle_panel(self, under_status_item=False):
        if self.panel and self.panel.native and self.panel.native.isVisible():
            self.hide_panel()
        else:
            self.show_panel(under_status_item=under_status_item or self.prefs["window_mode"] == "menubar")

    def toggle_fullscreen(self):
        if self.panel:
            AppHelper.callAfter(self._toggle_fullscreen_native)

    def _toggle_fullscreen_native(self):
        win = self.panel.native
        if not win.isVisible():
            self.show_panel()
        # Full screen needs a normal window level; restore the chosen level afterwards
        entering = not (win.styleMask() & AppKit.NSWindowStyleMaskFullScreen)
        if entering:
            win.setLevel_(AppKit.NSNormalWindowLevel)
        win.toggleFullScreen_(None)
        if not entering:
            AppHelper.callLater(1.0, self._apply_window_prefs)

    def _position_under_status_item(self, win):
        button = self._status_item.button() if self._status_item else None
        if not button or not button.window():
            return
        anchor = button.window().frame()
        screen = (button.window().screen() or AppKit.NSScreen.mainScreen()).visibleFrame()
        size = win.frame().size
        x = anchor.origin.x + anchor.size.width / 2 - size.width / 2
        x = max(screen.origin.x + 8, min(x, screen.origin.x + screen.size.width - size.width - 8))
        y = anchor.origin.y - size.height - 6
        win.setFrameOrigin_(Foundation.NSMakePoint(x, y))

    def _panel_resigned_key(self):
        # Menu-bar mode behaves like a drop-down: clicking elsewhere hides it
        if self.prefs["window_mode"] == "menubar" and not self._quitting:
            win = self.panel.native
            if not (win.styleMask() & AppKit.NSWindowStyleMaskFullScreen):
                self.hide_panel()

    def _restore_panel_frame(self):
        frame = self.prefs.get("panel_frame")
        if not frame or len(frame) != 4:
            return
        x, y, w, h = frame
        rect = Foundation.NSMakeRect(x, y, w, h)
        # Only if it's still on a connected screen
        if any(Foundation.NSIntersectsRect(rect, s.visibleFrame()) for s in AppKit.NSScreen.screens()):
            self.panel.native.setFrame_display_(rect, True)

    _save_timer = None

    def _save_panel_frame_soon(self):
        if self._save_timer:
            self._save_timer.cancel()
        self._save_timer = threading.Timer(1.0, lambda: AppHelper.callAfter(self._save_panel_frame))
        self._save_timer.daemon = True
        self._save_timer.start()

    def _save_panel_frame(self):
        if not self.panel or not self.panel.native or self.prefs["window_mode"] == "menubar":
            return                                   # menu-bar mode positions it under the icon each time
        win = self.panel.native
        if win.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
            return
        f = win.frame()
        self.prefs = settings.update({"panel_frame": [f.origin.x, f.origin.y, f.size.width, f.size.height]})

    # --- preferences --------------------------------------------------

    def set_prefs(self, **changes):
        """Save Mac-app settings and apply them now (from the menu or POST /api/desktop/settings)."""
        old = self.prefs
        self.prefs = settings.update(changes)
        if "launch_at_login" in changes and changes["launch_at_login"] != old["launch_at_login"]:
            self._set_launch_at_login(self.prefs["launch_at_login"])
        if self.panel and old["window_mode"] == "menubar" and self.prefs["window_mode"] == "window":
            AppHelper.callAfter(self._restore_panel_frame)     # back from under the menu bar icon
        AppHelper.callAfter(self._apply_window_prefs)
        if self.panel:
            look = {k: self.prefs[k] for k in ("led_style", "bezel", "glow")}
            try:
                self.panel.evaluate_js(f"window.applyPrefs && window.applyPrefs({json.dumps(look)})")
            except Exception:
                pass
        return self.prefs

    def _apply_window_prefs(self):
        app = AppKit.NSApp
        menubar = self.prefs["window_mode"] == "menubar"
        app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory if menubar
                                 else AppKit.NSApplicationActivationPolicyRegular)
        if not self.panel or not self.panel.native:
            return
        win = self.panel.native
        if win.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
            return
        level = self.prefs["level"]
        behaviour = AppKit.NSWindowCollectionBehaviorFullScreenPrimary
        if menubar or level == "floating":
            win.setLevel_(AppKit.NSFloatingWindowLevel)
            behaviour = AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
        elif level == "desktop":
            # Just above the desktop icons, below every app window; on every Space
            win.setLevel_(Quartz.CGWindowLevelForKey(Quartz.kCGDesktopIconWindowLevelKey) + 1)
            behaviour = (AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
                         | AppKit.NSWindowCollectionBehaviorStationary
                         | AppKit.NSWindowCollectionBehaviorIgnoresCycle)
        else:
            win.setLevel_(AppKit.NSNormalWindowLevel)
        win.setCollectionBehavior_(behaviour)
        if not menubar and not win.isVisible():
            win.makeKeyAndOrderFront_(None)
        if not menubar:
            app.activateIgnoringOtherApps_(True)

    def _set_launch_at_login(self, enabled):
        try:
            import ServiceManagement
            svc = ServiceManagement.SMAppService.mainAppService()
            ok, err = (svc.registerAndReturnError_(None) if enabled else svc.unregisterAndReturnError_(None))
            if not ok:
                log.warning(f"[shell] launch at login {'on' if enabled else 'off'} failed: {err}")
        except Exception as e:
            log.warning(f"[shell] launch at login unavailable: {e}")

    def launch_at_login_status(self):
        """'enabled', 'off', 'needs approval' or 'unavailable' (only works from the installed .app)."""
        try:
            import ServiceManagement
            status = ServiceManagement.SMAppService.mainAppService().status()
            return {0: "off", 1: "enabled", 2: "needs approval", 3: "unavailable"}.get(status, "unavailable")
        except Exception:
            return "unavailable"

    # --- settings window ---------------------------------------------

    def open_settings(self, path="/config"):
        AppHelper.callAfter(self._open_settings_native, path)

    def _open_settings_native(self, path):
        url = f"{self.base_url}{path}" if not self.setup_mode else f"{self.base_url}/setup"
        win = self.settings_win
        if win is not None and win.native is not None:
            if path:
                win.load_url(url)
            win.native.makeKeyAndOrderFront_(None)
            AppKit.NSApp.activateIgnoringOtherApps_(True)
            return
        self.settings_win = webview.create_window("Flight Clock Settings", url, width=1180, height=860,
                                                  min_size=(420, 500))
        self.settings_win.events.closed += self._on_settings_closed
        AppKit.NSApp.activateIgnoringOtherApps_(True)

    def _on_settings_closed(self):
        self.settings_win = None

    # --- control ------------------------------------------------------

    def _show_module(self, pid):
        if self.pm:
            self.pm.force_plugin(pid, pin=True)
            if not (self.panel.native and self.panel.native.isVisible()):
                self.show_panel()

    def _return_to_rotation(self):
        if self.pm:
            self.pm.release_hold()

    def _open_url(self, url):
        subprocess.Popen(["open", url])

    def _prepare_quit(self):
        if self._quitting:
            return
        self._quitting = True
        try:
            self._save_panel_frame()
        except Exception:
            pass
        if self.pm:
            self.pm.stop()

    def quit(self):
        self._prepare_quit()
        AppHelper.callAfter(AppKit.NSApp.terminate_, None)

    def relaunch(self):
        """Restart the app (after the setup wizard, or Restart Application in the web UI)."""
        runtime.spawn_relaunch()
        self.quit()

    # --- location (setup wizard) --------------------------------------

    def locate(self, timeout=20):
        """{'lat', 'lon', 'label'} from Location Services. Blocks the calling (web) thread."""
        result = {}
        finished = threading.Event()

        def done(coords, error):
            if not finished.is_set():
                result.update(coords=coords, error=error)
                finished.set()

        def start():
            import CoreLocation
            if not CoreLocation.CLLocationManager.locationServicesEnabled():
                done(None, "Location Services are turned off on this Mac")
                return
            mgr = CoreLocation.CLLocationManager.alloc().init()
            delegate = _LocationDelegate.alloc().initWithDone_(done)
            mgr.setDelegate_(delegate)
            mgr.setDesiredAccuracy_(CoreLocation.kCLLocationAccuracyKilometer)
            self._location_mgr = (mgr, delegate)        # keep both alive until it answers
            if mgr.authorizationStatus() == 0:
                mgr.requestWhenInUseAuthorization()      # the delegate continues once answered
            else:
                delegate.locationManagerDidChangeAuthorization_(mgr)

        AppHelper.callAfter(start)
        if not finished.wait(timeout):
            raise RuntimeError("timed out waiting for Location Services")
        self._location_mgr = None
        if result.get("error"):
            raise RuntimeError(result["error"])
        lat, lon = result["coords"]
        return {"lat": lat, "lon": lon, "label": f"{lat:.3f}, {lon:.3f}"}

    # --- updates ------------------------------------------------------

    def _check_for_updates(self, interactive=False):
        """Look for a newer GitHub release; shown as a menu item (and an alert if asked)."""
        message = None
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{RELEASES_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": f"FlightClock/{__version__}"})
            with urllib.request.urlopen(req, timeout=10) as r:
                rel = json.load(r)
            latest = str(rel.get("tag_name", "")).lstrip("v")
            if latest and _version_tuple(latest) > _version_tuple(__version__):
                dmg = next((a["browser_download_url"] for a in rel.get("assets", [])
                            if a.get("name", "").endswith(".dmg")), None)
                self._update = {"version": latest, "url": dmg or rel.get("html_url")}
                message = f"Flight Clock {latest} is available."
            else:
                message = f"You're up to date (Flight Clock {__version__})."
        except Exception as e:
            log.info(f"[shell] update check failed: {e}")
            message = "Couldn't check for updates right now."
        if interactive:
            AppHelper.callAfter(self._alert, message, self._update)

    def _alert(self, message, update):
        alert = AppKit.NSAlert.alloc().init()
        alert.setMessageText_(message)
        if update:
            alert.addButtonWithTitle_("Download")
            alert.addButtonWithTitle_("Later")
        AppKit.NSApp.activateIgnoringOtherApps_(True)
        if alert.runModal() == AppKit.NSAlertFirstButtonReturn and update:
            self._open_url(update["url"])


def _version_tuple(v):
    out = []
    for part in v.split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits or 0))
    return tuple(out)
