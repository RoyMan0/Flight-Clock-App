// Snow report: resort, big base depth, new snow, conditions, trails open
(function (FC) {
  const { B } = FC;

  FC.layouts.snow_report = (m) => {
    const r = m.report || {};
    const u = r.snow_unit || '"';
    const cells = [B.text(0, 0, 19, B.fit(r.name, 19), { color: [150, 210, 255] })];
    if (m.count > 1) cells.push(B.text(19, 0, 5, B.pad(`${m.index + 1}/${m.count}`, 5, 'right'), { color: B.DIM }));
    if (r.error) return { key: m.index, cells: [...cells, B.text(0, 3, 24, B.fit(r.error, 24), { color: B.RED })] };
    cells.push(B.text(0, 2, 6, 'BASE', { color: B.DIM }));
    cells.push(B.big(6, 1, 18, 3, B.pad(r.base_depth == null ? '--' : `${Math.round(r.base_depth)}${u === 'cm' ? 'CM' : '"'}`, 6, 'right'), { color: B.WHITE }));
    cells.push(B.text(0, 5, 12, B.fit(`+${Math.round(r.new_snow_24h || 0)}${u} NEW`, 12), { color: [120, 220, 255] }));
    cells.push(B.text(12, 5, 12, B.pad(r.conditions || '', 12, 'right'), { color: B.WHITE }));
    if (r.open_trails != null && r.total_trails != null)
      cells.push(B.text(0, 7, 24, B.fit(`${r.open_trails}/${r.total_trails} TRAILS OPEN`, 24), { color: B.GREEN }));
    return { key: m.index, cells };
  };
})(window.FC);
