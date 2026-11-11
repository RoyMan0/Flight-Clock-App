"""
The native Mac shell (shell_win.py is the Windows one; shell_common.py what they share): the LED panel window, the Settings window, the menu bar
icon, and the menus that drive them.

Two window modes (Settings → Mac App, or the menu):
  window   the panel is an ordinary window (frameless, resizable) and the app has
           a Dock icon; the menu bar icon opens the menu.
  menubar  no Dock icon. The menu bar icon opens the menu (Show/Hide Panel); the panel
           drops down under the icon the first time, then stays wherever it's put.

pywebview owns the Cocoa main thread; anything touching AppKit from another
thread goes through AppHelper.callAfter.
"""

import logging
import os
import subprocess
import threading

import AppKit
import Foundation
import objc
import Quartz
import webview
from PyObjCTools import AppHelper
from webview.platforms.cocoa import BrowserView

import runtime
import settings
from shell_common import SEP, ShellBase

log = logging.getLogger("desktop.shell")


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
        action = self.shell._actions.get(str(sender.representedObject()))
        if action:
            self.shell.run_action(action)

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


# Resize zones of the frameless panel (window points). macOS's own resize border is a few
# points wide and only where the window is opaque, which the cases' rounded corners aren't.
GRIP_CORNER, GRIP_EDGE = 26, 9

# Kept in the web views' right-click menu (pywebview empties it); e.g. to copy a command
_KEEP_MENU_ITEMS = ("Copy", "Cut", "Paste", "SelectAll", "Select All", "LookUp", "Look Up")


def _patch_webview(shell):
    """Native resize from the panel's corners and edges (with the case's ratio), and Copy /
    Paste in the right-click menu of the Settings window."""
    Host = BrowserView.WebKitHost
    # Only mouseDown: is replaced (pywebview's own Python method, so the original is called
    # directly). Never override mouseUp:/mouseDragged: here: replacing WKWebView's mouseUp:,
    # even with a pass-through to super, stopped WebKit from seeing any click finish (nothing
    # in the Settings window responded). A resize runs its own event loop instead.
    orig_down = Host.mouseDown_

    def zone(win, event):
        if not shell.panel or win is not shell.panel.native:
            return None
        if win.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
            return None
        p, size = event.locationInWindow(), win.frame().size
        near_l, near_r = p.x < GRIP_CORNER, p.x > size.width - GRIP_CORNER
        near_b, near_t = p.y < GRIP_CORNER, p.y > size.height - GRIP_CORNER
        if (near_l or near_r) and (near_b or near_t):
            return (-1 if near_l else 1, 1 if near_t else -1)
        if p.x < GRIP_EDGE or p.x > size.width - GRIP_EDGE:
            return (-1 if p.x < GRIP_EDGE else 1, 0)
        if p.y < GRIP_EDGE:
            return (0, -1)
        if p.y > size.height - GRIP_EDGE:
            return (0, 1)
        return None

    def resize_to(win, f0, start, sx, sy):
        now = AppKit.NSEvent.mouseLocation()
        dx, dy = now.x - start.x, now.y - start.y
        case = settings.CASES[shell.prefs["case"]]
        ratio = case["size"][0] / case["size"][1]
        w0, h0 = f0.size.width, f0.size.height
        by_x = w0 + sx * dx
        by_y = (h0 + sy * dy) * ratio
        if sx and sy:                             # corner: whichever way the mouse moved more
            nw = by_x if abs(by_x - w0) >= abs(by_y - w0) else by_y
        else:
            nw = by_x if sx else by_y
        screen = (win.screen() or AppKit.NSScreen.mainScreen()).visibleFrame()
        nw = max(case["min"][0], min(nw, screen.size.width, screen.size.height * ratio))
        nh = nw / ratio
        x = f0.origin.x + w0 - nw if sx < 0 else f0.origin.x          # the opposite edge stays put
        y = f0.origin.y if sy > 0 else f0.origin.y + h0 - nh
        win.setFrame_display_(Foundation.NSMakeRect(x, y, nw, nh), True)

    def mouseDown_(self, event):
        win = self.window()
        z = zone(win, event)
        if not z:
            return orig_down(self, event)
        # A resize: track the mouse here until the button comes up (the usual Cocoa way), so
        # neither the page nor pywebview's window drag sees this click
        f0, start = win.frame(), AppKit.NSEvent.mouseLocation()
        mask = AppKit.NSEventMaskLeftMouseDragged | AppKit.NSEventMaskLeftMouseUp
        while True:
            ev = win.nextEventMatchingMask_(mask)
            if ev is None or ev.type() == AppKit.NSEventTypeLeftMouseUp:
                break
            resize_to(win, f0, start, *z)
        shell._save_panel_frame_soon()

    def willOpenMenu_withEvent_(self, menu, event):
        # pywebview removes every item (no Reload / Inspect); keep the editing ones
        for item in list(menu.itemArray()):
            ident = str(item.identifier() or "")
            if item.isSeparatorItem() or not any(k in ident or k == str(item.title()) for k in _KEEP_MENU_ITEMS):
                menu.removeItem_(item)
        while menu.numberOfItems() and menu.itemAtIndex_(0).isSeparatorItem():
            menu.removeItemAtIndex_(0)

    Host.mouseDown_ = objc.selector(mouseDown_, selector=b"mouseDown:", signature=b"v@:@")
    Host.willOpenMenu_withEvent_ = objc.selector(willOpenMenu_withEvent_, selector=b"willOpenMenu:withEvent:",
                                                 signature=b"v@:@@")


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

def _apple_silicon() -> bool:
    """True on an M-series Mac, even when this (Intel) build runs under Rosetta."""
    try:
        return subprocess.run(["sysctl", "-n", "hw.optional.arm64"], capture_output=True,
                              text=True, timeout=3).stdout.strip() == "1"
    except Exception:
        return os.uname().machine == "arm64"


class Shell(ShellBase):
    # The update check links to the DMG for this Mac's chip (build.sh names them)
    INSTALLER_SUFFIX = "-AppleSilicon.dmg" if _apple_silicon() else "-Intel.dmg"

    def __init__(self, base_url, pm=None, setup_mode=False, lan_url=None):
        super().__init__(base_url, pm=pm, setup_mode=setup_mode, lan_url=lan_url)
        self._status_item = None
        self._target = None
        self._actions = {}
        self._location_mgr = None

    # --- startup ------------------------------------------------------

    def run(self):
        """Create the windows and block in the Cocoa run loop."""
        if self.setup_mode:
            # First launch: only the setup wizard. Closing it quits.
            self.settings_win = webview.create_window(
                "Flight Clock Setup", f"{self.base_url}/setup", width=760, height=860, min_size=(480, 600))
        else:
            case = settings.CASES[self.prefs["case"]]
            self.panel = webview.create_window(
                "Flight Clock", f"{self.base_url}/desktop/panel", js_api=PanelApi(self),
                width=case["size"][0], height=case["size"][1], min_size=case["min"],
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
        _patch_webview(self)
        self._target = _Target.alloc().initWithShell_(self)
        self._make_status_item()
        if self.panel:
            win = self.panel.native
            win.setCollectionBehavior_(AppKit.NSWindowCollectionBehaviorFullScreenPrimary)
            self._restore_panel_frame()
            self._apply_case_size(resize=False)
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
        # Any click opens the menu (Show/Hide Panel is its first item), in both window modes
        item = self._status_item
        item.setMenu_(self._build_menu())
        item.button().performClick_(None)        # shows the menu attached to the item
        item.setMenu_(None)                       # …then detach, so the next click comes back here

    def _popup_context_menu(self):
        self._build_menu().popUpMenuPositioningItem_atLocation_inView_(
            None, AppKit.NSEvent.mouseLocation(), None)

    # --- menus ----------------------------------------------------------

    def _build_menu(self):
        """The shared menu model (shell_common) as an NSMenu."""
        self._actions = {}
        return self._ns_menu("Flight Clock", self.menu_model())

    def _ns_menu(self, title, items):
        menu = AppKit.NSMenu.alloc().initWithTitle_(title)
        menu.setAutoenablesItems_(False)
        for it in items:
            if it is SEP:
                menu.addItem_(AppKit.NSMenuItem.separatorItem())
                continue
            item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                it.title, "menuAction:" if it.action else None, it.key)
            if it.action:
                name = f"a{len(self._actions)}"
                self._actions[name] = it.action
                item.setTarget_(self._target)
                item.setRepresentedObject_(name)
            if it.checked:
                item.setState_(AppKit.NSControlStateValueOn)
            item.setEnabled_(it.enabled)
            if it.submenu is not None:
                item.setSubmenu_(self._ns_menu(it.title, it.submenu))
            menu.addItem_(item)
        return menu

    # --- panel window -------------------------------------------------

    def _on_panel_closing(self):
        if self._quitting:
            return True
        AppHelper.callAfter(self.hide_panel)         # Cmd-W hides; the Dock icon / menu brings it back
        return False

    def panel_visible(self):
        return bool(self.panel and self.panel.native and self.panel.native.isVisible())

    def show_panel(self, under_status_item=False):
        if not self.panel or not self.panel.native:
            return
        win = self.panel.native
        if under_status_item:
            self._position_under_status_item(win)
        win.makeKeyAndOrderFront_(None)
        self._apply_window_level()
        AppKit.NSApp.activateIgnoringOtherApps_(True)

    def hide_panel(self):
        if self.panel and self.panel.native:
            self.panel.native.orderOut_(None)

    def toggle_panel(self, under_status_item=False):
        if self.panel and self.panel.native and self.panel.native.isVisible():
            self.hide_panel()
        else:
            # Menu-bar mode: the first time (no saved place yet) it drops down under the icon
            first = self.prefs["window_mode"] == "menubar" and not self.prefs.get("panel_frame")
            self.show_panel(under_status_item=under_status_item or first)

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
        # Nothing to do: the panel stays up when another window is clicked, in both modes
        # (menu-bar mode only drops the Dock icon). Kept as the hook for the notification.
        pass

    def _apply_case_size(self, resize=True):
        """Keep the window to the case's shape; on a case change, reshape it around its top-left."""
        if not self.panel or not self.panel.native:
            return
        win = self.panel.native
        case = settings.CASES[self.prefs["case"]]
        w, h = case["size"]
        win.setContentAspectRatio_(Foundation.NSMakeSize(w, h))
        win.setContentMinSize_(Foundation.NSMakeSize(*case["min"]))
        if not resize or win.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
            return
        f = win.frame()
        scale = ((f.size.width * f.size.height) / (w * h)) ** 0.5      # about the same screen area
        nw = max(case["min"][0], round(w * scale))
        nh = round(nw * h / w)
        top = f.origin.y + f.size.height
        win.setFrame_display_animate_(Foundation.NSMakeRect(f.origin.x, top - nh, nw, nh), True, True)
        self._save_panel_frame_soon()

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
        if not self.panel or not self.panel.native:
            return
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
        AppHelper.callAfter(self._apply_window_prefs)
        if self.panel and self.prefs["case"] != old["case"]:
            AppHelper.callAfter(self._apply_case_size)
        self.push_look()
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
        self._apply_window_level()
        if not menubar and not win.isVisible():
            win.makeKeyAndOrderFront_(None)
        if not menubar:
            app.activateIgnoringOtherApps_(True)

    def _apply_window_level(self):
        if not self.panel or not self.panel.native:
            return
        win = self.panel.native
        if win.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
            return
        level = self.prefs["level"]
        behaviour = AppKit.NSWindowCollectionBehaviorFullScreenPrimary
        if level == "floating":
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
        url = f"{self.base_url}{path}" if not self.setup_mode else f"{self.base_url}/setup"
        win = self.settings_win
        if win is not None and win.native is not None:
            AppHelper.callAfter(self._focus_settings, url if path else None)
            return
        # pywebview only creates a window after start() when create_window is called
        # off the main thread (on the main thread it silently does nothing)
        threading.Thread(target=self._create_settings, args=(url,), daemon=True, name="settings-window").start()

    def _create_settings(self, url):
        self.settings_win = webview.create_window("Flight Clock Settings", url, width=1180, height=860,
                                                  min_size=(420, 500))
        self.settings_win.events.closed += self._on_settings_closed
        AppHelper.callAfter(AppKit.NSApp.activateIgnoringOtherApps_, True)

    def _focus_settings(self, url):
        win = self.settings_win
        if win is None or win.native is None:
            return
        if url:
            win.load_url(url)
        win.native.makeKeyAndOrderFront_(None)
        AppKit.NSApp.activateIgnoringOtherApps_(True)

    def _on_settings_closed(self):
        self.settings_win = None

    # --- control ------------------------------------------------------

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

    # --- location (setup wizard) --------------------------------------

    def locate(self, timeout=60):
        """{'lat', 'lon', 'label'} from Location Services. Blocks the calling (web) thread.
        The timeout is long because the first call waits for the user to answer the permission prompt."""
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
            raise RuntimeError("no answer from Location Services. Check that Wi-Fi is on and that Flight Clock "
                               "is allowed in System Settings → Privacy & Security → Location Services")
        self._location_mgr = None
        if result.get("error"):
            raise RuntimeError(result["error"])
        lat, lon = result["coords"]
        return {"lat": lat, "lon": lon, "label": f"{lat:.3f}, {lon:.3f}"}

    # --- media (Now Playing ⏮ ⏯ ⏭) -------------------------------------

    def media_control(self, source, action):
        """app.media_cb: previous / play-pause / next in the Spotify app on this Mac, if it's running (no Web API
        or Premium needed). False → the shared code uses the Web API. The Music app is
        handled by the shared code (mac_music runs osascript locally on the Mac)."""
        if source != "spotify":
            return False
        cmd = {"next": "next track", "previous": "previous track", "playpause": "playpause"}[action]
        script = (f'if application "Spotify" is running then\n tell application "Spotify" to {cmd}\n'
                  f' return "ok"\nend if\nreturn ""\n')
        try:
            r = subprocess.run(["osascript", "-"], input=script, capture_output=True, text=True, timeout=10)
            if r.returncode:
                log.info(f"[shell] Spotify app control failed: {r.stderr.strip()}")
            return r.stdout.strip() == "ok"
        except Exception as e:
            log.info(f"[shell] Spotify app control failed: {e}")
            return False

    # --- alerts -------------------------------------------------------

    def alert(self, message, update=None):
        AppHelper.callAfter(self._alert, message, update)

    def _alert(self, message, update):
        alert = AppKit.NSAlert.alloc().init()
        alert.setMessageText_(message)
        if update:
            alert.addButtonWithTitle_("Download")
            alert.addButtonWithTitle_("Later")
        AppKit.NSApp.activateIgnoringOtherApps_(True)
        if alert.runModal() == AppKit.NSAlertFirstButtonReturn and update:
            runtime.open_path(update["url"])


def notify_already_running():
    import subprocess
    subprocess.Popen(["osascript", "-e", 'display notification "Flight Clock is already running — '
                      'look for the ✈ in the menu bar." with title "Flight Clock"'])
