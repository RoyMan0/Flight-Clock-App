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
    "screen": "led",              # what the display looks like: "led" · "flipboard" · "eink" (see SCREENS)
    "case": "none",               # the window around it (see CASES)
    "case_color": "",             # one of the case's colours; "" = its first
    "flip_sound": False,          # flip board: clatter as the flaps turn
    "led_style": "round",         # "round" · "square" · "sharp"
    "bezel": True,                # dark frame around the panel
    "glow": True,                 # soft bloom around lit LEDs
    "launch_at_login": False,
    "lan_access": False,          # serve the web UI on the network (phone config), not just this Mac
    "panel_frame": None,          # [x, y, w, h] of the panel window, restored on launch
    # The one-time "Enjoying Flight Clock?" tip window (ShellBase.maybe_ask_for_tip)
    "launches": 0,                # normal starts (not the setup wizard)
    "first_launch_at": 0,         # epoch seconds of the first normal start
    "tip_asked": False,           # shown once; never again
}

SCREENS = {
    "led": "LED panel",
    "flipboard": "Flip board",
    "eink": "Colour e-ink",
}

# Window styles. `size` is the default window size, and its ratio is kept when
# the window is resized; the art for each lives in desktop/panel/css/cases.css.
CASES = {
    "none": {"name": "Plain bezel", "size": (640, 320), "min": (256, 128), "colors": {}},
    "bedside": {"name": "80s bedside clock", "size": (760, 340), "min": (380, 170), "colors": {
        "walnut": "Walnut", "teak": "Teak", "oak": "Light oak", "black": "Black ash"}},
    "midcentury": {"name": "Mid-century desk clock", "size": (640, 450), "min": (320, 225), "colors": {
        "mustard": "Mustard", "teal": "Teal", "orange": "Burnt orange", "olive": "Olive",
        "cherry": "Cherry red", "cream": "Cream"}},
    "mac_se": {"name": "Vintage Mac SE style", "size": (440, 480), "min": (220, 240), "colors": {
        "beige": "Classic beige", "platinum": "Platinum"}},
    "imac_g3": {"name": "iMac G3 style", "size": (560, 560), "min": (280, 280), "colors": {
        "bondi": "Bondi Blue", "blueberry": "Blueberry", "strawberry": "Strawberry", "lime": "Lime",
        "grape": "Grape", "tangerine": "Tangerine", "graphite": "Graphite", "indigo": "Indigo",
        "ruby": "Ruby", "sage": "Sage", "snow": "Snow", "flower": "Flower Power",
        "dalmatian": "Blue Dalmatian"}},
}

CHOICES = {
    "window_mode": ("window", "menubar"),
    "level": ("normal", "floating", "desktop"),
    "led_style": ("round", "square", "sharp"),
    "screen": tuple(SCREENS),
    "case": tuple(CASES),
}


def case_color(prefs: dict) -> str:
    """The case colour in use: the saved one if the case has it, else the case's first."""
    colors = list(CASES[prefs["case"]]["colors"])
    return prefs["case_color"] if prefs["case_color"] in colors else (colors[0] if colors else "")


def catalog() -> dict:
    """Screens and cases for the settings card, the menus and the gallery."""
    return {
        "screens": [{"id": k, "name": v} for k, v in SCREENS.items()],
        "cases": [{"id": k, "name": c["name"], "size": c["size"],
                   "colors": [{"id": cid, "name": n} for cid, n in c["colors"].items()]}
                  for k, c in CASES.items()],
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
            for key, allowed in CHOICES.items():
                if _prefs[key] not in allowed:
                    _prefs[key] = DEFAULTS[key]
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
            if key == "case_color":
                case = changes.get("case") if changes.get("case") in CASES else _prefs["case"]
                if value not in CASES[case]["colors"]:
                    continue
            if isinstance(DEFAULTS[key], bool):
                value = bool(value)
            _prefs[key] = value
        tmp = PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(_prefs, f, indent=2)
        os.replace(tmp, PATH)
        return dict(_prefs)
