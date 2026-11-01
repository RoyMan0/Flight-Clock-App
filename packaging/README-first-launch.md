# Installing Flight Clock on your Mac

Flight Clock shows the flight-clock LED display in a window on your Mac: planes overhead, the clock and weather, and the other modules.

**Needs:** a Mac with Apple Silicon (M1 or newer) running macOS 13 Ventura or later.

## Install

1. Download `FlightClock-<version>.dmg` and double-click it.
2. Drag **Flight Clock** onto the **Applications** folder.
3. Eject the "Flight Clock" disk in Finder.

## First launch

The app isn't signed with an Apple developer certificate yet, so macOS blocks it the first time:

1. Open **Applications** and double-click **Flight Clock**. macOS says it "can't be opened" or "can't verify the developer". Click **Done** or **Cancel**.
2. Open **System Settings → Privacy & Security** and scroll down to *Security*.
3. Next to "Flight Clock was blocked…", click **Open Anyway** and confirm with your password or Touch ID.

You only need to do this once. After that it opens normally.

## Setup

On first launch a setup window asks for:

- **Your location.** Click *Use my Mac's location*, or type in latitude and longitude. It's used to find planes overhead and for weather.
- **API keys** (optional). The flight tracker works without keys. For weather, get a free key from [tomorrow.io](https://www.tomorrow.io) and paste it in.
- **Which modules to show.**

Click **Save & Start** and the display appears.

## Using it

- The **✈ icon in the menu bar** shows or hides the panel, opens Settings, picks a module to show, changes the style, or quits.
- **Style** lets you choose the screen (LED panel, airport flip board, or colour e-ink) and the case around it (80s bedside clock, mid-century desk clock, vintage Mac SE or iMac G3 style, each in several colours). Settings → Mac App → *Browse all styles* shows every one.
- **Right-click the panel** for the same menu. **Double-click** it for full screen.
- **Settings → Config → Mac App** has these options:
  - menu-bar-only mode (no Dock icon)
  - always on top, or on the desktop behind your windows
  - LED style
  - open at login
  - access from your phone
- Your settings and keys stay on your Mac, in `~/Library/Application Support/Flight Clock`.

## Updating

When a new version is out, the menu shows **Update Available**. Download the new DMG and drag it to Applications again; your settings are kept.
