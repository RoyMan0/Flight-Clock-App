// Calendar: detailed (one event per page), compact (a row per event), or a reminder card
(function (FC) {
  const { B } = FC;

  function eventPage(ev, header, headerColor, right) {
    const cells = [
      B.text(0, 0, 18, B.fit(header, 18), { color: B.WHITE, bg: B.mix(ev.color, [0, 0, 0], 0.35) }),
      B.text(18, 0, 6, B.pad(right || '', 6, 'right'), { color: B.DIM, bg: B.mix(ev.color, [0, 0, 0], 0.35) }),
      B.big(0, 1, 12, 2, B.pad(ev.time, 6), { color: ev.now ? B.GREEN : headerColor || B.WHITE }),
      B.text(13, 2, 11, B.pad(ev.sub, 11, 'right'), { color: B.DIM }),
    ];
    const lines = B.wrap(ev.title, 24, ev.location ? 2 : 3);
    lines.forEach((l, i) => cells.push(B.text(0, 3 + i, 24, l, { color: B.WHITE })));
    if (ev.location) cells.push(B.text(0, 3 + lines.length, 24, B.fit(ev.location, 24), { color: B.DIM }));
    cells.push(B.text(0, 7, 24, B.fit(ev.day, 24), { color: ev.color }));
    return cells;
  }

  FC.layouts.calendar = (m, { now }) => {
    if (m.view === 'reminder') {
      const ev = m.events[0];
      return { key: 'remind', cells: eventPage(ev, m.title, null, '') };
    }
    if (m.view === 'compact') {
      const p = B.page(m.rows || [], 8, now, 8000);
      const cells = [];
      p.items.forEach((r, y) => {
        if (r.day) return cells.push(B.text(0, y, 24, B.fit(r.day, 24), { color: B.DIM, bg: [40, 40, 40] }));
        const ev = r.event;
        cells.push(B.text(0, y, 1, ' ', { bg: ev.color }));
        cells.push(B.text(1, y, 6, B.pad(ev.time, 6), { color: ev.now ? B.GREEN : B.WHITE }));
        cells.push(B.text(8, y, 16, B.fit(ev.title, 16), { color: B.WHITE }));
      });
      return { key: 'c' + p.page, cells };
    }
    const events = m.events || [];
    const i = Math.min(m.index || 0, events.length - 1);
    const ev = events[i];
    return { key: i, cells: eventPage(ev, ev.source, null, events.length > 1 ? `${i + 1}/${events.length}` : '') };
  };
})(window.FC);
