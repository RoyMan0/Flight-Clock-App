"""
What goes into the app bundle, shared by FlightClock.spec (Mac) and
FlightClock-win.spec (Windows).

Assets are an explicit allowlist: the Pi repo also tracks the owner's close.txt /
farthest.txt / flight maps, which must never ship. Never switch to "bundle
every tracked file".
"""

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


def datas(core, desktop):
    """(source, destination inside the bundle) for the shared code's assets and the panel page."""
    out = [
        (os.path.join(core, "fonts"), "fonts"),
        (os.path.join(core, "logos"), "logos"),
        (os.path.join(core, "icons"), "icons"),
        (os.path.join(core, "assets", "world_daylight"), os.path.join("assets", "world_daylight")),
        (os.path.join(core, "airports.json"), "."),
        (os.path.join(core, "airbus.mp3"), "."),
        (os.path.join(core, "espn.mp3"), "."),
        (os.path.join(core, "config", "config.example.json"), "config"),
        (os.path.join(core, "config", "secrets.example.json"), "config"),
        (os.path.join(core, "web", "templates"), os.path.join("web", "templates")),
        (os.path.join(desktop, "panel"), os.path.join("desktop", "panel")),
    ]
    for name in os.listdir(os.path.join(core, "web", "static")):          # favicons only — not maps/
        path = os.path.join(core, "web", "static", name)
        if os.path.isfile(path):
            out.append((path, os.path.join("web", "static")))
    # Plugin data files committed next to the code (snow_report/resorts.json — the resort
    # search index —, transit/cta_rail_order.json …). Plugins write runtime data under
    # DATA_ROOT, never here, so a plugin folder holds no personal files.
    plugins = os.path.join(core, "plugins")
    for dirpath, dirnames, filenames in os.walk(plugins):
        dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "data") and not d.startswith(".")]
        for fn in filenames:
            if fn.endswith(".json"):
                out.append((os.path.join(dirpath, fn), os.path.relpath(dirpath, core)))

    # Library data files PyInstaller's own hooks don't pick up
    for pkg in ("folium", "branca", "xyzservices", "recurring_ical_events", "x_wr_timezone", "tzdata"):
        try:
            out += collect_data_files(pkg)
        except Exception:
            pass
    return out


SKIP_DIRS = {"scripts", "rgbmatrix", "__pycache__", ".git", ".cache", "data", "config", "logos", "icons", "fonts"}
SKIP_FILES = {"main.py", "its-a-plane.py"}


def hiddenimports(core):
    """(modules, shared package names). Plugins are imported by name (core/bootstrap.py),
    so every shared module is listed."""
    mods = []
    for dirpath, dirnames, filenames in os.walk(core):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.endswith(".py") and fn not in SKIP_FILES:
                rel = os.path.relpath(os.path.join(dirpath, fn), core)[:-3]
                mod = rel.replace(os.sep, ".")
                if mod.endswith(".__init__"):
                    mod = mod[: -len(".__init__")]
                mods.append(mod)
    shared = sorted({m.split(".")[0] for m in mods if "." in m})
    mods += ["rgbmatrix", "rgbmatrix.graphics"]
    for pkg in ("fr24", "google.transit", "icalendar", "recurring_ical_events", "h2", "hpack", "httpx", "qrcode"):
        try:
            mods += collect_submodules(pkg)
        except Exception:
            pass
    return mods, shared


EXCLUDES = ["tkinter", "matplotlib", "numpy.tests", "PyQt5", "PyQt6", "PySide6", "gi"]
