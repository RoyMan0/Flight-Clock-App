# PyInstaller spec for Flight Clock.app (Apple Silicon). Run via packaging/build.sh.
#
# Bundles the shared code from core-src/ (the flight-clock-and-more repo) plus
# the desktop shell. Assets are an explicit allowlist: the repo also tracks the
# owner's close.txt / farthest.txt / flight maps, which must never ship.

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
CORE = os.path.realpath(os.path.join(ROOT, "core-src"))
DESKTOP = os.path.join(ROOT, "desktop")
ART = os.path.join(ROOT, "packaging", "art")

sys.path.insert(0, DESKTOP)
from version import __version__  # noqa: E402

# ---- shared-code assets (source, destination inside the bundle) -------------
datas = [
    (os.path.join(CORE, "fonts"), "fonts"),
    (os.path.join(CORE, "logos"), "logos"),
    (os.path.join(CORE, "icons"), "icons"),
    (os.path.join(CORE, "assets", "world_daylight"), os.path.join("assets", "world_daylight")),
    (os.path.join(CORE, "airports.json"), "."),
    (os.path.join(CORE, "airbus.mp3"), "."),
    (os.path.join(CORE, "espn.mp3"), "."),
    (os.path.join(CORE, "config", "config.example.json"), "config"),
    (os.path.join(CORE, "config", "secrets.example.json"), "config"),
    (os.path.join(CORE, "plugins", "transit", "cta_rail_order.json"), os.path.join("plugins", "transit")),
    (os.path.join(CORE, "web", "templates"), os.path.join("web", "templates")),
    (os.path.join(DESKTOP, "panel"), os.path.join("desktop", "panel")),
]
for name in os.listdir(os.path.join(CORE, "web", "static")):          # favicons only — not maps/
    path = os.path.join(CORE, "web", "static", name)
    if os.path.isfile(path):
        datas.append((path, os.path.join("web", "static")))

# Library data files PyInstaller's own hooks don't pick up
for pkg in ("folium", "branca", "xyzservices", "recurring_ical_events", "x_wr_timezone", "tzdata"):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

# ---- modules ------------------------------------------------------------------
# Plugins are imported by name (core/bootstrap.py), so list every shared module.
SKIP_DIRS = {"scripts", "rgbmatrix", "__pycache__", ".git", ".cache", "data", "config", "logos", "icons", "fonts"}
SKIP_FILES = {"main.py", "its-a-plane.py"}
hiddenimports = []
for dirpath, dirnames, filenames in os.walk(CORE):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
    for fn in filenames:
        if fn.endswith(".py") and fn not in SKIP_FILES:
            rel = os.path.relpath(os.path.join(dirpath, fn), CORE)[:-3]
            mod = rel.replace(os.sep, ".")
            if mod.endswith(".__init__"):
                mod = mod[: -len(".__init__")]
            hiddenimports.append(mod)
SHARED_PACKAGES = sorted({m.split(".")[0] for m in hiddenimports if "." in m})
hiddenimports += ["rgbmatrix", "rgbmatrix.graphics"]
for pkg in ("fr24", "google.transit", "icalendar", "recurring_ical_events", "h2", "hpack", "httpx", "qrcode"):
    try:
        hiddenimports += collect_submodules(pkg)
    except Exception:
        pass
hiddenimports += ["CoreLocation", "ServiceManagement", "Quartz", "WebKit"]

a = Analysis(
    [os.path.join(DESKTOP, "app.py")],
    pathex=[CORE, DESKTOP, os.path.join(DESKTOP, "vendor")],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "numpy.tests", "PyQt5", "PyQt6", "PySide6", "gi"],
    noarchive=False,
    # Also ship the shared packages as .py files: the code builds asset paths like
    # utilities/../fonts, which only resolve if the package folders exist on disk
    module_collection_mode={pkg: "pyz+py" for pkg in SHARED_PACKAGES},
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Flight Clock",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    target_arch="arm64",
    codesign_identity=None,          # ad-hoc; build.sh re-signs (Developer ID when configured)
)

coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Flight Clock")

app = BUNDLE(
    coll,
    name="Flight Clock.app",
    icon=os.path.join(ART, "icon.icns"),
    bundle_identifier="com.roymano.flightclock",
    version=__version__,
    info_plist={
        "CFBundleDisplayName": "Flight Clock",
        "CFBundleShortVersionString": __version__,
        "CFBundleVersion": __version__,
        "LSMinimumSystemVersion": "13.0",
        "LSApplicationCategoryType": "public.app-category.utilities",
        "NSHighResolutionCapable": True,
        "NSHumanReadableCopyright": "Flight Clock",
        "NSLocationWhenInUseUsageDescription":
            "Flight Clock uses your location once, during setup, to find planes overhead and your local weather.",
        "NSLocationUsageDescription":
            "Flight Clock uses your location once, during setup, to find planes overhead and your local weather.",
        "NSAppleEventsUsageDescription":
            "Flight Clock reads the song playing in the Music app for the Now Playing module.",
        # The panel and settings windows load the built-in web UI from 127.0.0.1
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    },
)
