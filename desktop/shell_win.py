"""
The Windows shell: the LED panel window, the Settings window, the ✈ tray icon,
and the menus that drive them. (shell_mac.py is the Mac one; shell_common.py
holds the menu and everything else they share.)

Two window modes (Settings → Windows App, or the menu):
  window   the panel is an ordinary window (frameless, resizable) with a taskbar
           button; clicking the tray icon shows or hides it.
  menubar  "tray only": no taskbar button. Clicking the tray icon shows or hides the
           panel (beside the tray the first time; after that where you left it).

pywebview runs WinForms + Edge WebView2 on the main thread. Its window methods
(show, hide, resize, move, on_top) are safe from any thread; anything that
touches the WinForms Form directly goes through _ui(). Win32 calls on the
window handle (SetWindowPos, styles) work from any thread.
"""

import ctypes
import io
import logging
import os
import sys
import threading
import time
from ctypes import wintypes

import webview

import runtime
import settings
import win_tray
from shell_common import ShellBase

log = logging.getLogger("desktop.shell")

# Software drawing in WebView2. With a GPU, WebView2 composites through DirectComposition,
# which ignored every way of shaping the panel window (colour key, blur-behind and the
# window region all left a dark rectangle round the case on a real PC, and all worked on
# CI, which has no GPU). The panel is small; drawing it on the CPU is cheap. WebView2 reads
# this before pywebview's own arguments, so pywebview's flag is repeated here.
os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                      "--disable-features=ElasticOverscroll --disable-gpu")

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, wintypes.UINT]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
user32.SetWindowRgn.argtypes = [wintypes.HWND, wintypes.HANDLE, wintypes.BOOL]
user32.MonitorFromPoint.restype = wintypes.HANDLE
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short
VK_LBUTTON = 0x01

HWND_BOTTOM = 1
SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE = 0x1, 0x2, 0x4, 0x10
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW, WS_EX_APPWINDOW = 0x80, 0x40000
MONITOR_DEFAULTTONEAREST = 2

WEBVIEW2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD)]


user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]


def _icon_path():
    """icon.ico: next to the code in the built app, packaging/art/ in a dev run."""
    for path in (os.path.join(runtime.CODE_ROOT, "desktop", "icon.ico"),
                 os.path.join(runtime.DESKTOP_DIR, "..", "packaging", "art", "icon.ico")):
        if os.path.isfile(path):
            return os.path.abspath(path)
    return None


# pywebview's "transparent" only clears the web view; the Form behind it is opaque, which
# showed as white or grey corners round the LED box and borders round every case. Making the
# window itself see-through doesn't work reliably with WebView2: a colour key (layered window)
# and DWM blur-behind both worked on CI (no GPU) but left grey corners on a real PC, and the
# colour key broke moving/resizing. So the window is cut to the case's shape instead (a window
# region): the shell snapshots the page (CapturePreviewAsync keeps its transparency) and turns
# the opaque pixels into the region. Outside it there is no window at all, on any GPU, and
# clicks go through. The cost: no drop shadow outside the case, and hard (not anti-aliased) edges.
RGN_OR = 2
SHAPE_MIN_FILL = 0.05            # a nearly empty snapshot is a page still loading: keep the old shape


def _black_backing(form):
    """Black behind the page: what the shape's anti-aliased edge pixels blend with."""
    from System.Drawing import Color
    form.BackColor = Color.Black


def _capture_page(form):
    """A PNG of the panel page with its transparency (WebView2 CapturePreviewAsync).
    Call off the UI thread: the capture starts on it, and this waits for it."""
    from System.IO import MemoryStream
    from Microsoft.Web.WebView2.Core import CoreWebView2CapturePreviewImageFormat
    stream = MemoryStream()
    task = _run_on_ui(form, lambda: form.webview.CoreWebView2.CapturePreviewAsync(
        CoreWebView2CapturePreviewImageFormat.Png, stream))
    if not task.Wait(5000):
        raise TimeoutError("page snapshot timed out")
    return bytes(stream.ToArray())


def _mask_from_png(png):
    from PIL import Image
    im = Image.open(io.BytesIO(png))
    if "A" not in im.getbands():
        return None
    return im.getchannel("A").point(lambda v: 255 if v >= 96 else 0)


def _region_from_mask(mask, w, h, dx=0, dy=0):
    """A GDI region of the mask's opaque pixels, scaled to w×h and placed at (dx, dy) in the
    window. Rows with the same runs are merged into one band, so a case is a few dozen
    rectangles, not one per row."""
    from PIL import Image
    if mask.size != (w, h):
        mask = mask.resize((w, h), Image.NEAREST)
    data = mask.tobytes()
    gdi32 = ctypes.windll.gdi32
    gdi32.CreateRectRgn.restype = wintypes.HANDLE
    gdi32.CombineRgn.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE, ctypes.c_int]
    gdi32.DeleteObject.argtypes = [wintypes.HANDLE]
    region = gdi32.CreateRectRgn(0, 0, 0, 0)

    def add(runs, y0, y1):
        for x0, x1 in runs:
            r = gdi32.CreateRectRgn(x0 + dx, y0 + dy, x1 + dx, y1 + dy)
            gdi32.CombineRgn(region, region, r, RGN_OR)
            gdi32.DeleteObject(r)

    band, band_y = None, 0
    for y in range(h):
        row, runs, x = data[y * w:(y + 1) * w], [], 0
        while True:
            x0 = row.find(b"\xff", x)
            if x0 < 0:
                break
            x1 = row.find(b"\x00", x0)
            x1 = w if x1 < 0 else x1
            runs.append((x0, x1))
            x = x1
        if runs != band:
            if band:
                add(band, band_y, y)
            band, band_y = runs, y
    if band:
        add(band, band_y, h)
    return region


def _run_on_ui(form, fn):
    """Run fn on the WinForms thread that owns `form`; returns its result."""
    from System import Action
    out = []
    call = Action(lambda: out.append(fn()))
    if form.InvokeRequired:
        form.Invoke(call)
    else:
        call()
    return out[0] if out else None


# ----------------------------------------------------------------------
# JS bridge for the panel page (window.pywebview.api.*)
# ----------------------------------------------------------------------

class PanelApi:
    def __init__(self, shell):
        self._shell = shell

    def context_menu(self):
        if self._shell.tray:
            self._shell.tray.popup_menu()

    def toggle_fullscreen(self):
        self._shell.toggle_fullscreen()

    def resize_start(self, sx, sy):
        self._shell.resize_drag(int(sx), int(sy))


# ----------------------------------------------------------------------
# Shell
# ----------------------------------------------------------------------

class Shell(ShellBase):
    MODE_TITLES = {"window": "Window + Tray Icon", "menubar": "Tray Only (no taskbar button)"}
    INSTALLER_SUFFIX = ".exe"

    def __init__(self, base_url, pm=None, setup_mode=False, lan_url=None):
        super().__init__(base_url, pm=pm, setup_mode=setup_mode, lan_url=lan_url)
        self.tray = None
        self._hwnd = None
        self._fullscreen = False
        self._ratio_timer = None
        self._save_timer = None
        self._resizing = False
        self._mask = None                # the case's shape (opaque pixels of the last page snapshot)
        self._shape_timer = None

    # --- startup ------------------------------------------------------

    def run(self):
        """Create the windows and block in the WinForms loop."""
        if self.setup_mode:
            # First launch: only the setup wizard. Closing it quits.
            self.settings_win = webview.create_window(
                "Flight Clock Setup", f"{self.base_url}/setup", width=760, height=860, min_size=(480, 600))
        else:
            case = settings.CASES[self.prefs["case"]]
            w, h = case["size"]
            x = y = None
            frame = self.prefs.get("panel_frame")
            if frame and len(frame) == 4 and _on_a_screen(frame):
                x, y, w, h = (int(v) for v in frame)
            self.panel = webview.create_window(
                "Flight Clock", f"{self.base_url}/desktop/panel", js_api=PanelApi(self),
                width=w, height=h, x=x, y=y, min_size=case["min"],
                frameless=True, easy_drag=True, transparent=True, background_color="#000000",
                hidden=self.prefs["window_mode"] == "menubar",
            )
            self.panel.events.closing += self._on_panel_closing
            self.panel.events.moved += lambda *a: self._save_panel_frame_soon()
            self.panel.events.resized += self._on_resized
        try:
            webview.start(self._started, gui="edgechromium", icon=_icon_path(), private_mode=False,
                          storage_path=os.path.join(runtime.DATA_DIR, "webview"))
        except Exception as e:
            log.exception("[shell] couldn't start the window (Edge WebView2 missing?)")
            if win_tray.message_box(
                    "Flight Clock needs the Microsoft Edge WebView2 Runtime, which seems to be missing.\n\n"
                    f"({e})\n\nOpen the download page now?", yes_no=True):
                runtime.open_path(WEBVIEW2_URL)
        finally:
            if self.tray:
                self.tray.stop()
                time.sleep(0.2)                  # let the icon leave the tray before the process exits

    def _started(self):
        # Runs on a pywebview worker thread once the GUI loop is up
        self.tray = win_tray.Tray("Flight Clock", _icon_path(), self.menu_model, self._tray_clicked,
                                  self.run_action)
        self.tray.start()
        if self.panel:
            self.panel.events.before_show.wait(10)
            form = self.panel.native
            self._hwnd = _run_on_ui(form, lambda: int(form.Handle.ToInt64()))
            form.Activated += lambda s, e: self._on_activated()
            form.Deactivate += lambda s, e: self._on_deactivated()
            _run_on_ui(form, lambda: _black_backing(form))
            self._apply_case_limits()
            self._apply_window_prefs()
            if self.prefs["window_mode"] == "menubar":
                self.show_panel()                # tray-only starts hidden (no taskbar flash), then shows
            # The frameless form loses a title bar's height at creation (WinForms keeps the
            # client size when the border goes), which left the case at the wrong ratio
            self._keep_ratio()
            self._update_shape_soon(2.5)         # once the page has drawn its case
        self.start_update_checks()
        self.note_launch()
        self.maybe_ask_for_tip()

    # --- tray ---------------------------------------------------------

    def _tray_clicked(self):
        if self.setup_mode or not self.panel:
            self.open_settings()
            return
        self.toggle_panel()

    # --- panel window -------------------------------------------------

    def _on_panel_closing(self):
        if self._quitting:
            return True
        threading.Thread(target=self.hide_panel, daemon=True).start()   # Alt-F4 hides; the tray brings it back
        return False

    def panel_visible(self):
        return bool(self._hwnd and user32.IsWindowVisible(self._hwnd))

    def show_panel(self):
        if not self.panel:
            return
        if self.prefs["window_mode"] == "menubar" and not self.prefs.get("panel_frame"):
            self._position_by_tray()             # the first time; then wherever it was left
        self.panel.show()
        if self._hwnd:
            user32.SetForegroundWindow(self._hwnd)
            if self.prefs["level"] == "desktop":
                self._send_to_bottom()

    def hide_panel(self):
        if self.panel:
            self.panel.hide()

    def toggle_panel(self):
        if self.panel_visible():
            self.hide_panel()
        else:
            self.show_panel()

    def toggle_fullscreen(self):
        if not self.panel:
            return
        if not self.panel_visible():
            self.show_panel()
        self._fullscreen = not self._fullscreen
        if self._fullscreen:
            self.panel.on_top = False
            self._set_region(None)               # full screen: the whole window
        self.panel.toggle_fullscreen()
        if not self._fullscreen:
            self._apply_window_prefs()
            self._update_shape_soon(1.0)

    def _on_activated(self):
        # "On the desktop": clicking the panel mustn't lift it over other windows
        if self.prefs["level"] == "desktop" and not self._fullscreen:
            self._send_to_bottom()

    def _on_deactivated(self):
        # The panel stays up when another window is clicked, in both modes
        # (tray-only only drops the taskbar button)
        pass

    def _send_to_bottom(self):
        user32.SetWindowPos(self._hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)

    def _position_by_tray(self):
        """Tray-only: put the panel next to the tray, on whichever edge the taskbar is."""
        if not self._hwnd:
            return
        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(user32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST), ctypes.byref(mi))
        work = mi.rcWork
        r = wintypes.RECT()
        user32.GetWindowRect(self._hwnd, ctypes.byref(r))
        w, h, gap = r.right - r.left, r.bottom - r.top, 8

        def clamp(v, lo, hi):
            return max(lo, min(v, hi))

        x = clamp(pt.x - w // 2, work.left + gap, work.right - w - gap)
        y = clamp(pt.y - h // 2, work.top + gap, work.bottom - h - gap)
        if pt.y >= work.bottom:
            y = work.bottom - h - gap          # taskbar at the bottom (the usual)
        elif pt.y < work.top:
            y = work.top + gap
        elif pt.x >= work.right:
            x = work.right - w - gap
        elif pt.x < work.left:
            x = work.left + gap
        user32.SetWindowPos(self._hwnd, None, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

    # --- case shape ---------------------------------------------------

    def _apply_case_limits(self):
        """The case's minimum size (pywebview only takes one at creation)."""
        if not self.panel or not self.panel.native:
            return
        form = self.panel.native
        mw, mh = settings.CASES[self.prefs["case"]]["min"]

        def apply():
            from System.Drawing import Size
            scale = getattr(form, "_scale", 1.0) or 1.0
            form.MinimumSize = Size(int(mw * scale), int(mh * scale))
        try:
            _run_on_ui(form, apply)
        except Exception:
            log.exception("[shell] couldn't set the minimum size")

    def _apply_case_size(self):
        """On a case change, reshape the window to the case, keeping about the same area."""
        if not self.panel or self._fullscreen:
            return
        self._apply_case_limits()
        case = settings.CASES[self.prefs["case"]]
        w, h = case["size"]
        scale = ((self.panel.width * self.panel.height) / (w * h)) ** 0.5
        nw = max(case["min"][0], round(w * scale))
        self.panel.resize(nw, round(nw * h / w))
        self._save_panel_frame_soon()

    def resize_drag(self, sx, sy):
        """A resize from one of the panel page's grips (.grip, bigger than the thin border a
        frameless window has): follows the mouse while the left button is held, keeping the
        case's ratio and the opposite edge in place. sx/sy: -1 left/top, 1 right/bottom, 0 neither."""
        if not self._hwnd or self._fullscreen or self._resizing:
            return
        self._resizing = True
        threading.Thread(target=self._resize_loop, args=(sx, sy), daemon=True, name="resize").start()

    def _resize_loop(self, sx, sy):
        try:
            start, pt, r = wintypes.POINT(), wintypes.POINT(), wintypes.RECT()
            user32.GetCursorPos(ctypes.byref(start))
            user32.GetWindowRect(self._hwnd, ctypes.byref(r))
            x0, y0, w0, h0 = r.left, r.top, r.right - r.left, r.bottom - r.top
            case = settings.CASES[self.prefs["case"]]
            ratio = case["size"][0] / case["size"][1]
            min_w = case["min"][0] * (getattr(self.panel.native, "_scale", 1.0) or 1.0)
            last = None
            while user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000:
                user32.GetCursorPos(ctypes.byref(pt))
                by_x = w0 + sx * (pt.x - start.x)
                by_y = (h0 + sy * (pt.y - start.y)) * ratio
                if sx and sy:                       # corner: whichever way the mouse moved more
                    nw = by_x if abs(by_x - w0) >= abs(by_y - w0) else by_y
                else:
                    nw = by_x if sx else by_y
                nw = int(max(min_w, nw))
                nh = round(nw / ratio)
                x = x0 + w0 - nw if sx < 0 else x0
                y = y0 + h0 - nh if sy < 0 else y0
                if (x, y, nw, nh) != last:
                    user32.SetWindowPos(self._hwnd, None, x, y, nw, nh, SWP_NOZORDER | SWP_NOACTIVATE)
                    last = (x, y, nw, nh)
                time.sleep(1 / 60)
        except Exception:
            log.exception("[shell] resize failed")
        finally:
            self._resizing = False
            self._save_panel_frame_soon()

    def _on_resized(self, *args):
        # Windows has no aspect-ratio lock: once a resize settles, fix the height to the case's ratio
        self._reshape_from_mask()                # stretch the last shape now; re-measure once it settles
        self._update_shape_soon(0.8)
        if self._ratio_timer:
            self._ratio_timer.cancel()
        self._ratio_timer = threading.Timer(0.3, self._keep_ratio)
        self._ratio_timer.daemon = True
        self._ratio_timer.start()
        self._save_panel_frame_soon()

    def _keep_ratio(self):
        if not self.panel or self._fullscreen:
            return
        w, h = settings.CASES[self.prefs["case"]]["size"]
        width, height = self.panel.width, self.panel.height
        want = round(width * h / w)
        if abs(want - height) > 2:
            self.panel.resize(width, want)

    # --- window shape (see _region_from_mask) ---------------------------

    def _update_shape_soon(self, delay):
        if self._shape_timer:
            self._shape_timer.cancel()
        self._shape_timer = threading.Timer(delay, self._update_shape)
        self._shape_timer.daemon = True
        self._shape_timer.start()

    def _update_shape(self):
        if not self.panel or not self._hwnd or self._fullscreen:
            return
        if self._resizing:
            self._update_shape_soon(0.5)
            return
        try:
            mask = _mask_from_png(_capture_page(self.panel.native))
            self._shape_failures = 0
        except Exception as e:
            # Early on the web view can still be settling ("disposed"/not ready): try again
            self._shape_failures = getattr(self, "_shape_failures", 0) + 1
            if self._shape_failures <= 6:
                log.info(f"[shell] panel snapshot failed ({type(e).__name__}); retrying")
                self._update_shape_soon(1.5)
            else:
                log.exception("[shell] couldn't snapshot the panel for its shape")
            return
        if mask is None:
            log.info("[shell] panel snapshot has no transparency; keeping the window rectangular")
            return
        fill = sum(mask.histogram()[255:]) / (mask.size[0] * mask.size[1])
        if fill < SHAPE_MIN_FILL:
            log.info(f"[shell] panel snapshot is {fill:.0%} opaque (still loading?); trying again")
            self._update_shape_soon(2.0)
            return
        self._mask = mask
        self._reshape_from_mask(log_it=True)
        log.info(f"[shell] window shape: {fill:.0%} of {mask.size[0]}x{mask.size[1]} snapshot")

    def _page_rect(self):
        """Where the web view is inside the window, in pixels: (dx, dy, w, h). Not simply the
        whole window: with display scaling (125%, 150%) it came out shorter than the window,
        and a shape stretched over the window left a border of the window showing."""
        r = wintypes.RECT()
        user32.GetWindowRect(self._hwnd, ctypes.byref(r))
        form = self.panel.native
        wv = getattr(form, "webview", None)
        if wv is None:
            return 0, 0, r.right - r.left, r.bottom - r.top, r

        def measure():
            from System.Drawing import Point
            p = wv.PointToScreen(Point(0, 0))
            return p.X, p.Y, wv.Width, wv.Height
        x, y, w, h = _run_on_ui(form, measure)
        return x - r.left, y - r.top, w, h, r

    def _reshape_from_mask(self, log_it=False):
        if self._mask is None or not self._hwnd or self._fullscreen:
            return
        try:
            dx, dy, w, h, r = self._page_rect()
        except Exception:
            log.exception("[shell] couldn't measure the panel")
            return
        if log_it:
            log.info(f"[shell] window {r.right - r.left}x{r.bottom - r.top}, page {w}x{h} at +{dx}+{dy}, "
                     f"snapshot {self._mask.size[0]}x{self._mask.size[1]}")
        if w > 0 and h > 0:
            self._set_region(_region_from_mask(self._mask, w, h, dx, dy))

    def _set_region(self, region):
        """The system owns the region once it's set; None = the whole window."""
        if self._hwnd:
            user32.SetWindowRgn(wintypes.HWND(self._hwnd), region, True)

    # --- frame persistence ----------------------------------------------

    def _save_panel_frame_soon(self):
        if self._save_timer:
            self._save_timer.cancel()
        self._save_timer = threading.Timer(1.0, self._save_panel_frame)
        self._save_timer.daemon = True
        self._save_timer.start()

    def _save_panel_frame(self):
        if not self.panel or self._fullscreen:
            return
        try:
            frame = [self.panel.x, self.panel.y, self.panel.width, self.panel.height]
        except Exception:
            return
        self.prefs = settings.update({"panel_frame": frame})

    # --- preferences --------------------------------------------------

    def set_prefs(self, **changes):
        """Save app settings and apply them now (from the menu or POST /api/desktop/settings)."""
        old = self.prefs
        self.prefs = settings.update(changes)
        if "launch_at_login" in changes and changes["launch_at_login"] != old["launch_at_login"]:
            self._set_launch_at_login(self.prefs["launch_at_login"])
        self._apply_window_prefs()
        if self.panel and self.prefs["case"] != old["case"]:
            self._apply_case_size()
        self.push_look()
        if any(self.prefs.get(k) != old.get(k) for k in ("case", "case_color", "bezel", "screen")):
            self._update_shape_soon(1.2)         # after the page has redrawn
        return self.prefs

    def _apply_window_prefs(self):
        if not self.panel or not self._hwnd or self._fullscreen:
            return
        tray_only = self.prefs["window_mode"] == "menubar"
        # No taskbar button in tray-only mode: a tool window. The taskbar only notices
        # the change when the window is shown again, so hide it around the switch.
        style = user32.GetWindowLongPtrW(self._hwnd, GWL_EXSTYLE)
        want = (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW if tray_only else (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW
        if want != style:
            visible = self.panel_visible()
            if visible:
                self.panel.hide()
            user32.SetWindowLongPtrW(self._hwnd, GWL_EXSTYLE, want)
            if visible and not tray_only:
                self.panel.show()
        level = self.prefs["level"]
        self.panel.on_top = level == "floating"
        if not tray_only and not self.panel_visible():
            self.panel.show()
        if level == "desktop":
            self._send_to_bottom()

    def _set_launch_at_login(self, enabled):
        """A per-user Run entry in the registry (installed app only)."""
        if not runtime.FROZEN:
            log.info("[shell] launch at login only works in the built app")
            return
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run",
                                0, winreg.KEY_SET_VALUE) as key:
                if enabled:
                    winreg.SetValueEx(key, "Flight Clock", 0, winreg.REG_SZ, f'"{sys.executable}"')
                else:
                    try:
                        winreg.DeleteValue(key, "Flight Clock")
                    except FileNotFoundError:
                        pass
        except OSError as e:
            log.warning(f"[shell] launch at login {'on' if enabled else 'off'} failed: {e}")

    def launch_at_login_status(self):
        """'enabled', 'off' or 'unavailable' (only works from the built app)."""
        if not runtime.FROZEN:
            return "unavailable"
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run") as key:
                winreg.QueryValueEx(key, "Flight Clock")
                return "enabled"
        except OSError:
            return "off"

    # --- settings window ---------------------------------------------

    def open_settings(self, path="/config"):
        url = f"{self.base_url}{path}" if not self.setup_mode else f"{self.base_url}/setup"
        win = self.settings_win
        if win is not None and win.native is not None:
            if path:
                win.load_url(url)
            win.show()
            win.restore()
            try:
                _run_on_ui(win.native, win.native.Activate)
            except Exception:
                pass
            return
        # Like the Mac: windows created after start() must be created off the main thread
        threading.Thread(target=self._create_settings, args=(url,), daemon=True, name="settings-window").start()

    def _create_settings(self, url):
        self.settings_win = webview.create_window("Flight Clock Settings", url, width=1180, height=860,
                                                  min_size=(420, 500))
        self.settings_win.events.closed += self._on_settings_closed

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
        for win in (self.settings_win, self.panel):
            if win is not None:
                try:
                    win.destroy()
                except Exception:
                    log.exception("[shell] closing a window failed")

    # --- location (setup wizard) --------------------------------------

    def locate(self, timeout=30):
        """{'lat', 'lon', 'label'} from Windows location services. Blocks the calling (web) thread."""
        import asyncio
        try:
            from winrt.windows.devices.geolocation import GeolocationAccessStatus, Geolocator
        except ImportError:
            raise RuntimeError("location services aren't available in this build")

        async def find():
            if await Geolocator.request_access_async() != GeolocationAccessStatus.ALLOWED:
                raise RuntimeError("Location is off for desktop apps in Windows Settings → Privacy & "
                                   "security → Location")
            pos = await asyncio.wait_for(Geolocator().get_geoposition_async(), timeout)
            p = pos.coordinate.point.position
            return p.latitude, p.longitude

        lat, lon = asyncio.run(find())
        return {"lat": lat, "lon": lon, "label": f"{lat:.3f}, {lon:.3f}"}

    # --- media (Now Playing ⏮ ⏯ ⏭) -------------------------------------

    def media_control(self, source, action):
        """app.media_cb: with the Spotify app running on this PC, press the media key (no
        Web API or Premium needed). False → the shared code uses the Web API (Spotify) or
        SSH (a Mac's Music app)."""
        if source != "spotify":
            return False
        try:
            import psutil
            if not any((p.info.get("name") or "").lower() == "spotify.exe" for p in psutil.process_iter(["name"])):
                return False
        except Exception:
            return False
        vk = {"next": 0xB0, "previous": 0xB1, "playpause": 0xB3}[action]   # VK_MEDIA_NEXT_TRACK / PREV_TRACK / PLAY_PAUSE
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP = 0x1, 0x2
        ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
        ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
        return True

    # --- alerts -------------------------------------------------------

    def alert(self, message, update=None):
        if update:
            if win_tray.message_box(f"{message}\n\nDownload it now?", yes_no=True):
                runtime.open_path(update["url"])
        else:
            win_tray.message_box(message)


def _on_a_screen(frame) -> bool:
    """Whether a saved [x, y, w, h] still overlaps a connected screen."""
    try:
        x, y, w, h = frame
        return any(x < s.x + s.width and x + w > s.x and y < s.y + s.height and y + h > s.y
                   for s in webview.screens)
    except Exception:
        return False


def notify_already_running():
    win_tray.message_box("Flight Clock is already running. Look for the ✈ in the system tray, "
                         "next to the clock (it may be under the ^ arrow).")
