// System stats: one machine per page — name + uptime, then a row per stat with a bar
(function (FC) {
  const { B } = FC;

  FC.layouts.system_stats = (m, { now }) => {
    const p = B.page(m.hosts || [], 1, now, 8000);
    const h = p.items[0];
    if (!h) return null;
    const cells = [B.text(0, 0, 15, B.fit(h.name, 15), { color: [255, 215, 120] })];
    cells.push(B.text(15, 0, 9, B.pad(h.offline ? 'OFFLINE' : h.uptime || '', 9, 'right'),
                      { color: h.offline ? B.RED : B.DIM }));
    if (h.offline) return { key: p.page + 'off', cells };
    const temps = h.stats.some((s) => s.temp);         // a temperature column on any row
    h.stats.slice(0, 3).forEach((s, i) => {
      const y = 1 + i * 2 + (h.stats.length < 3 ? 1 : 0);
      cells.push(B.text(0, y, 5, B.fit(s.label, 5), { color: s.color }));
      // Values sit at the right edge (like AI Usage); a temperature or a second value takes the
      // right-most column and the main value moves just left of it
      if ('a' in s) {
        cells.push(B.text(6, y, 9, B.pad(`${s.a_mark}${s.a}`, 9, 'right'), { color: B.WHITE }));
        cells.push(B.text(15, y, 9, B.pad(`${s.b_mark}${s.b}`, 9, 'right'), { color: B.WHITE }));
      } else if (temps) {
        cells.push(B.text(6, y, 10, B.pad(s.value ?? '...', 10, 'right'), { color: B.WHITE }));
        if (s.temp) cells.push(B.text(17, y, 7, B.pad(s.temp, 7, 'right'), { color: s.temp_color || B.WHITE }));
      } else {
        cells.push(B.text(6, y, 18, B.pad(s.value ?? '...', 18, 'right'), { color: B.WHITE }));
      }
      cells.push(B.bar(0, y + 1, 24, s.frac, { color: s.color, thin: true }));
    });
    if (p.pages > 1) cells.push(B.text(19, 7, 5, B.pad(`${p.page + 1}/${p.pages}`, 5, 'right'), { color: B.DIM }));
    return { key: p.page, cells };
  };
})(window.FC);
