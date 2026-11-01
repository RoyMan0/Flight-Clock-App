// Clock & weather: date + temp, big time, today's icon, alert line, 3-day forecast
(function (FC) {
  const { B } = FC;
  const DAY = [255, 150, 40], NIGHT = [90, 150, 255];

  FC.layouts.clock_weather = (m, { now }) => {
    if (m.view === 'iss') return iss(m);
    const cells = [];
    const dateCol = (m.date_colors && m.date_colors[1]) || B.WHITE;
    cells.push(B.text(0, 0, 12, B.fit(`${(m.weekday || '').slice(0, 3)} ${m.date}`, 12), { color: dateCol }));
    if (m.temp != null) cells.push(B.text(18, 0, 6, B.pad(`${m.temp}°`, 6, 'right'), { color: B.humidityColor(m.humidity) }));

    const clock = m.daytime == null ? B.WHITE : m.daytime ? DAY : NIGHT;
    cells.push(B.big(0, 1, 15, 3, B.pad(m.time, 5, 'right'), { color: clock }));
    if (m.ampm) cells.push(B.text(15, 3, 2, m.ampm, { color: clock, dim: true }));
    const today = (m.forecast || [])[0];
    if (today) cells.push(B.icon(18, 1, 6, 3, { kind: 'weather', code: today.code, night: m.daytime === false }));

    const alerts = m.alerts || [];
    if (alerts.length) {
      const a = alerts[(m.alert_index || 0) % alerts.length];
      cells.push(B.text(0, 4, 24, B.fit(a.text, 24), { color: a.color || B.AMBER }));
    }

    (m.forecast || []).slice(0, 3).forEach((d, i) => {
      const x = i * 8;
      cells.push(B.text(x, 5, 4, B.fit(d.day, 3), { color: [200, 200, 200] }));
      cells.push(B.icon(x + 4, 5, 3, 2, { kind: 'weather', code: d.code }));
      cells.push(B.text(x, 6, 4, B.fit(`${d.max}°`, 4), { color: [255, 190, 110] }));
      cells.push(B.text(x, 7, 4, B.fit(`${d.min}°`, 4), { color: [140, 180, 255] }));
    });
    return { key: 'clock', cells };
  };

  function iss(m) {
    const rem = Math.max(0, m.remaining_sec || 0);
    const cells = [
      B.text(0, 0, 24, B.pad('ISS OVERHEAD', 24, 'center'), { color: B.WHITE }),
      B.graphic(0, 1, 24, 3, 'iss', { progress: m.progress || 0 }),
      B.big(4, 5, 16, 3, B.pad(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`, 5, 'center'), { color: [255, 220, 0] }),
    ];
    if (m.rise_azimuth && m.set_azimuth) {
      const el = m.max_elevation != null ? ` ${Math.round(m.max_elevation)}°` : '';
      cells.push(B.text(0, 4, 24, B.pad(`${m.rise_azimuth} → ${m.set_azimuth}${el}`, 24, 'center'), { color: B.DIM }));
    }
    return { key: 'iss', cells };
  }
})(window.FC);
