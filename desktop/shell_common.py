"""
What the Mac and Windows shells share: the menu (as a platform-neutral model
each shell draws natively), the prefs the panel draws with, module control and
the update check. shell_mac.py and shell_win.py subclass ShellBase.
"""

import json
import logging
import threading
import urllib.request

import runtime
import settings
from version import __version__, RELEASES_REPO

log = logging.getLogger("desktop.shell")


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
HIDDEN_PLUGINS = set()                      # modules left out of the Show Module menu


def plugin_name(pid):
    return PLUGIN_NAMES.get(pid) or pid.replace("_", " ").title()


class Item:
    """One menu entry. `submenu` is a list of Items (None in it = separator)."""

    __slots__ = ("title", "action", "checked", "enabled", "key", "submenu", "default")

    def __init__(self, title, action=None, checked=False, enabled=True, key="", submenu=None, default=False):
        self.title, self.action, self.checked, self.enabled = title, action, checked, enabled
        self.key, self.submenu, self.default = key, submenu, default


SEP = None


class ShellBase:
    # Wording that differs per platform (the window-mode names)
    MODE_TITLES = {"window": "Window + Menu Bar Icon", "menubar": "Menu Bar Only"}
    INSTALLER_SUFFIX = ".dmg"                    # release asset the update check links to

    def __init__(self, base_url, pm=None, setup_mode=False, lan_url=None):
        self.base_url = base_url
        self.lan_url = lan_url
        self.pm = pm
        self.setup_mode = setup_mode
        self.prefs = settings.load()
        self.panel = None
        self.settings_win = None
        self._quitting = False
        self._update = None                      # {"version", "url"} once a newer release is found

    # --- per-platform hooks ------------------------------------------

    def panel_visible(self) -> bool:
        raise NotImplementedError

    def toggle_panel(self):
        raise NotImplementedError

    def show_panel(self):
        raise NotImplementedError

    def toggle_fullscreen(self):
        raise NotImplementedError

    def open_settings(self, path="/config"):
        raise NotImplementedError

    def quit(self):
        raise NotImplementedError

    def alert(self, message, update=None):
        raise NotImplementedError

    # --- menu -----------------------------------------------------------

    def menu_model(self):
        """The ✈ menu (and the panel's right-click menu), rebuilt each time it opens."""
        p = self.prefs
        m = []
        if self.setup_mode:
            m.append(Item("Show Setup…", self.open_settings, default=True))
        else:
            m.append(Item("Hide Panel" if self.panel_visible() else "Show Panel", self.toggle_panel, default=True))
            m.append(Item("Settings…", lambda: self.open_settings("/config"), key=","))
            m.append(Item("Dashboard…", lambda: self.open_settings("/")))
            m.append(SEP)

            if self.pm:
                status = self.pm.get_status()
                held, active = status.get("held"), status.get("active_plugin")
                modules = [Item("Return to Rotation", self._return_to_rotation, checked=not held), SEP]
                for pid in sorted(self.pm._plugins, key=plugin_name):
                    if pid not in HIDDEN_PLUGINS:
                        modules.append(Item(plugin_name(pid), lambda pid=pid: self._show_module(pid),
                                            checked=pid == held))
                m.append(Item("Show Module", submenu=modules))
                if active:
                    m.append(Item(f"Now showing: {plugin_name(active)}", enabled=False))
                m.append(SEP)

            m.append(Item("Window Mode", submenu=[
                Item(title, lambda v=value: self.set_prefs(window_mode=v), checked=p["window_mode"] == value)
                for value, title in self.MODE_TITLES.items()]))
            m.append(Item("Panel Position", submenu=[
                Item(title, lambda v=value: self.set_prefs(level=v), checked=p["level"] == value)
                for value, title in (("normal", "Normal Window"), ("floating", "Always on Top"),
                                     ("desktop", "On the Desktop (behind windows)"))]))
            m.append(Item("Style", submenu=self._style_model(p)))
            m.append(Item("Full Screen", self.toggle_fullscreen))
            m.append(SEP)
            m.append(Item("Open in Browser", lambda: runtime.open_path(self.base_url)))

        if self._update:
            m.append(Item(f"Update Available: {self._update['version']}…",
                          lambda: runtime.open_path(self._update["url"])))
        else:
            m.append(Item("Check for Updates…", lambda: threading.Thread(
                target=self._check_for_updates, args=(True,), daemon=True).start()))
        m.append(Item(f"Flight Clock {__version__}", enabled=False))
        m.append(SEP)
        m.append(Item("Quit Flight Clock", self.quit, key="q"))
        return m

    def _style_model(self, p):
        """Style ▸ screen, case, case colour, and the options of each."""
        s = [Item(title, lambda v=value: self.set_prefs(screen=v), checked=p["screen"] == value)
             for value, title in settings.SCREENS.items()]
        s.append(SEP)
        s += [Item(case["name"], lambda v=value: self.set_prefs(case=v), checked=p["case"] == value)
              for value, case in settings.CASES.items()]
        colors = settings.CASES[p["case"]]["colors"]
        if colors:
            current = settings.case_color(p)
            s.append(Item("Colour", submenu=[
                Item(title, lambda v=value: self.set_prefs(case_color=v), checked=current == value)
                for value, title in colors.items()]))
        s.append(SEP)
        if p["screen"] == "led":
            s += [Item(title, lambda v=value: self.set_prefs(led_style=v), checked=p["led_style"] == value)
                  for value, title in (("round", "Round LEDs"), ("square", "Square LEDs"), ("sharp", "Sharp Pixels"))]
            s.append(Item("Glow", lambda: self.set_prefs(glow=not p["glow"]), checked=p["glow"]))
        if p["screen"] == "flipboard":
            s.append(Item("Flip Sound", lambda: self.set_prefs(flip_sound=not p["flip_sound"]), checked=p["flip_sound"]))
        if p["case"] == "none":
            s.append(Item("Bezel", lambda: self.set_prefs(bezel=not p["bezel"]), checked=p["bezel"]))
        return s

    @staticmethod
    def run_action(action):
        try:
            action()
        except Exception:
            log.exception("[shell] menu action failed")

    # --- prefs ----------------------------------------------------------

    def look(self) -> dict:
        """The prefs the panel page draws with (window.applyPrefs)."""
        p = self.prefs
        return {**{k: p[k] for k in ("screen", "case", "flip_sound", "led_style", "bezel", "glow")},
                "case_color": settings.case_color(p)}

    def push_look(self):
        if self.panel:
            try:
                self.panel.evaluate_js(f"window.applyPrefs && window.applyPrefs({json.dumps(self.look())})")
            except Exception:
                pass

    # --- control --------------------------------------------------------

    def _show_module(self, pid):
        if self.pm:
            self.pm.force_plugin(pid, pin=True)
            if not self.panel_visible():
                self.show_panel()

    def _return_to_rotation(self):
        if self.pm:
            self.pm.release_hold()

    def relaunch(self):
        """Restart the app (after the setup wizard, or Restart Application in the web UI)."""
        runtime.spawn_relaunch()
        self.quit()

    # --- updates --------------------------------------------------------

    def _check_for_updates(self, interactive=False):
        """Look for a newer GitHub release; shown as a menu item (and an alert if asked)."""
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{RELEASES_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": f"FlightClock/{__version__}"})
            with urllib.request.urlopen(req, timeout=10) as r:
                rel = json.load(r)
            latest = str(rel.get("tag_name", "")).lstrip("v")
            if latest and version_tuple(latest) > version_tuple(__version__):
                asset = next((a["browser_download_url"] for a in rel.get("assets", [])
                              if a.get("name", "").endswith(self.INSTALLER_SUFFIX)), None)
                self._update = {"version": latest, "url": asset or rel.get("html_url")}
                message = f"Flight Clock {latest} is available."
            else:
                message = f"You're up to date (Flight Clock {__version__})."
        except Exception as e:
            log.info(f"[shell] update check failed: {e}")
            message = "Couldn't check for updates right now."
        if interactive:
            self.alert(message, self._update)


def version_tuple(v):
    out = []
    for part in v.split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits or 0))
    return tuple(out)
