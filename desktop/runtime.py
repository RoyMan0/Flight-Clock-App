r"""
Process setup for the Mac and Windows apps, done before any Flight Clock code is imported.

The installed app is read-only, so everything the display writes — config,
secrets, caches, flight history, logs — goes to the user's own folders:

  Mac       ~/Library/Application Support/Flight Clock/   config/ data/ .cache/ …
            ~/Library/Logs/Flight Clock/flightclock.log
  Windows   %APPDATA%\Flight Clock\                       config\ data\ .cache\ …
            %LOCALAPPDATA%\Flight Clock\Logs\flightclock.log

The shared code reads FLIGHTCLOCK_DATA_DIR / FLIGHTCLOCK_DESKTOP (utilities/paths.py).
"""

import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
from logging.handlers import RotatingFileHandler

APP_NAME = "Flight Clock"
IS_WIN = sys.platform == "win32"
# FLIGHTCLOCK_DATA_DIR overrides both (testing with a throwaway folder)
_OVERRIDE = os.environ.get("FLIGHTCLOCK_DATA_DIR")
if IS_WIN:
    _HOME_DATA = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), APP_NAME)
    _HOME_LOGS = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), APP_NAME, "Logs")
else:
    _HOME_DATA = os.path.expanduser(f"~/Library/Application Support/{APP_NAME}")
    _HOME_LOGS = os.path.expanduser(f"~/Library/Logs/{APP_NAME}")
DATA_DIR = _OVERRIDE or _HOME_DATA
LOG_DIR = os.path.join(_OVERRIDE, "logs") if _OVERRIDE else _HOME_LOGS
LOG_FILE = os.path.join(LOG_DIR, "flightclock.log")

FROZEN = getattr(sys, "frozen", False)
DESKTOP_DIR = os.path.dirname(os.path.abspath(__file__))

if FROZEN:
    # PyInstaller unpacks the shared code, assets and desktop/panel next to each other
    CODE_ROOT = sys._MEIPASS
    PANEL_DIR = os.path.join(sys._MEIPASS, "desktop", "panel")
else:
    CODE_ROOT = os.path.realpath(os.path.join(DESKTOP_DIR, "..", "core-src"))
    PANEL_DIR = os.path.join(DESKTOP_DIR, "panel")

_lock_fd = None


def prepare():
    """Environment, import path, data folders and logging. Call first."""
    _ensure_utf8()
    os.environ["FLIGHTCLOCK_DATA_DIR"] = DATA_DIR
    os.environ["FLIGHTCLOCK_DESKTOP"] = "1"
    for sub in ("config", "data", ".cache"):
        os.makedirs(os.path.join(DATA_DIR, sub), exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)

    if not FROZEN:
        # Shared code first, then the vendored rgbmatrix stub (the Pi repo gitignores its own)
        sys.path.insert(0, CODE_ROOT)
        sys.path.insert(1, os.path.join(DESKTOP_DIR, "vendor"))

    # Some legacy modules use paths relative to the working directory. Make argv[0]
    # absolute first: pywebview resolves its base URI from it.
    sys.argv[0] = os.path.abspath(sys.argv[0])
    os.chdir(DATA_DIR)
    _seed_config()
    _setup_logging()


def _ensure_utf8():
    """Windows: the shared code opens text files without an encoding, which there
    means the ANSI code page, not UTF-8. The built app sets Python's UTF-8 mode
    (FlightClock-win.spec); a dev run restarts itself with it."""
    if not IS_WIN or sys.flags.utf8_mode:
        return
    if FROZEN:
        return
    env = dict(os.environ, PYTHONUTF8="1")
    sys.exit(subprocess.call([sys.executable, *sys.argv], env=env))


def _seed_config():
    """First launch: start from the example config, with the clock turned on."""
    path = os.path.join(DATA_DIR, "config", "config.json")
    if os.path.exists(path):
        return
    example = os.path.join(CODE_ROOT, "config", "config.example.json")
    shutil.copy2(example, path)
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        cfg.setdefault("plugins", {}).setdefault("clock_weather", {})["enabled"] = True
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass


def _setup_logging():
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    handlers = [RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8")]
    if not FROZEN:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format=fmt, handlers=handlers, force=True)
    for name in ("werkzeug", "httpx", "fr24", "pywebview"):
        logging.getLogger(name).setLevel(logging.WARNING)


def acquire_single_instance(wait: float = 6.0) -> bool:
    """Only one copy may run (two would fight over config and the port).

    Waits a few seconds so a relaunch can start while the old process is exiting.
    """
    global _lock_fd
    _lock_fd = open(os.path.join(DATA_DIR, ".lock"), "a+")
    deadline = time.monotonic() + wait
    while True:
        try:
            if IS_WIN:
                import msvcrt
                _lock_fd.seek(0)
                msvcrt.locking(_lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            if time.monotonic() > deadline:
                return False
            time.sleep(0.25)


def pick_port(host: str, preferred: int) -> int:
    """The preferred port (8080, like the Pi) if it's free, otherwise any free port."""
    for port in (preferred, 0):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((host, port))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError("no free port")


def app_bundle_path():
    """…/Flight Clock.app when frozen on the Mac, else None."""
    if not FROZEN or IS_WIN:
        return None
    path = os.path.abspath(sys.executable)          # …/Flight Clock.app/Contents/MacOS/Flight Clock
    for _ in range(3):
        path = os.path.dirname(path)
    return path if path.endswith(".app") else None


def spawn_relaunch():
    """Start a fresh copy once this one has exited (it waits on the instance lock)."""
    if IS_WIN:
        cmd = [sys.executable] if FROZEN else [sys.executable, os.path.abspath(sys.argv[0])]
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        subprocess.Popen(cmd, creationflags=flags, close_fds=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    bundle = app_bundle_path()
    if bundle:
        cmd = f'sleep 1; open -n "{bundle}"'
    else:
        cmd = f'sleep 1; exec "{sys.executable}" "{os.path.abspath(sys.argv[0])}"'
    subprocess.Popen(["/bin/sh", "-c", cmd], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def open_path(target: str):
    """Open a folder, file or URL with the system's default app."""
    if IS_WIN:
        os.startfile(target)
    else:
        subprocess.Popen(["open", target])
