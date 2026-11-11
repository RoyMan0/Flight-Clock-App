// Now playing: album art, title, artist, album, progress bar (PAUSED and an amber bar while paused)
(function (FC) {
  const { B } = FC;
  const SOURCES = { spotify: 'Spotify', mac: 'Music', lastfm: 'Last.fm' };

  FC.layouts.now_playing = (m) => {
    const cells = [];
    const art = m.art_url ? { kind: 'url', src: m.art_url, cover: true }
      : m.has_art ? { kind: 'url', cover: true, src: `/api/display/asset/art/x${m.art_key ? String(m.art_key).replace(/\W/g, '').slice(0, 14) : ''}` }
      : { kind: 'glyph', name: 'note' };
    cells.push(B.icon(0, 0, 9, 6, art));
    const title = B.wrap(m.title, 14, 2);
    title.forEach((l, i) => cells.push(B.text(10, i, 14, l, { color: B.WHITE })));
    cells.push(B.text(10, 3, 14, B.fit(m.artist, 14), { color: [255, 200, 100] }));
    cells.push(B.text(10, 4, 14, B.fit(m.album, 14), { color: B.DIM }));
    const accent = m.paused ? [235, 160, 30] : [90, 200, 120];
    cells.push(B.text(10, 5, 14, B.fit(m.paused ? 'PAUSED' : SOURCES[m.source] || '', 14), { color: accent }));
    if (m.progress != null) cells.push(B.bar(0, 7, 24, m.progress, { color: accent }));
    return { key: `${m.title}|${m.artist}`, cells };
  };
})(window.FC);
