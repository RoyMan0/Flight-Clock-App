"""
The ✈ system tray icon for the Windows app, straight on the Win32 API (ctypes).

It runs its own hidden window and message loop on a daemon thread. A left click
calls `on_click`; a right click (or popup_menu(), for the panel's right-click)
shows the menu, which `get_menu()` builds fresh each time from the shared
shell_common model, so checkmarks and "Now showing" are always current.
"""

import ctypes
import logging
import threading
from ctypes import wintypes

from shell_common import SEP

log = logging.getLogger("desktop.tray")

user32 = ctypes.WinDLL("user32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

WM_DESTROY, WM_CLOSE, WM_COMMAND, WM_NULL = 0x0002, 0x0010, 0x0111, 0x0000
WM_LBUTTONUP, WM_RBUTTONUP, WM_CONTEXTMENU = 0x0202, 0x0205, 0x007B
WM_APP = 0x8000
WM_TRAY = WM_APP + 1          # notifications from the icon
WM_POPUP = WM_APP + 2         # popup_menu() from another thread
NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP = 0x1, 0x2, 0x4
MF_STRING, MF_SEPARATOR, MF_POPUP, MF_CHECKED, MF_GRAYED = 0x0, 0x800, 0x10, 0x8, 0x1
MFS_DEFAULT = 0x1000
TPM_RIGHTBUTTON, TPM_RETURNCMD, TPM_NONOTIFY = 0x2, 0x100, 0x80
IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x10, 0x40
IDI_APPLICATION = 32512


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT),
                ("uFlags", wintypes.UINT), ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HICON),
                ("szTip", wintypes.WCHAR * 128), ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD),
                ("szInfo", wintypes.WCHAR * 256), ("uVersion", wintypes.UINT),
                ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
                ("guidItem", ctypes.c_byte * 16), ("hBalloonIcon", wintypes.HICON)]


user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wintypes.ATOM
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                   ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.CreateWindowExW.restype = wintypes.HWND
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.CreatePopupMenu.restype = wintypes.HMENU
user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
user32.SetMenuDefaultItem.argtypes = [wintypes.HMENU, wintypes.UINT, wintypes.UINT]
user32.TrackPopupMenu.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                  wintypes.HWND, wintypes.LPVOID]
user32.TrackPopupMenu.restype = wintypes.BOOL
user32.DestroyMenu.argtypes = [wintypes.HMENU]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int,
                              wintypes.UINT]
user32.LoadImageW.restype = wintypes.HANDLE
user32.LoadIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPVOID]
user32.LoadIconW.restype = wintypes.HICON
user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
user32.RegisterWindowMessageW.restype = wintypes.UINT
user32.DestroyWindow.argtypes = [wintypes.HWND]
shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
shell32.Shell_NotifyIconW.restype = wintypes.BOOL
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE

# Explorer broadcasts this when the taskbar is (re)created, e.g. after it crashes
WM_TASKBARCREATED = user32.RegisterWindowMessageW("TaskbarCreated")


class Tray:
    def __init__(self, tooltip, icon_path, get_menu, on_click, run_action):
        self.tooltip = tooltip
        self.icon_path = icon_path
        self.get_menu = get_menu          # → list of shell_common.Item / SEP
        self.on_click = on_click
        self.run_action = run_action
        self.hwnd = None
        self._wndproc = WNDPROC(self._proc)   # keep a reference: Windows calls it
        self._ready = threading.Event()
        self._menu_open = False

    def start(self):
        threading.Thread(target=self._loop, daemon=True, name="tray").start()
        self._ready.wait(5)

    def stop(self):
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def popup_menu(self):
        """Show the menu at the mouse pointer (safe from any thread)."""
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_POPUP, 0, 0)

    # --- message loop ---------------------------------------------------

    def _loop(self):
        try:
            hinst = kernel32.GetModuleHandleW(None)
            wc = WNDCLASSW()
            wc.lpfnWndProc = self._wndproc
            wc.hInstance = hinst
            wc.lpszClassName = "FlightClockTray"
            user32.RegisterClassW(ctypes.byref(wc))
            self.hwnd = user32.CreateWindowExW(0, wc.lpszClassName, "Flight Clock", 0, 0, 0, 0, 0,
                                               None, None, hinst, None)
            self._hicon = self._load_icon()
            self._add_icon()
        except Exception:
            log.exception("[tray] couldn't create the tray icon")
            return
        finally:
            self._ready.set()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def _load_icon(self):
        if self.icon_path:
            h = user32.LoadImageW(None, self.icon_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if h:
                return h
        return user32.LoadIconW(None, ctypes.c_void_p(IDI_APPLICATION))

    def _nid(self):
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = self._hicon
        nid.szTip = self.tooltip[:127]
        return nid

    def _add_icon(self):
        if not shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self._nid())):
            log.warning("[tray] Shell_NotifyIcon failed")

    def _proc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_TRAY:
                event = lparam & 0xFFFF
                if event == WM_LBUTTONUP:
                    self.run_action(self.on_click)
                elif event in (WM_RBUTTONUP, WM_CONTEXTMENU):
                    self._show_menu()
                return 0
            if msg == WM_POPUP:
                self._show_menu()
                return 0
            if msg == WM_TASKBARCREATED:
                self._add_icon()
                return 0
            if msg == WM_CLOSE:
                shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid()))
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
        except Exception:
            log.exception("[tray] message handler failed")
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    # --- menu -------------------------------------------------------------

    def _show_menu(self):
        if self._menu_open:
            return
        self._menu_open = True
        actions = {}
        hmenu = None
        try:
            hmenu = self._build(self.get_menu(), actions)
            pt = wintypes.POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            # Without this the menu doesn't close when you click elsewhere (a documented quirk)
            user32.SetForegroundWindow(self.hwnd)
            cmd = user32.TrackPopupMenu(hmenu, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
                                        pt.x, pt.y, 0, self.hwnd, None)
            user32.PostMessageW(self.hwnd, WM_NULL, 0, 0)
        finally:
            if hmenu:
                user32.DestroyMenu(hmenu)
            self._menu_open = False
        action = actions.get(cmd)
        if action:
            # Off the tray thread, so a slow action (opening a window) can't stall the icon
            threading.Thread(target=self.run_action, args=(action,), daemon=True).start()

    def _build(self, items, actions):
        hmenu = user32.CreatePopupMenu()
        for it in items:
            if it is SEP:
                user32.AppendMenuW(hmenu, MF_SEPARATOR, 0, None)
                continue
            flags = MF_STRING | (MF_CHECKED if it.checked else 0) | (0 if it.enabled else MF_GRAYED)
            title = it.title.replace("&", "&&")
            if it.submenu is not None:
                sub = self._build(it.submenu, actions)
                user32.AppendMenuW(hmenu, flags | MF_POPUP, sub, title)
                continue
            cmd = 0
            if it.action:
                cmd = len(actions) + 1
                actions[cmd] = it.action
            user32.AppendMenuW(hmenu, flags, cmd, title)
            if it.default and cmd:
                user32.SetMenuDefaultItem(hmenu, cmd, 0)
        return hmenu


def message_box(text, title="Flight Clock", yes_no=False) -> bool:
    """A plain Windows message box; with yes_no, True when Yes is clicked."""
    MB_OK, MB_YESNO, MB_ICONINFO, MB_SETFOREGROUND, IDYES = 0x0, 0x4, 0x40, 0x10000, 6
    flags = (MB_YESNO if yes_no else MB_OK) | MB_ICONINFO | MB_SETFOREGROUND
    return user32.MessageBoxW(None, text, title, flags) == IDYES
