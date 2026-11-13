// Colour e-ink screen: a Kaleido-style colour e-reader page.
//
// Off-white paper, crisp type, muted colours. Like a real panel it updates at
// most once a second, does a black/white "full refresh" flash on a page turn,
// and leaves a faint ghost of the previous page on partial updates.

window.FC = window.FC || {};

(function (FC) {
  const PAPER = '#e8e4d8';
  const INK = '#22221f';
  const SANS = '"Avenir Next", "Helvetica Neue", Helvetica, sans-serif';
  const COND = '"Avenir Next Condensed", "DIN Condensed", "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", "Helvetica Neue", sans-serif';
  const MIN_INTERVAL = 1000;

  // LED colour → e-ink pigment: greys become ink, colours keep their hue but lose
  // the glow (lower saturation and lightness), like a colour filter over grey ink
  function ink(c, strong) {
    if (!c) return INK;
    const [r, g, b] = c.map((v) => Math.max(0, Math.min(255, v)) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.2 || d < 0.12) {
      if (l > 0.62) return INK;
      if (l > 0.38) return '#5f5e59';
      return strong ? '#3a3a37' : '#8a8880';
    }
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const yellow = h > 40 && h < 75;                   // yellows read as ochre on paper
    return `hsl(${h.toFixed(0)} ${(Math.min(s, 0.85) * 62).toFixed(0)}% ${yellow ? 34 : 38}%)`;
  }
  FC.inkColor = ink;

  FC.EinkScreen = class {
    constructor(root) {
      this.root = root;
      this.wrap = document.createElement('div');
      this.wrap.className = 'eink';
      this.canvas = document.createElement('canvas');
      this.flash = document.createElement('div');
      this.flash.className = 'eink-flash';
      this.wrap.append(this.canvas, this.flash);
      root.appendChild(this.wrap);
      this.ctx = this.canvas.getContext('2d');
      this.ghost = document.createElement('canvas');
      this.images = new Map();
      this.board = null;
      this.drawn = null;
      this.lastDraw = 0;
      this.timer = null;
      this.frame = null;
      this.brightness = 100;
      this.paper = null;
    }

    show(on) { this.wrap.style.display = on ? '' : 'none'; this.active = on; if (on) this.resize(); }
    applyPrefs() {}

    resize() {
      if (!this.active) return;
      const r = this.root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      this.ghost.width = this.canvas.width; this.ghost.height = this.canvas.height;
      this.paper = null;
      if (this.board) this._draw(false);
    }

    setFrame(px) {
      this.frame = px;
      if (this.board && this.board.pixels) this._schedule(false);
    }

    setBrightness(b) {
      // A dimmed panel reads as a page under lower light
      this.wrap.style.filter = `brightness(${(0.55 + 0.45 * Math.max(0, Math.min(100, b)) / 100).toFixed(2)})`;
    }

    setBoard(board) {
      if (!this.active) { this.board = board; return; }
      const turn = !this.board || this.board.key !== board.key;
      const same = this.board && JSON.stringify(this.board) === JSON.stringify(board);
      this.board = board;
      if (same && !board.pixels) return;
      this._schedule(turn);
    }

    _schedule(turn) {
      if (turn) { clearTimeout(this.timer); this.timer = null; this._draw(true); return; }
      if (this.timer) return;
      const wait = Math.max(0, MIN_INTERVAL - (performance.now() - this.lastDraw));
      this.timer = setTimeout(() => { this.timer = null; this._draw(false); }, wait);
    }

    _image(src) {
      let e = this.images.get(src);
      if (!e) {
        e = new Image();
        e.onload = () => this._schedule(false);
        e.src = src;
        this.images.set(src, e);
        if (this.images.size > 80) this.images.delete(this.images.keys().next().value);
      }
      return e.complete && e.naturalWidth ? e : null;
    }

    _paperPattern() {
      if (this.paper) return this.paper;
      const t = document.createElement('canvas');
      t.width = t.height = 128;
      const c = t.getContext('2d');
      c.fillStyle = PAPER; c.fillRect(0, 0, 128, 128);
      const img = c.getImageData(0, 0, 128, 128);
      for (let i = 0; i < img.data.length; i += 4) {          // fine grain, like the panel's microcups
        const n = (Math.random() - 0.5) * 9;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
      this.paper = this.ctx.createPattern(t, 'repeat');
      return this.paper;
    }

    _draw(full) {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      if (!W || !this.board) return;
      this.lastDraw = performance.now();
      // Keep the old page for the ghost
      const g = this.ghost.getContext('2d');
      g.clearRect(0, 0, W, H); g.drawImage(this.canvas, 0, 0);

      ctx.fillStyle = this._paperPattern();
      ctx.fillRect(0, 0, W, H);
      if (!full && this.drawn) { ctx.globalAlpha = 0.06; ctx.drawImage(this.ghost, 0, 0); ctx.globalAlpha = 1; }

      const aw = Math.min(W, H * 2), ah = aw / 2, ox = (W - aw) / 2, oy = (H - ah) / 2;
      const cw = aw / FC.COLS, ch = ah / FC.ROWS, padX = cw * 0.18;
      const rect = (c) => [ox + c.x * cw, oy + c.y * ch, c.w * cw, (c.h || 1) * ch];
      const theme = { kind: 'eink', color: (rgb, strong) => ink(rgb, strong), frame: this.frame };

      // Graphics first (backdrops), then everything else on top
      const cells = [...this.board.cells].sort((a, b) => (a.type === 'graphic' ? -1 : 0) - (b.type === 'graphic' ? -1 : 0));
      for (const c of cells) {
        const [x, y, w, h] = rect(c);
        if (c.type === 'graphic') {
          const paint = FC.paint[c.paint];
          if (!paint) continue;
          const off = document.createElement('canvas');
          off.width = Math.round(w); off.height = Math.round(h);
          paint(off.getContext('2d'), off.width, off.height, c.data || {}, theme);
          ctx.drawImage(off, x, y);
        } else if (c.type === 'bar') {
          const bh = c.thin ? ch * 0.22 : ch * 0.42, by = y + (h - bh) / 2, r = bh / 2;
          ctx.lineWidth = Math.max(1, ch / 40);
          ctx.strokeStyle = '#4a4944';
          roundRect(ctx, x + padX, by, w - padX * 2, bh, r); ctx.stroke();
          if (c.frac > 0) {
            ctx.fillStyle = ink(c.color, true);
            roundRect(ctx, x + padX, by, Math.max(bh, (w - padX * 2) * c.frac), bh, r); ctx.fill();
          }
        } else if (c.type === 'icon') {
          const ic = c.icon || {};
          const src = ic.kind === 'weather' ? FC.svgURL(FC.weatherSVG(ic.code, ic.night, 'eink'))
            : ic.kind === 'glyph' ? FC.svgURL(FC.glyphSVG(ic.name, 'eink')) : ic.src;
          const img = this._image(src);
          if (!img) continue;
          const s = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.92;
          const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
          ctx.save();
          if (ic.kind === 'url') {
            ctx.filter = 'saturate(0.55) contrast(1.05) brightness(1.02)';
            ctx.imageSmoothingEnabled = img.naturalWidth >= 48;   // tiny logos stay crisp, photos smooth
          }
          ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
          ctx.restore();
        } else if (c.type === 'text') {
          this._text(ctx, c, x, y, w, h, ch, padX);
        }
      }
      this.drawn = this.board;
      if (full) {
        this.flash.classList.remove('go');
        void this.flash.offsetWidth;            // restart the animation
        this.flash.classList.add('go');
        clearTimeout(this.flashTimer);           // end it on a timer too: hidden windows pause CSS animations
        this.flashTimer = setTimeout(() => this.flash.classList.remove('go'), 450);
      }
    }

    _text(ctx, c, x, y, w, h, ch, padX) {
      const raw = c.text;
      const text = raw.trim();
      // Layouts pad text with spaces to keep flap positions; read that back as alignment
      let align = c.align || 'left';
      if (!c.align && text) {
        const lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
        if (lead && trail && Math.abs(lead - trail) <= 1) align = 'center';
        else if (lead) align = 'right';
      }
      if (c.bg) {                                 // full cell, so neighbouring cells join into one band
        ctx.fillStyle = ink(c.bg, true);
        ctx.fillRect(x, y + ch * 0.06, w + 0.5, h - ch * 0.12);
      }
      if (!text) return;
      const big = (c.h || 1) > 1;
      let size = big ? h * 0.82 : ch * 0.66;
      const weight = big ? 600 : c.color && !c.dim ? 500 : 500;
      const family = big ? COND : SANS;
      ctx.font = `${weight} ${size}px ${family}`;
      const maxW = w - padX * 2;
      const mw = ctx.measureText(text).width;
      if (mw > maxW) { size *= maxW / mw; ctx.font = `${weight} ${size}px ${family}`; }
      ctx.fillStyle = c.bg ? PAPER : ink(c.color, big);
      ctx.textBaseline = 'middle';
      ctx.textAlign = align;
      const tx = align === 'left' ? x + padX : align === 'right' ? x + w - padX : x + w / 2;
      ctx.fillText(text, tx, y + h / 2 + size * 0.04);
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
})(window.FC);
