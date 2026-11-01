// Transit: departures board — line tile in the line's colour, destination, minutes
(function (FC) {
  const { B } = FC;

  FC.layouts.transit = (m, { now }) => {
    const pages = m.pages || [];
    const p = B.page(pages, 1, now, 9000);
    const pg = p.items[0];
    if (!pg) return null;
    const head = pg.title || 'DEPARTURES';
    const cells = [B.text(0, 0, 19, B.fit(head, 19), { color: B.AMBER }),
                   B.text(19, 0, 5, B.pad(m.time_label || 'Min', 5, 'right'), { color: B.DIM })];
    pg.rows.slice(0, 7).forEach((r, i) => {
      const y = 1 + i, col = r.missable ? B.DIM : B.WHITE;
      cells.push(B.text(0, y, 3, B.pad(r.label, 3, 'center'), { color: [255, 255, 255], bg: r.color }));
      cells.push(B.text(4, y, 14, B.fit(r.dest, 14), { color: col }));
      cells.push(B.text(18, y, 6, B.pad(r.min, 6, 'right'), { color: r.missable ? B.DIM : r.realtime === false ? [200, 200, 140] : B.GREEN }));
    });
    return { key: p.page, cells };
  };
})(window.FC);
