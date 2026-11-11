// Countdown: title, then days and a ticking HH:MM:SS (ticks here, between model updates)
(function (FC) {
  const { B } = FC;
  const NOW_COLORS = [[255, 60, 60], [255, 200, 0], [60, 220, 90], [60, 160, 255], [200, 90, 255]];

  FC.layouts.event_countdown = (m, { now }) => {
    const title = B.wrap(m.title, 24, 2);
    const cells = title.map((l, i) => B.text(0, i, 24, B.pad(l, 24, 'center'), { color: [255, 255, 255] }));
    const rem = Math.max(0, m.event_ts * 1000 - now) / 1000;
    if (m.now || rem <= 0) {
      const col = NOW_COLORS[Math.floor(now / 500) % NOW_COLORS.length];
      cells.push(B.big(3, 3, 18, 4, B.pad('NOW!', 4, 'center'), { color: col }));
      return { key: 'now', cells };
    }
    const h = Math.floor(rem % 86400 / 3600), mi = Math.floor(rem % 3600 / 60), s = Math.floor(rem % 60);
    const hms = [h, mi, s].map((v) => String(v).padStart(2, '0')).join(':');
    cells.push(B.bar(0, 2, 24, 1, { color: [150, 60, 220], thin: true }));
    cells.push(B.big(0, 3, 24, 3, B.pad(m.line1 === 'TODAY' ? 'TODAY' : m.line1, 8, 'center'), { color: [255, 200, 60] }));
    cells.push(B.big(0, 6, 24, 2, B.pad(hms, 12, 'center'), { color: [120, 220, 255] }));
    return { key: 'count', cells };
  };
})(window.FC);
