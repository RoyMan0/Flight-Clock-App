// Overhead flights: airline + flight number, big route, distances, aircraft
(function (FC) {
  const { B } = FC;

  FC.layouts.flight_tracker = (m) => {
    if (m.view === 'radar') return radar(m);
    const cells = [];
    if (m.owner_icao) cells.push(B.icon(0, 0, 3, 2, { kind: 'url', src: `/api/display/asset/logo/${m.owner_icao}` }));
    const pageW = m.count > 1 ? (m.count > 9 ? 5 : 3) : 0;
    cells.push(B.text(4, 0, 20 - pageW, B.fit(m.airline || m.callsign || '', 20 - pageW), { color: [255, 215, 120] }));
    if (pageW) cells.push(B.text(24 - pageW, 0, pageW, B.pad(`${m.index + 1}/${m.count}`, pageW, 'right'), { color: B.DIM }));
    if (m.airline && m.callsign) cells.push(B.text(4, 1, 20, B.fit(m.callsign, 20), { color: [255, 240, 200] }));

    cells.push(B.big(0, 2, 9, 3, B.pad(m.origin || '?', 3), { color: m.origin_color || B.WHITE }));
    cells.push(B.big(10, 2, 3, 3, '>', { color: B.DIM }));
    cells.push(B.big(14, 2, 9, 3, B.pad(m.destination || '?', 3), { color: m.destination_color || B.WHITE }));

    const u = m.units || 'mi';
    if (m.distance_origin != null) cells.push(B.text(0, 5, 10, B.fit(`${Math.round(m.distance_origin)}${u}`, 10), { color: [120, 220, 140] }));
    if (m.distance_destination != null)
      cells.push(B.text(14, 5, 10, B.pad(`${Math.round(m.distance_destination)}${u}`, 10, 'right'), { color: [255, 140, 140] }));

    cells.push(B.text(0, 6, 24, B.fit(m.plane || '', 24), { color: [170, 210, 255] }));
    const bits = [];
    if (m.distance != null) bits.push(`${Number(m.distance).toFixed(1)}${u} ${m.direction || ''}`.trim());
    if (m.details && m.altitude) bits.push(`${Math.round(m.altitude).toLocaleString('en-US')}ft`);
    if (m.details && m.ground_speed) bits.push(`${Math.round(m.ground_speed)}kt`);
    cells.push(B.text(0, 7, 24, B.fit(bits.join('  '), 24), { color: [120, 210, 210] }));
    return { key: m.callsign || m.index, cells };
  };

  function radar(m) {
    return { key: 'radar', cells: [
      B.graphic(0, 0, 24, 8, 'radar', m),
      B.text(0, 0, 8, B.fit(`${(m.planes || []).length} PLANES`, 8), { color: [120, 220, 140] }),
    ] };
  }
})(window.FC);
