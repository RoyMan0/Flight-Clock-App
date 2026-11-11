// Snow report (OnTheSnow resort reports). Two modes, as on the panel:
//   cards  one resort at a time (following the panel's resort and page): weather icon and
//          high/low on the left, stats on the right (closed/opens, NEW per window, base,
//          runs, lifts); the "forecast" page shows the next three days
//   rows   a table of every resort: name + new snow + runs open
(function (FC) {
  const { B } = FC;
  const ICE = [120, 220, 255], POWDER = [190, 130, 255], LABEL = [140, 140, 150];

  // OnTheSnow weather type → the clock's Tomorrow.io codes (plugins/snow_report/render.py _ICON_RULES)
  const ICON_RULES = [
    ['THUNDER', 8000], ['HAIL', 7000], ['ICE', 7000], ['SLEET', 6000], ['FREEZ', 6000],
    ['HEAVY_SNOW', 5101], ['LIGHT_SNOW', 5100], ['FLURR', 5001], ['SNOW', 5000],
    ['DRIZZLE', 4000], ['LIGHT_RAIN', 4200], ['HEAVY_RAIN', 4201], ['RAIN', 4001], ['SHOWER', 4000],
    ['FOG', 2000], ['MIST', 2000], ['HAZE', 2000],
    ['MOSTLY_CLOUD', 1102], ['OVERCAST', 1001], ['CLOUDY', 1001],
    ['PARTLY', 1101], ['SLIGHTLY_CLOUD', 1101], ['MOSTLY_SUN', 1100], ['MOSTLY_CLEAR', 1100],
    ['SUN', 1000], ['CLEAR', 1000],
  ];
  const iconCode = (type) => {
    const t = String(type || '').toUpperCase();
    const hit = ICON_RULES.find(([k]) => t.includes(k));
    return hit ? hit[1] : 1101;
  };

  const metric = (m) => m.units === 'metric';
  const depth = (cm, m) => (cm == null ? '--' : metric(m) ? `${Math.round(cm)}CM` : `${Math.round(cm / 2.54)}"`);
  const temp = (c, m) => (c == null ? '' : `${Math.round(metric(m) ? c : c * 9 / 5 + 32)}°`);
  const powder = (cm) => cm != null && cm >= 15;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const parseDay = (iso) => { const d = new Date(String(iso) + 'T12:00:00'); return isNaN(d) ? null : d; };

  // label left, value right, in a column of width w
  const stat = (cells, x, y, w, label, value, color, labelColor = LABEL) => {
    cells.push(B.text(x, y, w - value.length - 1, B.fit(label, w - value.length - 1), { color: labelColor }));
    cells.push(B.text(x + w - value.length, y, value.length, value, { color }));
  };

  function header(cells, r, m) {
    const status = r.open ? 'OPEN' : 'CLOSED';
    cells.push(B.text(0, 0, 23 - status.length, B.fit(r.name, 23 - status.length), { color: [150, 210, 255] }));
    cells.push(B.text(24 - status.length, 0, status.length, status, { color: r.open ? B.GREEN : B.RED }));
  }

  function statsPage(cells, r, m) {
    // Left: today's weather and high / low
    const w = r.weather || {};
    cells.push(B.icon(0, 1, 6, 4, { kind: 'weather', code: iconCode(w.type) }));
    const hi = temp(w.high, m), lo = temp(w.low, m);
    if (hi) cells.push(B.text(0, 5, 6, B.pad(hi, 6, 'center'), { color: [255, 190, 90] }));
    if (lo) cells.push(B.text(0, 6, 6, B.pad(lo, 6, 'center'), { color: [120, 180, 255] }));

    // Right: the stat lines (the board has room for all of them on one page)
    const X = 7, W = 17;
    let y = 2;
    const line = (...a) => { if (y < 8) stat(cells, X, y++, W, ...a); };
    if (!r.open) {                                  // CLOSED is in the header; say when it opens
      const d = parseDay(r.opening_date);
      if (d && d >= new Date(new Date().toDateString()))
        cells.push(B.text(X, y++, W, B.fit(`OPENS ${MONTHS[d.getMonth()]} ${d.getDate()}`, W), { color: B.AMBER }));
    }
    for (const win of m.windows || ['24']) {
      const cm = (r.new_cm || {})[win];
      line(`NEW ${win}H`, depth(cm || 0, m), powder(cm) ? POWDER : ICE);
    }
    if (r.open) {
      if (r.base_cm != null || r.summit_cm != null) {
        const b = r.base_cm, s = r.summit_cm;
        const v = b != null && s != null && Math.round(b) !== Math.round(s) ? `${depth(b, m).replace(/"|CM/, '')}-${depth(s, m)}` : depth(b ?? s, m);
        line('BASE', v, B.WHITE);
      }
      if (r.runs_total) line('RUNS', `${Math.round(r.runs_open || 0)}/${Math.round(r.runs_total)}`, r.runs_open ? B.GREEN : LABEL);
      if (r.lifts_total) line('LIFTS', `${Math.round(r.lifts_open || 0)}/${Math.round(r.lifts_total)}`, r.lifts_open ? B.GREEN : LABEL);
      if (r.runs_total && y < 8) {
        const pct = r.runs_pct != null ? r.runs_pct : 100 * (r.runs_open || 0) / r.runs_total;
        cells.push(B.bar(X, y++, W, pct / 100, { color: B.GREEN, thin: true }));
      }
    }
  }

  function forecastPage(cells, r, m) {
    const f = r.forecast || [];
    const days = (f.slice(1, 4).length ? f.slice(1, 4) : f.slice(0, 3));
    days.forEach((d, i) => {
      const x = i * 8, day = parseDay(d.date);
      cells.push(B.text(x, 1, 8, B.pad(day ? DAYS[day.getDay()] : '---', 8, 'center'), { color: [200, 200, 200] }));
      cells.push(B.icon(x + 1, 2, 6, 3, { kind: 'weather', code: iconCode(d.type) }));
      const snow = d.snow ? depth(d.snow, m).replace(/^0("|CM)$/, '<1$1') : '';
      if (snow) cells.push(B.text(x, 5, 8, B.pad(snow, 8, 'center'), { color: powder(d.snow) ? POWDER : ICE }));
      const t = `${temp(d.high, m)}/${temp(d.low, m)}`;
      cells.push(B.text(x, snow ? 6 : 5, 8, B.pad(B.fit(t, 8), 8, 'center'), { color: [255, 190, 90] }));
    });
  }

  function rows(m, now) {
    const cells = [B.text(0, 0, 13, 'RESORT', { color: LABEL }), B.text(14, 0, 4, B.pad('NEW', 4, 'right'), { color: LABEL }),
                   B.text(19, 0, 5, B.pad('RUNS', 5, 'right'), { color: LABEL })];
    const win = (m.windows || ['24'])[0];
    const page = B.page(m.resorts || [], 7, now);
    page.items.forEach((r, i) => {
      const y = i + 1;
      cells.push(B.text(0, y, 13, B.fit(r.name, 13), { color: r.open ? B.WHITE : LABEL }));
      if (r.error) { cells.push(B.text(14, y, 10, B.pad('NO DATA', 10, 'right'), { color: B.RED })); return; }
      const cm = (r.new_cm || {})[win];
      cells.push(B.text(14, y, 4, B.pad(depth(cm || 0, m), 4, 'right'), { color: powder(cm) ? POWDER : ICE }));
      const runs = !r.open ? 'SHUT' : r.runs_pct != null ? `${Math.round(r.runs_pct)}%` : r.runs_total ? `${Math.round(100 * (r.runs_open || 0) / r.runs_total)}%` : '--';
      cells.push(B.text(19, y, 5, B.pad(runs, 5, 'right'), { color: r.open ? B.GREEN : B.RED }));
    });
    return { key: `rows:${page.page}`, cells };
  }

  FC.layouts.snow_report = (m, { now } = {}) => {
    const list = m.resorts || [];
    if (m.mode === 'rows') return rows(m, now || Date.now());
    const i = Math.min(list.length - 1, Math.max(0, m.index || 0));
    const r = list[i];
    if (!r) return { key: 'none', cells: [B.text(0, 3, 24, B.pad('NO RESORTS', 24, 'center'), { color: LABEL })] };
    const cells = [];
    header(cells, r, m);
    if (r.error) {
      B.wrap(r.error, 24, 3).forEach((l, k) => cells.push(B.text(0, 3 + k, 24, l, { color: B.RED })));
    } else if (m.page === 'forecast' && (r.forecast || []).length) {
      forecastPage(cells, r, m);
    } else {
      statsPage(cells, r, m);
    }
    return { key: `${i}:${m.page || 'lines'}`, cells };
  };
})(window.FC);
