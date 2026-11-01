# PyInstaller spec for Flight Clock on Windows (x64). Run via packaging/build-win.ps1.
#
# Same bundle as the Mac (packaging/bundle.py: the asset allowlist and module
# list), plus the Windows shell, pywebview's WinForms/WebView2 backend and the
# app icon. Builds a onedir folder: dist/Flight Clock/Flight Clock.exe.

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
CORE = os.path.realpath(os.path.join(ROOT, "core-src"))
DESKTOP = os.path.join(ROOT, "desktop")
ART = os.path.join(ROOT, "packaging", "art")

sys.path.insert(0, DESKTOP)
from version import __version__  # noqa: E402

sys.path.insert(0, SPECPATH)
import bundle  # noqa: E402

datas = bundle.datas(CORE, DESKTOP)
datas.append((os.path.join(ART, "icon.ico"), "desktop"))        # window + tray icon (shell_win._icon_path)
hiddenimports, SHARED_PACKAGES = bundle.hiddenimports(CORE)
hiddenimports += ["shell_win", "win_tray", "clr", "webview.platforms.winforms", "webview.platforms.edgechromium"]
binaries = []

# pywebview's WebView2 loader DLLs and .NET assemblies live in webview/lib
datas += collect_data_files("webview", subdir="lib")
binaries += collect_dynamic_libs("webview")
# Windows location for the setup wizard ("Use my PC's location")
for pkg in ("winrt",):
    try:
        hiddenimports += collect_submodules(pkg)
        binaries += collect_dynamic_libs(pkg)
    except Exception:
        pass

a = Analysis(
    [os.path.join(DESKTOP, "app.py")],
    pathex=[CORE, DESKTOP, os.path.join(DESKTOP, "vendor")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=bundle.EXCLUDES + ["AppKit", "Foundation", "objc", "Quartz", "WebKit", "PyObjCTools", "shell_mac"],
    noarchive=False,
    # Also ship the shared packages as .py files: the code builds asset paths like
    # utilities/../fonts, which only resolve if the package folders exist on disk
    module_collection_mode={pkg: "pyz+py" for pkg in SHARED_PACKAGES},
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    # UTF-8 mode: the shared code opens text files without an encoding, which on
    # Windows would otherwise mean the ANSI code page (runtime._ensure_utf8)
    [("X utf8", None, "OPTION")],
    exclude_binaries=True,
    name="Flight Clock",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=os.path.join(ART, "icon.ico"),
    version=None,
)

coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Flight Clock")
