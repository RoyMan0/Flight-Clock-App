// Breaking news: red banner, one headline per page, wrapped across the board
(function (FC) {
  const { B } = FC;

  FC.layouts.ap_news = (m, { now }) => {
    const list = m.headlines || [];
    const p = B.page(list, 1, now, 9000);
    const lines = B.wrap(p.items[0] || '', 24, 6);
    const cells = [
      B.text(0, 0, 18, B.fit(m.banner || 'BREAKING NEWS', 18), { color: B.WHITE, bg: [190, 25, 30] }),
      B.text(18, 0, 6, B.pad(`${p.page + 1}/${p.pages}`, 6, 'right'), { color: B.WHITE, bg: [190, 25, 30] }),
    ];
    lines.forEach((l, i) => cells.push(B.text(0, 1 + i + (lines.length < 5 ? 1 : 0), 24, l, { color: B.WHITE })));
    return { key: p.page, cells };
  };
})(window.FC);
