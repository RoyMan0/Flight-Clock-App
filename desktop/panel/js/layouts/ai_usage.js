// AI usage: provider header, current and weekly use with bars and reset times
(function (FC) {
  const { B } = FC;

  function pctColor(p) {
    if (p == null) return B.DIM;
    return p >= 90 ? B.RED : p >= 70 ? B.AMBER : B.GREEN;
  }

  FC.layouts.ai_usage = (m, { now }) => {
    const cells = [B.text(0, 0, 19, B.fit(m.title, 19), { color: m.color })];
    if (m.count > 1) cells.push(B.text(19, 0, 5, B.pad(`${m.index + 1}/${m.count}`, 5, 'right'), { color: B.DIM }));
    if (m.message) return { key: m.provider + 'msg', cells: [...cells, B.text(0, 3, 24, B.pad(m.message, 24, 'center'), { color: B.AMBER })] };
    const countdown = m.reset_format === 'countdown' || (m.reset_format === 'both' && Math.floor(now / 3000) % 2);
    const row = (y, label, pct, reset) => {
      const v = pct == null ? '--' : `${Math.round(pct)}%`;
      cells.push(B.text(0, y, 10, label, { color: B.WHITE }));
      cells.push(B.text(16, y, 8, B.pad(v, 8, 'right'), { color: pctColor(pct) }));
      cells.push(B.bar(0, y + 1, 24, (pct || 0) / 100, { color: pctColor(pct) }));
      if (m.reset_format !== 'off' && reset) cells.push(B.text(0, y + 2, 24, B.fit(`resets ${reset}`, 24), { color: B.DIM }));
    };
    row(1, 'Current', m.current_pct, countdown ? m.current_countdown : m.current_reset);
    row(4, 'Weekly', m.weekly_pct, countdown ? m.weekly_countdown : m.weekly_reset);
    return { key: m.provider, cells };
  };
})(window.FC);
