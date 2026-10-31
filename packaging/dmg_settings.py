# dmgbuild settings — used by build.sh:
#   dmgbuild -s packaging/dmg_settings.py -D app="dist/Flight Clock.app" -D art=packaging/art "Flight Clock" out.dmg
import os

app = defines["app"]            # noqa: F821  (dmgbuild injects `defines`)
art = defines["art"]            # noqa: F821
app_name = os.path.basename(app)

format = "UDZO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon = os.path.join(art, "icon.icns")

background = os.path.join(art, "dmg-background.png")
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 112
text_size = 13
icon_locations = {
    app_name: (165, 190),
    "Applications": (495, 190),
}
