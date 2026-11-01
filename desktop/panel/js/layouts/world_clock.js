// World clock: one row per city, time coloured for day / night, paged by seven
(function (FC) {
  const { B } = FC;

  FC.layouts.world_clock = (m, { now }) => {
    const p = B.page(m.rows || [], 7, now, 8000);
    const cells = [B.text(0, 0, 19, 'WORLD CLOCK', { color: B.DIM })];
    if (p.pages > 1) cells.push(B.text(19, 0, 5, B.pad(`${p.page + 1}/${p.pages}`, 5, 'right'), { color: B.DIM }));
    p.items.forEach((r, i) => {
      const y = 1 + i;
      cells.push(B.text(0, y, 14, B.fit(r.name, 14), { color: [230, 230, 230] }));
      if (r.marker) cells.push(B.text(14, y, 3, B.pad(r.marker, 3, 'right'), { color: B.DIM }));
      cells.push(B.text(17, y, 7, B.pad(r.time, 7, 'right'), { color: r.day ? [255, 150, 40] : [90, 150, 255] }));
    });
    return { key: p.page, cells };
  };
})(window.FC);
