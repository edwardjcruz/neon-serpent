// Line Up rules and computer opponent: a 7×6 grid, discs drop to the lowest free row, four in a row (any
// direction) wins. Pure functions so online play can check the opponent's move the same way on both screens.
globalThis.NeonLineUp = (() => {
  const COLS = 7, ROWS = 6, SIZE = COLS * ROWS;
  const at = (col, row) => row * COLS + col; // row 0 is the bottom
  const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // Every four-cell line on the board, used for both win checks and the computer's position scoring.
  const LINES = [];
  for (let row = 0; row < ROWS; row += 1) for (let col = 0; col < COLS; col += 1) for (const [dc, dr] of DIRECTIONS) {
    const cells = [0, 1, 2, 3].map((i) => [col + dc * i, row + dr * i]);
    if (cells.every(([c, r]) => c >= 0 && c < COLS && r >= 0 && r < ROWS)) LINES.push(cells.map(([c, r]) => at(c, r)));
  }

  // `board` is a 42-character string: '.' empty, '0' or '1' for each seat's disc.
  function newGame(starter = 0, match = [0, 0]) {
    return { board: '.'.repeat(SIZE), turn: starter, starter, winner: null, draw: false, line: null, moves: 0, last: null, match: [...match], message: 'PLAYER ' + (starter + 1) + ' TO DROP' };
  }
  const landingRow = (board, col) => { for (let row = 0; row < ROWS; row += 1) if (board[at(col, row)] === '.') return row; return -1; };
  const canDrop = (state, col) => state.winner === null && !state.draw && Number.isInteger(col) && col >= 0 && col < COLS && landingRow(state.board, col) >= 0;

  function winningLine(board, seat) {
    const mark = String(seat);
    return LINES.find((line) => line.every((cell) => board[cell] === mark)) || null;
  }

  // Returns the next state, or null if that column can't be played.
  function drop(state, col) {
    if (!canDrop(state, col)) return null;
    const row = landingRow(state.board, col), seat = state.turn, index = at(col, row);
    const board = state.board.slice(0, index) + seat + state.board.slice(index + 1);
    const next = { ...state, board, moves: state.moves + 1, last: { col, row, seat }, match: [...(state.match || [0, 0])] };
    const line = winningLine(board, seat);
    if (line) { next.winner = seat; next.line = line; next.match[seat] += 1; next.message = `PLAYER ${seat + 1} LINES UP FOUR`; return next; }
    if (!board.includes('.')) { next.draw = true; next.message = 'BOARD FULL — DRAW'; return next; }
    next.turn = 1 - seat; next.message = `PLAYER ${next.turn + 1} TO DROP`;
    return next;
  }

  // ---------- computer opponent: negamax with alpha-beta pruning ----------
  const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre columns first prunes far more branches
  const LEVELS = { easy: { depth: 2, blunder: .3 }, medium: { depth: 4, blunder: .08 }, hard: { depth: 7, blunder: 0 } };

  function scoreWindow(board, line, mark, theirs) {
    let mine = 0, other = 0, empty = 0;
    for (const cell of line) { const value = board[cell]; if (value === mark) mine += 1; else if (value === theirs) other += 1; else empty += 1; }
    if (mine && other) return 0;
    if (mine === 3 && empty === 1) return 6;
    if (mine === 2 && empty === 2) return 2;
    if (other === 3 && empty === 1) return -7;
    if (other === 2 && empty === 2) return -2;
    return 0;
  }
  function evaluate(board, seat) {
    const mark = String(seat), theirs = String(1 - seat);
    let score = 0;
    for (let row = 0; row < ROWS; row += 1) { const value = board[at(3, row)]; if (value === mark) score += 3; else if (value === theirs) score -= 3; }
    for (const line of LINES) score += scoreWindow(board, line, mark, theirs);
    return score;
  }
  function place(board, col, seat) { const row = landingRow(board, col); if (row < 0) return null; const index = at(col, row); return { board: board.slice(0, index) + seat + board.slice(index + 1), index }; }
  function wins(board, index, seat) {
    const mark = String(seat);
    return LINES.some((line) => line.includes(index) && line.every((cell) => board[cell] === mark));
  }
  function negamax(board, seat, depth, alpha, beta, filled) {
    if (filled === SIZE) return 0;
    if (depth === 0) return evaluate(board, seat);
    let best = -Infinity;
    for (const col of ORDER) {
      const move = place(board, col, seat);
      if (!move) continue;
      // Quicker wins score higher, slower losses less badly.
      const value = wins(move.board, move.index, seat) ? 1000 + depth : -negamax(move.board, 1 - seat, depth - 1, -beta, -alpha, filled + 1);
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(state, level = 'medium', random = Math.random) {
    const { depth, blunder } = LEVELS[level] || LEVELS.medium, seat = state.turn;
    const legal = ORDER.filter((col) => landingRow(state.board, col) >= 0);
    // Always take a win and always block an immediate loss, even on Easy, so it never looks broken.
    for (const col of legal) { const move = place(state.board, col, seat); if (wins(move.board, move.index, seat)) return col; }
    for (const col of legal) { const move = place(state.board, col, 1 - seat); if (wins(move.board, move.index, 1 - seat)) return col; }
    if (random() < blunder) return legal[Math.floor(random() * legal.length)];
    let best = legal[0], bestValue = -Infinity;
    for (const col of legal) {
      const move = place(state.board, col, seat);
      const value = -negamax(move.board, 1 - seat, depth - 1, -Infinity, Infinity, state.moves + 1) + random() * .5;
      if (value > bestValue) { bestValue = value; best = col; }
    }
    return best;
  }

  return { COLS, ROWS, at, newGame, drop, canDrop, landingRow, chooseMove, LEVELS };
})();
