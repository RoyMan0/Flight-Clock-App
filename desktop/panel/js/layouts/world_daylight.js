// World daylight: the map (drawn by the screen), with time / date / temp on top
(function (FC) {
  const { B } = FC;

  FC.layouts.world_daylight = (m) => {
    const cells = [B.graphic(0, 0, 24, 8, 'world', m)];
    let y = 0;
    const box = (text, color) => cells.push(B.text(16, y++, 8, B.pad(text, 8, 'right'), { color, bg: [0, 0, 0] }));
    if (m.time) box(m.time, m.night ? [90, 150, 255] : [255, 150, 40]);
    if (m.date) box(m.date, B.WHITE);
    if (m.temp) box(m.temp, m.temp_color || B.WHITE);
    return { key: 'map', cells };
  };
})(window.FC);
