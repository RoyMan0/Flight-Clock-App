// Stocks: ETFs and stocks as board rows (symbol, price, day change), paged
(function (FC) {
  const { B } = FC;

  function rows(list, y0, n, now, label) {
    const cells = [B.text(0, y0, 24, label, { color: B.DIM })];
    const p = B.page(list, n, now, 6000);
    p.items.forEach((e, i) => {
      const y = y0 + 1 + i, pct = e.day_change_pct;
      const col = B.signColor(pct);
      cells.push(B.text(0, y, 6, B.fit(e.symbol, 6), { color: B.WHITE }));
      cells.push(B.text(7, y, 9, B.pad(e.price == null ? '--' : Number(e.price).toFixed(2), 9, 'right'), { color: B.WHITE }));
      cells.push(B.text(17, y, 7, B.pad(pct == null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, 7, 'right'), { color: col }));
    });
    if (p.pages > 1) {
      cells[0] = B.text(0, y0, 19, label, { color: B.DIM });
      cells.push(B.text(19, y0, 5, B.pad(`${p.page + 1}/${p.pages}`, 5, 'right'), { color: B.DIM }));
    }
    return { cells, key: p.page };
  }

  FC.layouts.stock_ticker = (m, { now }) => {
    const etfs = m.etfs || [], stocks = m.stocks || [];
    if (!etfs.length || !stocks.length) {
      const r = rows(etfs.length ? etfs : stocks, 0, 7, now, etfs.length ? 'ETFS' : 'STOCKS');
      return { key: 'one' + r.key, cells: r.cells };
    }
    const a = rows(etfs, 0, 3, now, 'ETFS'), b = rows(stocks, 4, 3, now, 'STOCKS');
    return { key: `${a.key}.${b.key}`, cells: [...a.cells, ...b.cells] };
  };
})(window.FC);
