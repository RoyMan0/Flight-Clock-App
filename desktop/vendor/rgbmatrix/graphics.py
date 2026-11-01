"""
rgbmatrix.graphics stand-in for the Mac app (no LED hardware).

Drawing is a no-op here: core/canvas_mirror.py draws the glyphs into the frame
the panel window shows. But fonts are real: LoadFont reads the BDF file, and
CharacterWidth / DrawText return the true widths, as the Pi's C library does.
Scenes place text with those widths (the flight tracker puts the destination
right after the origin, scrolling text loops when its width has passed), so a
fixed guess misaligns them.
"""


class Color:
    def __init__(self, r=0, g=0, b=0):
        self.red   = r
        self.green = g
        self.blue  = b

    def __repr__(self):
        return f"Color({self.red}, {self.green}, {self.blue})"


class Font:
    def __init__(self):
        self.height = 8
        self.baseline = 6
        self._widths = {}           # codepoint → device width (BDF DWIDTH)
        self._fallback = None       # width of U+FFFD, used for missing glyphs

    def LoadFont(self, path: str):
        widths, encoding = {}, None
        with open(path, "r", encoding="latin-1") as f:
            for line in f:
                parts = line.split()
                if not parts:
                    continue
                if parts[0] == "FONTBOUNDINGBOX" and len(parts) >= 5:
                    self.height = int(parts[2])
                    self.baseline = int(parts[2]) + int(parts[4])
                elif parts[0] == "ENCODING":
                    encoding = int(parts[1])
                elif parts[0] == "DWIDTH" and encoding is not None:
                    widths[encoding] = int(parts[1])
                elif parts[0] == "ENDCHAR":
                    encoding = None
        self._widths = widths
        self._fallback = widths.get(0xFFFD)

    def CharacterWidth(self, char_code: int) -> int:
        w = self._widths.get(char_code, self._fallback)
        return -1 if w is None else w      # the C library returns -1 for a missing glyph


def DrawText(canvas, font, x, y, color, text, kerning=0) -> int:
    """Draws nothing (see the module docstring); returns the text's pixel width."""
    width = 0
    for c in text:
        w = font.CharacterWidth(ord(c))
        if w > 0:
            width += w + kerning
    return width


def DrawLine(canvas, x1, y1, x2, y2, color):
    pass


def DrawCircle(canvas, x, y, radius, color):
    pass
