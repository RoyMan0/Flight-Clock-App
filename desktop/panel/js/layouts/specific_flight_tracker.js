// A tracked flight: clock bar, big route, progress, time/distance left, aircraft, nearby place
(function (FC) {
  const { B } = FC;

  FC.layouts.specific_flight_tracker = (m, { now }) => {
    const f = m.flight || {};
    const d = new Date(now);
    const cells = [
      B.text(0, 0, 14, B.fit(f.callsign || '', 14), { color: [255, 215, 120] }),
      B.text(16, 0, 8, B.pad(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', ''), 8, 'right'), { color: B.DIM }),
      B.big(0, 1, 9, 3, B.pad(f.origin || '?', 3), { color: f.origin_color || B.WHITE }),
      B.big(10, 1, 3, 3, '>', { color: B.DIM }),
      B.big(14, 1, 9, 3, B.pad(f.destination || '?', 3), { color: f.destination_color || B.WHITE }),
      B.bar(0, 4, 24, f.progress || 0, { color: [80, 200, 255] }),
      B.text(0, 5, 12, B.fit(`${f.time_remaining || ''} left`, 12), { color: [255, 210, 120] }),
      B.text(12, 5, 12, B.pad(`${Math.round(f.dist_remaining || 0)}${m.units || 'mi'}`, 12, 'right'), { color: [120, 210, 210] }),
    ];
    const bits = [f.plane_type, f.registration];
    if (m.details && f.altitude) bits.push(`${Math.round(f.altitude).toLocaleString('en-US')}ft`);
    if (m.details && f.ground_speed) bits.push(`${f.ground_speed}kt`);
    cells.push(B.text(0, 6, 24, B.fit(bits.filter(Boolean).join('  '), 24), { color: [170, 210, 255] }));
    const near = m.poi || m.city, nw = m.count > 1 ? 20 : 24;
    const place = near ? `near ${near}` : m.region ? `over ${m.region}` : '';   // region: sea/ocean or country
    if (place) cells.push(B.text(0, 7, nw, B.fit(place, nw), { color: [190, 160, 255] }));
    if (m.count > 1) cells.push(B.text(21, 7, 3, B.pad(`${m.index + 1}/${m.count}`, 3, 'right'), { color: B.DIM }));
    return { key: f.callsign || m.index, cells };
  };
})(window.FC);
