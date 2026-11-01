// Layout tests: every fixture → Board at several moments, checked against the grid.
// Run (no Node on the build Mac — JavaScriptCore ships with macOS):
//   desktop/panel/tests/run.sh
var failures = 0, boards = 0;
for (var f of FC.FIXTURES) {
  for (var t = 0; t < 4; t++) {
    var now = Date.now() + t * 9000;
    var board = FC.buildBoard({ plugin: f.plugin, model: f.model ? JSON.parse(JSON.stringify(f.model)) : null }, now);
    boards++;
    var problems = FC.validateBoard(board);
    if (!board.cells.length) problems.push('empty board');
    if (problems.length) { failures++; print('FAIL ' + f.label + ' @' + t + ': ' + problems.join('; ')); }
  }
}
print(boards + ' boards, ' + failures + ' failing');
if (failures) throw new Error('layout tests failed');
