#!/usr/bin/env python3
"""
Flight Clock for Mac — entry point.

Runs the same plugins and web UI as the Raspberry Pi display (core-src/, the
flight-clock-and-more repo) in software mode, and shows the 64×32 panel in a
native window instead of on an LED matrix.

  Dev:    .venv/bin/python desktop/app.py
  Headless (no windows; open the printed URL in a browser):
          FLIGHTCLOCK_HEADLESS=1 .venv/bin/python desktop/app.py
  Built:  packaging/build.sh  →  dist/Flight Clock.app, dist/FlightClock-<version>.dmg
"""

import runtime

runtime.prepare()      # data dir, env, sys.path, logging — before any shared code is imported

import logging
import os
import subprocess
import sys
import threading

log = logging.getLogger("desktop")


def _register_routes(app, shell):
    """Mac-only endpoints on the shared Flask app."""
    from flask import jsonify, request, send_from_directory
    import settings
    from version import __version__

    @app.get("/desktop/panel")
    def desktop_panel():
        return send_from_directory(runtime.PANEL_DIR, "index.html", max_age=0)

    @app.get("/desktop/gallery")
    def desktop_gallery():
        """Every module on every screen, and every case, from sample data (for choosing a style)."""
        return send_from_directory(runtime.PANEL_DIR, "gallery.html", max_age=0)

    @app.get("/desktop/panel/<path:name>")
    def desktop_panel_file(name):
        if name.split("/")[0] not in ("js", "css"):
            return ("", 404)
        return send_from_directory(runtime.PANEL_DIR, name, max_age=0)

    @app.get("/api/desktop/settings")
    def desktop_settings_get():
        return jsonify({
            **shell.prefs,
            "case_color": settings.case_color(shell.prefs),
            "catalog": settings.catalog(),
            "version": __version__,
            "data_dir": runtime.DATA_DIR,
            "log_file": runtime.LOG_FILE,
            "url": shell.base_url,
            "lan_url": shell.lan_url,
            "launch_at_login_status": shell.launch_at_login_status(),
        })

    @app.post("/api/desktop/settings")
    def desktop_settings_post():
        changes = request.get_json(force=True) or {}
        old_lan = shell.prefs["lan_access"]
        prefs = shell.set_prefs(**changes)
        return jsonify({"ok": True, **prefs, "restart_needed": prefs["lan_access"] != old_lan})

    @app.post("/api/desktop/open/<what>")
    def desktop_open(what):
        target = {"data": runtime.DATA_DIR, "logs": runtime.LOG_DIR}.get(what)
        if not target:
            return jsonify({"ok": False}), 404
        subprocess.Popen(["open", target])
        return jsonify({"ok": True})


def _lan_address():
    """This Mac's LAN IP, for the 'open on your phone' hint."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))         # no packet is sent; just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class _HeadlessShell:
    """Stands in for shell.Shell with FLIGHTCLOCK_HEADLESS=1: prefs only, no windows."""

    def __init__(self, base_url):
        import settings
        self._settings = settings
        self.base_url, self.lan_url = base_url, None
        self.prefs = settings.load()

    def set_prefs(self, **changes):
        self.prefs = self._settings.update(changes)
        return self.prefs

    def launch_at_login_status(self):
        return "unavailable"

    def relaunch(self):
        log.info("[desktop] headless: restart requested (ignored)")

    def locate(self):
        return None


def main():
    if not runtime.acquire_single_instance():
        log.info("[desktop] another copy is already running — exiting")
        subprocess.Popen(["osascript", "-e", 'display notification "Flight Clock is already running — '
                          'look for the ✈ in the menu bar." with title "Flight Clock"'])
        return

    from version import __version__
    log.info(f"[desktop] Flight Clock {__version__} starting (data: {runtime.DATA_DIR})")

    # The canvas mirror must wrap rgbmatrix.graphics before any font is created
    from core import canvas_mirror
    canvas_mirror.install()
    from core.config_manager import get_config
    from web.app import create_app
    import settings
    import shell as shell_mod

    cfg = get_config()
    prefs = settings.load()

    home = (cfg.get("location") or {}).get("location_home") or [0, 0]
    try:
        setup_mode = not any(float(v or 0) for v in home)
    except (TypeError, ValueError):
        setup_mode = True

    host = "0.0.0.0" if prefs["lan_access"] else "127.0.0.1"
    port = runtime.pick_port(host, int((cfg.get("web") or {}).get("port", 8080)))
    lan_url = None
    if prefs["lan_access"]:
        ip = _lan_address()
        lan_url = f"http://{ip}:{port}" if ip else None

    pm = None
    if setup_mode:
        log.info("[desktop] no home location yet — opening the setup wizard")
        app = create_app(cfg, None, None, setup_mode=True)
    else:
        from core.bootstrap import import_plugins, register_plugins
        from core.display_manager import DisplayManager
        from core.plugin_manager import PluginManager

        plugin_classes = import_plugins()
        display = DisplayManager(cfg.get("display") or {}, software_mode=True)
        pm = PluginManager(display, cfg)
        register_plugins(pm, display, cfg, plugin_classes)
        app = create_app(cfg, display, pm)

    headless = os.environ.get("FLIGHTCLOCK_HEADLESS") == "1"
    if headless:
        sh = _HeadlessShell(f"http://127.0.0.1:{port}")
    else:
        sh = shell_mod.Shell(f"http://127.0.0.1:{port}", pm=pm, setup_mode=setup_mode, lan_url=lan_url)
    app.restart_cb = sh.relaunch
    app.locate_cb = sh.locate
    _register_routes(app, sh)

    threading.Thread(
        target=lambda: app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True),
        daemon=True, name="web-server",
    ).start()
    log.info(f"[desktop] web UI on http://{host}:{port}")

    if pm:
        threading.Thread(target=pm.run, daemon=True, name="display-loop").start()

    if headless:
        print(f"Flight Clock headless: http://127.0.0.1:{port}/desktop/panel", flush=True)
        threading.Event().wait()
    sh.run()          # Cocoa main loop; returns when the app quits
    log.info("[desktop] bye")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log.exception("[desktop] fatal error")
        raise
    sys.exit(0)
