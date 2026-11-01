# Installing Flight Clock on Windows

1. Download **FlightClock-Setup-x.y.z.exe** and open it.
2. Windows shows **"Windows protected your PC"** because the app isn't signed with a paid certificate.
   Click **More info → Run anyway**. You only do this once.
3. The installer needs no admin password. Leave "Launch Flight Clock" ticked and click **Finish**.
4. The setup page opens. Click **Use my PC's location** (or type your coordinates), pick your modules, then **Save & Start**.

The panel then appears in its own window, and a ✈ icon appears in the system tray next to the clock. If you don't see it,
click the **^** arrow; you can drag it onto the taskbar to keep it visible.

- **Click the ✈** to show or hide the panel. **Right-click it** (or the panel) for the menu: Settings, modules, style, quit.
- **Double-click the panel** for full screen.
- **Settings → Windows App** has the window mode (tray only), "always on top" and "open at login".

**No installer?** Use **FlightClock-x.y.z-portable.zip** instead: unzip it anywhere and run `Flight Clock.exe`.

**"WebView2 Runtime" message?** Install it from Microsoft (the app offers the link), then start Flight Clock again.

Your settings are kept in `%APPDATA%\Flight Clock`, so reinstalling or updating keeps them.
