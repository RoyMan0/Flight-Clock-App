# PyInstaller spec for Flight Clock.app. Run via packaging/build.sh, which builds it twice:
# FC_ARCH=arm64 (Apple Silicon) and FC_ARCH=x86_64 (Intel, from an x86_64 Python under Rosetta).
#
# Bundles the shared code from core-src/ (the flight-clock-and-more repo) plus
# the desktop shell. What ships is listed in packaging/bundle.py (an allowlist:
# the repo also tracks the owner's close.txt / farthest.txt / flight maps).

import os
import sys

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
CORE = os.path.realpath(os.path.join(ROOT, "core-src"))
DESKTOP = os.path.join(ROOT, "desktop")
ART = os.path.join(ROOT, "packaging", "art")

sys.path.insert(0, DESKTOP)
from version import __version__  # noqa: E402

sys.path.insert(0, SPECPATH)
import bundle  # noqa: E402  (packaging/bundle.py: the asset allowlist and module list, shared with Windows)

datas = bundle.datas(CORE, DESKTOP)
hiddenimports, SHARED_PACKAGES = bundle.hiddenimports(CORE)
hiddenimports += ["CoreLocation", "ServiceManagement", "Quartz", "WebKit", "shell_mac"]

a = Analysis(
    [os.path.join(DESKTOP, "app.py")],
    pathex=[CORE, DESKTOP, os.path.join(DESKTOP, "vendor")],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=bundle.EXCLUDES,
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
    target_arch=os.environ.get("FC_ARCH", "arm64"),
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
        "LSMinimumSystemVersion": "11.0" if os.environ.get("FC_ARCH") == "x86_64" else "13.0",
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
