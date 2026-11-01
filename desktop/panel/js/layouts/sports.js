// Sports: league + status, each team's logo, name and big score, situation line
(function (FC) {
  const { B } = FC;

  function status(g) {
    if (g.state === 'post') return 'FINAL';
    if (g.state === 'pre') return g.status_detail || 'SOON';
    const p = g.period ? `Q${g.period}` : '';
    return [g.clock, p].filter(Boolean).join(' ') || g.status_detail || 'LIVE';
  }

  function team(t, y, g, side) {
    const cells = [];
    const logo = t.logo_url ? { kind: 'url', src: t.logo_url } : null;
    if (logo) cells.push(B.icon(0, y, 4, 3, logo));
    const col = t.color && (t.color[0] + t.color[1] + t.color[2] > 120) ? t.color : B.WHITE;
    cells.push(B.text(5, y + 1, 7, B.fit(t.name, 7), { color: col }));
    const sit = g.situation || {};
    if (g.state === 'in' && sit.possession && sit.possession === t.team_id) cells.push(B.text(12, y + 1, 2, '<', { color: B.AMBER }));
    if (g.state !== 'pre') cells.push(B.big(15, y, 9, 3, B.pad(String(t.score ?? ''), 3, 'right'), { color: B.WHITE }));
    return cells;
  }

  FC.layouts.sports = (m) => {
    const g = m.game || {};
    const st = status(g);
    const live = g.state === 'in';
    const cells = [
      B.text(0, 0, 11, B.fit(g.league, 11), { color: B.AMBER }),
      B.text(11, 0, 13, B.pad(st, 13, 'right'), { color: live ? B.GREEN : B.DIM }),
      ...team(g.away || {}, 1, g, 'away'),
      ...team(g.home || {}, 4, g, 'home'),
    ];
    const sit = g.situation || {};
    let line = '';
    if (live && g.league_id === 'mlb') line = `B${sit.balls} S${sit.strikes} O${sit.outs}`;
    else if (live && sit.down) line = `${['', '1st', '2nd', '3rd', '4th'][sit.down] || ''} & ${sit.distance}`;
    else if (g.state === 'pre' && g.game_date) line = g.game_date;
    cells.push(B.text(0, 7, 19, B.fit(line, 19), { color: B.DIM }));
    if (m.count > 1) cells.push(B.text(19, 7, 5, B.pad(`${m.index + 1}/${m.count}`, 5, 'right'), { color: B.DIM }));
    return { key: g.game_id || m.index, cells };
  };
})(window.FC);
