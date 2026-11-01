"""
Draws the app icon (icon.icns on the Mac, icon.ico for Windows) and the DMG
window background — run by build.sh / build-win.ps1.

  python packaging/make_art.py <out dir>
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PLANE = [
    "       XX       ",
    "      XXXX      ",
    "      XXXX      ",
    "      XXXX      ",
    "     XXXXXX     ",
    "   XXXXXXXXXX   ",
    " XXXXXXXXXXXXXX ",
    "XXXXXXXXXXXXXXXX",
    "XXX   XXXX   XXX",
    "      XXXX      ",
    "      XXXX      ",
    "      XXXX      ",
    "     XXXXXX     ",
    "    XXXXXXXX    ",
    "    XXX  XXX    ",
    "                ",
]
AMBER = (255, 168, 38)
UNLIT = (34, 35, 41)


def icon_png(size=1024):
    s = size / 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Squircle body on Apple's icon grid (824 px inside 1024), with a soft drop shadow
    inset, radius = 100 * s, 185 * s
    box = [inset, inset, size - inset, size - inset]
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([box[0], box[1] + 12 * s, box[2], box[3] + 12 * s], radius, fill=(0, 0, 0, 150))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18 * s)))

    body = Image.new("RGBA", img.size, (0, 0, 0, 0))
    grad = Image.new("RGBA", img.size)
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / size
        c = tuple(int(a + (b - a) * t) for a, b in zip((38, 40, 48), (10, 11, 14)))
        gd.line([(0, y), (size, y)], fill=c + (255,))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius, fill=255)
    body.paste(grad, (0, 0), mask)
    img.alpha_composite(body)

    # 16×16 LED grid with the plane lit
    grid = 16
    area = 600 * s
    pitch = area / grid
    r = pitch * 0.40
    x0 = (size - area) / 2
    y0 = (size - area) / 2 + 6 * s
    leds = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(leds)
    lit = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dl = ImageDraw.Draw(lit)
    for gy, row in enumerate(PLANE):
        for gx, ch in enumerate(row):
            cx, cy = x0 + (gx + 0.5) * pitch, y0 + (gy + 0.5) * pitch
            target = dl if ch == "X" else d
            target.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(AMBER if ch == "X" else UNLIT) + (255,))
    img.alpha_composite(leds)
    glow = lit.filter(ImageFilter.GaussianBlur(pitch * 0.6))
    img.alpha_composite(glow)
    img.alpha_composite(lit)
    return img


def make_icns(out_path):
    master = icon_png(1024)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for pt in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = pt * scale
                name = f"icon_{pt}x{pt}{'@2x' if scale == 2 else ''}.png"
                master.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out_path], check=True)
    master.save(out_path.replace(".icns", ".png"))


def _font(size):
    for path in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_dmg_background(out_path, w=660, h=400):
    """@2x art for a 660×400 window: app icon at (165,190), Applications at (495,190)."""
    S = 2
    img = Image.new("RGB", (w * S, h * S))
    d = ImageDraw.Draw(img)
    for y in range(h * S):
        t = y / (h * S)
        d.line([(0, y), (w * S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((30, 32, 38), (14, 15, 18))))
    title = "Drag Flight Clock to Applications"
    f = _font(22 * S)
    tw = d.textlength(title, font=f)
    d.text(((w * S - tw) / 2, 52 * S), title, font=f, fill=(225, 225, 230))
    # Arrow between the two icon spots
    y = 190 * S
    d.line([(255 * S, y), (395 * S, y)], fill=AMBER, width=5 * S)
    d.polygon([(405 * S, y), (385 * S, y - 13 * S), (385 * S, y + 13 * S)], fill=AMBER)
    f2 = _font(13 * S)
    note = "First launch: if macOS blocks it, open System Settings → Privacy & Security → Open Anyway"
    nw = d.textlength(note, font=f2)
    d.text(((w * S - nw) / 2, 340 * S), note, font=f2, fill=(150, 150, 158))
    img.save(out_path, dpi=(144, 144))


def make_ico(out_path):
    """Windows icon: the same art, cropped to the body (Windows icons don't use Apple's margin)."""
    img = icon_png(512).crop((44, 44, 468, 468))
    img.save(out_path, sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    make_ico(os.path.join(out, "icon.ico"))
    if sys.platform == "darwin":
        make_icns(os.path.join(out, "icon.icns"))
        make_dmg_background(os.path.join(out, "dmg-background.png"))
    print("art written to", out)
