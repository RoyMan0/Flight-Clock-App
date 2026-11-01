// Maze: the maze is a pixel grid, so the screens draw the panel's pixels; the
// "solved" card is typeset over them
(function (FC) {
  const { B } = FC;

  FC.layouts.maze = (m) => {
    const cells = [B.graphic(0, 0, 24, 8, 'pixels', { dim: m.lines ? 0.2 : 1 })];
    if (m.lines) {
      m.lines.forEach((l, i) => cells.push(B.text(0, 2 + i * 2, 24, B.pad(l, 24, 'center'),
                                                   { color: i === 0 ? m.accent : B.WHITE, bg: [12, 12, 12] })));
    }
    return { key: m.lines ? 'stats' : 'maze', cells };
  };
})(window.FC);
