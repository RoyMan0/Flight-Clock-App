// Board documents: what the flip-board and e-ink screens draw.
//
// A layout (js/layouts/<plugin>.js) turns a plugin's describe() model into a
// Board — cells on a COLS × ROWS grid. Both screens draw any Board, so each
// plugin needs one layout, not one per screen. Layouts are pure functions of
// (model, ctx); they're run on a timer so they can page and tick on their own.
//
// Cell types (x, y, w, h in grid units; h defaults to 1):
//   text     {text, color?, bg?, align?: left|right|center, dim?}
//            Text of height h uses h×h-unit characters (big clock digits etc.)
//   icon     {icon: {kind: weather, code} | {kind: url, src} | {kind: glyph, name}, bg?}
//   bar      {frac 0..1, color?}
//   graphic  {paint: world|radar|pixels|iss|swatch, data}
// Board: {key, cells}. `key` names the page: a change of key is a page turn
// (e-ink does a full refresh, the flip board cascades).

window.FC = window.FC || {};

(function (FC) {
  const COLS = 24, ROWS = 8;
  FC.COLS = COLS;
  FC.ROWS = ROWS;
  FC.layouts = {};

  // B.pad() results remember their alignment, so the e-ink screen (which sets
  // proportional type, not character cells) can align them the same way
  const alignOf = (text, o) => o.align || (text && text.align) || undefined;
  const textCell = (x, y, w, h, text, o) => {
    const cell = { type: 'text', x, y, w, h, text: String(text ?? ''), ...o };
    const a = alignOf(text, o);
    if (a) cell.align = a;
    return cell;
  };
  const B = FC.B = {
    text: (x, y, w, text, o = {}) => textCell(x, y, w, o.h || 1, text, o),
    big: (x, y, w, h, text, o = {}) => textCell(x, y, w, h, text, o),
    icon: (x, y, w, h, icon, o = {}) => ({ type: 'icon', x, y, w, h, icon, ...o }),
    bar: (x, y, w, frac, o = {}) => ({ type: 'bar', x, y, w, h: o.h || 1, frac: clamp01(frac), ...o }),
    graphic: (x, y, w, h, paint, data, o = {}) => ({ type: 'graphic', x, y, w, h, paint, data, ...o }),
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  // Characters that fit in `n` text columns of height h
  B.cap = (w, h = 1) => Math.max(0, Math.floor(w / h));

  // Truncate to n characters, with an ellipsis-free hard cut (split flaps have no "…")
  B.fit = (text, n) => {
    text = String(text ?? '').replace(/\s+/g, ' ').trim();
    return text.length <= n ? text : text.slice(0, Math.max(0, n)).trimEnd();
  };

  // Word-wrap into lines of at most n characters (long words are cut)
  B.wrap = (text, n, maxLines = Infinity) => {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (let w of words) {
      while (w.length > n) {                 // a word longer than the line
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= n) line += ' ' + w;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
    }
    return lines;
  };

  // Split a list into pages of `size`, and pick the page for `now`
  B.page = (items, size, now, ms = 8000) => {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const p = Math.floor(now / ms) % pages;
    return { items: items.slice(p * size, p * size + size), page: p, pages };
  };

  // Right/centre a short string inside w columns (text cells also take align,
  // but padding keeps flap positions stable while the content changes length)
  B.pad = (text, w, align = 'left') => {
    text = B.fit(text, w);
    const gap = w - text.length;
    let out = text + ' '.repeat(gap);
    if (align === 'right') out = ' '.repeat(gap) + text;
    if (align === 'center') out = ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
    return Object.assign(new String(out), { align });   // String(...) gives the plain text back
  };

  // ---- colour ----------------------------------------------------------------
  B.mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  B.hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  B.fromHex = (h) => {
    h = String(h || '').replace('#', '');
    return h.length === 6 ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : null;
  };
  B.GREEN = [80, 220, 100];
  B.RED = [240, 70, 60];
  B.AMBER = [255, 170, 40];
  B.BLUE = [90, 160, 255];
  B.DIM = [130, 130, 130];
  B.WHITE = [235, 235, 235];
  B.signColor = (v) => (v == null ? B.DIM : v >= 0 ? B.GREEN : B.RED);

  // Temperature colour like the panel: white when dry → blue when humid
  B.humidityColor = (h) => (h == null ? B.WHITE : B.mix([255, 255, 255], [30, 90, 200], h / 100));

  // ---- layout driver ------------------------------------------------------------
  // state: {plugin, model, frame} → Board. Unknown plugins and models without a
  // layout show the panel's pixels instead, so nothing ever goes blank.
  FC.buildBoard = (state, now = Date.now()) => {
    const { plugin, model } = state || {};
    const fn = plugin && FC.layouts[plugin];
    if (model && fn && !model.pixels) {
      try {
        const board = fn(model, { now, cols: COLS, rows: ROWS });
        if (board) return { key: plugin + ':' + (board.key ?? ''), cells: board.cells || [] };
      } catch (e) {
        if (typeof console !== 'undefined') console.error('layout ' + plugin, e);
      }
    }
    if (model && fn && model.pixels) {            // pixel-native module (maze) with an optional text card
      const board = fn(model, { now, cols: COLS, rows: ROWS });
      if (board) return { key: plugin + ':' + (board.key ?? ''), cells: board.cells || [], pixels: true };
    }
    return { key: (plugin || 'none') + ':pixels', pixels: true,
             cells: [B.graphic(0, 0, COLS, ROWS, 'pixels', null)] };
  };

  // Check a Board stays on the grid (used by the layout tests)
  FC.validateBoard = (board) => {
    const problems = [];
    for (const c of board.cells) {
      const h = c.h || 1;
      if (c.x < 0 || c.y < 0 || c.x + c.w > COLS || c.y + h > ROWS || c.w <= 0)
        problems.push(`${c.type} "${c.text ?? c.paint ?? ''}" off the grid at ${c.x},${c.y} ${c.w}x${h}`);
      if (c.type === 'text' && c.text.length * h > c.w)
        problems.push(`text "${c.text}" (${c.text.length} chars × ${h}) wider than ${c.w}`);
    }
    // Text, icons and bars may not overlap each other (graphics are backdrops)
    const owner = {};
    for (const c of board.cells) {
      if (c.type === 'graphic') continue;
      for (let y = c.y; y < c.y + (c.h || 1); y++) for (let x = c.x; x < c.x + c.w; x++) {
        const k = x + ',' + y;
        if (owner[k]) { problems.push(`${c.type} "${c.text ?? ''}" overlaps ${owner[k]} at ${k}`); return problems; }
        owner[k] = `${c.type} "${c.text ?? ''}"`;
      }
    }
    return problems;
  };
})(window.FC);
