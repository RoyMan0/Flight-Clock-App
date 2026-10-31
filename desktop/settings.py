"""
Mac-app-only preferences (window behaviour, LED look), kept apart from the
shared config.json so the Pi's config page and schema never see them.

Stored in ~/Library/Application Support/Flight Clock/config/desktop.json.
"""

import json
import os
import threading

import runtime

PATH = os.path.join(runtime.DATA_DIR, "config", "desktop.json")

DEFAULTS = {
    "window_mode": "window",      # "window": panel window + menu bar icon · "menubar": menu bar only, no Dock icon
    "level": "normal",            # "normal" · "floating" (always on top) · "desktop" (sits on the desktop, under windows)
    "led_style": "round",         # "round" · "square" · "sharp"
    "bezel": True,                # dark frame around the panel
    "glow": True,                 # soft bloom around lit LEDs
    "launch_at_login": False,
    "lan_access": False,          # serve the web UI on the network (phone config), not just this Mac
    "panel_frame": None,          # [x, y, w, h] of the panel window, restored on launch
}

CHOICES = {
    "window_mode": ("window", "menubar"),
    "level": ("normal", "floating", "desktop"),
    "led_style": ("round", "square", "sharp"),
}

_lock = threading.Lock()
_prefs = None


def load() -> dict:
    global _prefs
    with _lock:
        if _prefs is None:
            try:
                with open(PATH) as f:
                    saved = json.load(f)
            except Exception:
                saved = {}
            _prefs = {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}
        return dict(_prefs)


def update(changes: dict) -> dict:
    """Validate and save; returns the full prefs. Unknown keys and bad values are ignored."""
    global _prefs
    load()
    with _lock:
        for key, value in changes.items():
            if key not in DEFAULTS:
                continue
            if key in CHOICES and value not in CHOICES[key]:
                continue
            if isinstance(DEFAULTS[key], bool):
                value = bool(value)
            _prefs[key] = value
        tmp = PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(_prefs, f, indent=2)
        os.replace(tmp, PATH)
        return dict(_prefs)
