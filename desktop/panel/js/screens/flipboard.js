// Flip-board screen: a split-flap departures board.
//
// The 24×8 grid is always full of flaps (blank ones show the empty board). A
// flap that changes steps through the drum, one fold per character, towards its
// new character; changes start in a wave from the top-left, so a new page
// cascades across the board. Big text (h > 1) uses larger flaps on top of the
// grid; icons, bars and graphics sit on picture tiles that fold over as a whole.

window.FC = window.FC || {};

(function (FC) {
  const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;-+/%°'!?&#()<>$@";
  const STEP_MS = 70;            // one fold
  const MAX_STEPS = 9;           // long trips skip ahead so a page turn settles in < 1 s
  const FLAP_BG = [28, 28, 30];
  const INK = [242, 236, 216];   // the classic cream character colour

  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  // LED colours are tuned for a black panel; on a flap keep them bright and readable
  function textColor(c) {
    if (!c) return INK;
    const l = (Math.max(...c) + Math.min(...c)) / 510;
    if (l < 0.35) return c.map((v) => Math.min(255, v + 110));
    return c;
  }

  // ---- one split flap ------------------------------------------------------------
  class Flap {
    constructor(parent, cls = 'flap') {
      const el = this.el = document.createElement('div');
      el.className = cls;
      el.innerHTML = '<div class="f-top"><span></span></div><div class="f-bot"><span></span></div>' +
        '<div class="f-leaf"><div class="lf lf-front"><span></span></div><div class="lf lf-back"><span></span></div></div>';
      parent.appendChild(el);
      this.top = el.querySelector('.f-top span');
      this.bot = el.querySelector('.f-bot span');
      this.leaf = el.querySelector('.f-leaf');
      this.front = el.querySelector('.lf-front span');
      this.back = el.querySelector('.lf-back span');
      this.cur = { ch: ' ', fg: INK, bg: FLAP_BG };
      this.paint(this.cur);
      this.queue = [];
      this.timer = null;
    }

    paint(s, which = ['top', 'bot']) {
      for (const k of which) {
        const span = this[k];
        span.textContent = s.ch;
        span.style.color = css(s.fg);
        span.parentNode.style.backgroundColor = css(s.bg);
      }
    }

    place(x, y, w, h) {
      Object.assign(this.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      this.el.style.setProperty('--fh', h + 'px');
    }

    // Flip to `target` (char + colours), starting after `delay` ms
    set(target, delay, onStep) {
      const same = (a, b) => a.ch === b.ch && a.fg.join() === b.fg.join() && a.bg.join() === b.bg.join();
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.cur;
      if (same(last, target)) return;
      if (!this.running) clearTimeout(this.timer);   // a pending start; a running fold keeps its timer
      const from = this.cur;
      const path = [];
      const i0 = DRUM.indexOf(from.ch), i1 = DRUM.indexOf(target.ch);
      if (i0 >= 0 && i1 >= 0 && i0 !== i1) {
        let steps = (i1 - i0 + DRUM.length) % DRUM.length;
        let i = steps > MAX_STEPS ? (i1 - MAX_STEPS + DRUM.length) % DRUM.length : i0;
        while (i !== i1) {
          i = (i + 1) % DRUM.length;
          path.push({ ch: DRUM[i], fg: i === i1 ? target.fg : from.fg, bg: i === i1 ? target.bg : from.bg });
        }
      } else {
        path.push(target);
      }
      this.queue = path;
      if (this.running) return;            // the fold in progress picks up the new queue
      this.timer = setTimeout(() => this._step(onStep), delay);
    }

    _step(onStep) {
      const next = this.queue.shift();
      if (!next) { this.running = false; return; }
      this.running = true;
      const prev = this.cur;
      this.cur = next;
      // Static halves: the top already shows the next character, the bottom the old one
      this.paint(next, ['top']);
      this.paint(prev, ['bot']);
      // The leaf carries the old top half down; its back is the new bottom half
      this.front.textContent = prev.ch; this.front.style.color = css(prev.fg);
      this.front.parentNode.style.backgroundColor = css(prev.bg);
      this.back.textContent = next.ch; this.back.style.color = css(next.fg);
      this.back.parentNode.style.backgroundColor = css(next.bg);
      this.leaf.style.display = 'block';
      // Finish on a timer, not on the animation's events: WebKit pauses animations
      // in hidden or covered windows, and the board must still settle there
      const fold = this.leaf.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }],
                                     { duration: STEP_MS, easing: 'cubic-bezier(.4,.1,.6,1)' });
      if (onStep) onStep();
      this.timer = setTimeout(() => {
        fold.cancel();
        this.paint(next, ['bot']);
        this.leaf.style.display = 'none';
        if (this.queue.length) this._step(onStep);
        else this.running = false;
      }, STEP_MS);
    }

    remove() { clearTimeout(this.timer); this.el.remove(); }
  }

  // ---- picture tile (icons, bars, graphics) ---------------------------------------
  class Tile {
    constructor(parent) {
      this.el = document.createElement('div');
      this.el.className = 'ftile';
      this.face = document.createElement('div');
      this.face.className = 'ft-face';
      this.el.appendChild(this.face);
      parent.appendChild(this.el);
      this.sig = null;
    }

    place(x, y, w, h) {
      Object.assign(this.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      this.w = w; this.h = h;
    }

    // Fold the tile over to new content (or just repaint if `live`)
    show(sig, render, delay, live) {
      if (sig === this.sig) { if (live) render(this.face); return; }
      const first = this.sig === null;
      this.sig = sig;
      if (first && !delay) { render(this.face); return; }
      setTimeout(() => {
        const out = this.face.animate([{ transform: 'rotateX(0)' }, { transform: 'rotateX(-90deg)' }], { duration: 110, easing: 'ease-in' });
        setTimeout(() => {                       // timers, not onfinish (see Flap._step)
          out.cancel();
          render(this.face);
          const back = this.face.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0)' }], { duration: 130, easing: 'ease-out' });
          setTimeout(() => back.cancel(), 140);
        }, 110);
      }, delay);
    }

    remove() { this.el.remove(); }
  }

  // ---- the board ------------------------------------------------------------------
  FC.FlipScreen = class {
    constructor(root) {
      this.root = root;
      this.el = document.createElement('div');
      this.el.className = 'flipboard';
      root.appendChild(this.el);
      this.grid = [];
      for (let y = 0; y < FC.ROWS; y++) for (let x = 0; x < FC.COLS; x++) this.grid.push(new Flap(this.el));
      this.big = new Map();          // "x,y,h" → Flap
      this.tiles = new Map();        // "type:x,y,w,h" → Tile
      this.board = null;
      this.frame = null;
      this.sound = false;
      this.audio = null;
      this.lastClick = 0;
    }

    show(on) { this.el.style.display = on ? '' : 'none'; this.active = on; if (on) this.resize(); }

    applyPrefs(p) { this.sound = !!p.flip_sound; }

    resize() {
      if (!this.active) return;
      const r = this.root.getBoundingClientRect();
      const aw = Math.min(r.width, r.height * 2), ah = aw / 2;
      this.cw = aw / FC.COLS; this.ch = ah / FC.ROWS;
      this.ox = (r.width - aw) / 2; this.oy = (r.height - ah) / 2;
      const gap = Math.max(1, this.cw * 0.07);
      this.gap = gap;
      this.grid.forEach((f, i) => {
        const x = i % FC.COLS, y = Math.floor(i / FC.COLS);
        f.place(this.ox + x * this.cw + gap / 2, this.oy + y * this.ch + gap / 2, this.cw - gap, this.ch - gap);
      });
      const b = this.board;
      this.board = null;
      for (const f of this.big.values()) f.remove();
      for (const t of this.tiles.values()) t.remove();
      this.big.clear(); this.tiles.clear();
      if (b) this.setBoard(b, true);
    }

    setFrame(px) {
      this.frame = px;
      for (const [k, t] of this.tiles) if (k.startsWith('graphic:') && t.paint === 'pixels') t.repaint();
    }

    click() {
      if (!this.sound) return;
      const now = performance.now();
      if (now - this.lastClick < 9) return;
      this.lastClick = now;
      try {
        if (!this.audio) {
          this.audio = new AudioContext();
          const len = this.audio.sampleRate * 0.012, buf = this.audio.createBuffer(1, len, this.audio.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
          this.clickBuf = buf;
        }
        const src = this.audio.createBufferSource(), g = this.audio.createGain(), f = this.audio.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 2200 + Math.random() * 1500; f.Q.value = 1.2;
        g.gain.value = 0.07;
        src.buffer = this.clickBuf;
        src.connect(f).connect(g).connect(this.audio.destination);
        src.start();
      } catch (e) { /* no audio */ }
    }

    setBoard(board, instant = false) {
      if (!this.active || !this.cw) { this.board = board; return; }
      const turn = !this.board || this.board.key !== board.key;
      this.board = board;
      const delayAt = (x, y) => (instant ? 0 : turn ? x * 24 + y * 55 : x * 8);
      const click = () => this.click();

      // Target state for every small flap
      const targets = this.grid.map(() => ({ ch: ' ', fg: INK, bg: FLAP_BG }));
      const hidden = new Set(), onTop = new Set();       // onTop: small text flaps drawn over a graphic
      const seenBig = new Set(), seenTiles = new Set();

      for (const c of board.cells) {
        const h = c.h || 1;
        if (c.type === 'text') {
          const text = c.text.toUpperCase();
          const fg = textColor(c.color), bg = c.bg ? FC.B.mix(c.bg, [0, 0, 0], 0.15) : FLAP_BG;
          const n = Math.floor(c.w / h);
          let start = 0;
          if (c.align === 'right') start = n - text.length;
          else if (c.align === 'center') start = Math.floor((n - text.length) / 2);
          for (let i = 0; i < n; i++) {
            const ch = text[i - start] ?? ' ';
            if (h === 1) {
              const idx = c.y * FC.COLS + c.x + i;
              targets[idx] = { ch, fg, bg };
              onTop.add(idx);
            } else {
              const key = `${c.x + i * h},${c.y},${h}`;
              seenBig.add(key);
              let f = this.big.get(key);
              if (!f) {
                f = new Flap(this.el, 'flap big');
                f.place(this.ox + (c.x + i * h) * this.cw + this.gap / 2, this.oy + c.y * this.ch + this.gap / 2,
                        h * this.cw - this.gap, h * this.ch - this.gap);
                this.big.set(key, f);
              }
              f.set({ ch, fg, bg }, delayAt(c.x + i * h, c.y), click);
            }
          }
          if (h > 1) for (let yy = c.y; yy < c.y + h; yy++) for (let xx = c.x; xx < c.x + n * h; xx++) hidden.add(yy * FC.COLS + xx);
          // The leftover columns of a big cell (w not a multiple of h) stay blank flaps
        } else {
          const key = `${c.type}:${c.x},${c.y},${c.w},${h}`;
          seenTiles.add(key);
          let t = this.tiles.get(key);
          if (!t) {
            t = new Tile(this.el);
            t.place(this.ox + c.x * this.cw + this.gap / 2, this.oy + c.y * this.ch + this.gap / 2, c.w * this.cw - this.gap, h * this.ch - this.gap);
            this.tiles.set(key, t);
          }
          for (let yy = c.y; yy < c.y + h; yy++) for (let xx = c.x; xx < c.x + c.w; xx++) hidden.add(yy * FC.COLS + xx);
          this._tile(t, c, delayAt(c.x, c.y));
        }
      }

      for (const i of onTop) hidden.delete(i);
      this.grid.forEach((f, i) => {
        f.el.style.visibility = hidden.has(i) ? 'hidden' : '';
        if (!hidden.has(i)) f.set(targets[i], delayAt(i % FC.COLS, Math.floor(i / FC.COLS)), click);
        else f.set({ ch: ' ', fg: INK, bg: FLAP_BG }, 0);
      });
      for (const [k, f] of this.big) if (!seenBig.has(k)) { f.remove(); this.big.delete(k); }
      for (const [k, t] of this.tiles) if (!seenTiles.has(k)) { t.remove(); this.tiles.delete(k); }
    }

    _tile(t, c, delay) {
      const dpr = window.devicePixelRatio || 1;
      const canvasFace = (paint) => (face) => {
        let cv = face.querySelector('canvas');
        if (!cv) { face.innerHTML = ''; cv = document.createElement('canvas'); face.appendChild(cv); }
        cv.width = Math.round(t.w * dpr); cv.height = Math.round(t.h * dpr);
        const ctx = cv.getContext('2d');
        paint(ctx, cv.width, cv.height);
      };
      const theme = { kind: 'flip', color: (rgb) => css(rgb), frame: this.frame };
      if (c.type === 'icon') {
        const ic = c.icon || {};
        const src = ic.kind === 'weather' ? FC.svgURL(FC.weatherSVG(ic.code, ic.night, 'flip'))
          : ic.kind === 'glyph' ? FC.svgURL(FC.glyphSVG(ic.name, 'flip')) : ic.src;
        t.show('icon:' + src, (face) => {
          face.innerHTML = '';
          const img = new Image();
          img.src = src;
          img.className = ic.cover ? 'photo' : '';      // album art fills the tile; logos fit inside it
          img.onerror = () => { img.style.visibility = 'hidden'; };
          img.onload = () => {                    // tiny pixel logos: keep them crisp, don't crop
            if (img.naturalWidth < 48) { img.className = 'pixel'; }
          };
          face.appendChild(img);
        }, delay);
      } else if (c.type === 'bar') {
        const segs = Math.max(4, c.w * 2), lit = Math.round(c.frac * segs), color = textColor(c.color);
        t.show(`bar:${lit}:${color}`, canvasFace((ctx, w, h) => {
          const sw = w / segs, bh = c.thin ? h * 0.42 : h * 0.6, y = (h - bh) / 2;
          for (let i = 0; i < segs; i++) {
            ctx.fillStyle = i < lit ? css(color) : '#2a2a2c';
            ctx.fillRect(i * sw + 1, y, sw - 2, bh);
          }
        }), delay);
      } else if (c.type === 'graphic') {
        const paint = FC.paint[c.paint];
        t.paint = c.paint;
        const render = canvasFace((ctx, w, h) => {
          ctx.fillStyle = '#111113'; ctx.fillRect(0, 0, w, h);
          if (paint) paint(ctx, w, h, c.data || {}, { ...theme, frame: this.frame });
        });
        t.repaint = () => render(t.face);
        // The radar folds over when its data change; raw pixels redraw live. The world map
        // only folds when it appears: the sun and moon creep every poll, so it redraws in place
        const data = JSON.stringify(c.data);
        const sig = c.paint === 'pixels' ? 'pixels:' + (this.board && this.board.key) + data
          : c.paint === 'world' ? 'world' : `${c.paint}:${data}`;
        if (c.paint === 'world' && t.sig === sig && t.data !== data) render(t.face);
        t.data = data;
        t.show(sig, render, delay, c.paint === 'pixels');
      }
    }
  };
})(window.FC);
