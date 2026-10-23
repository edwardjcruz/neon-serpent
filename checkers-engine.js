// Checkers rules (American / English draughts) and computer opponent. 8×8 board, pieces on dark squares only.
// Seat 0 starts at the bottom and moves up; seat 1 starts at the top and moves down. Captures are compulsory and a
// multi-jump must be finished; a man reaching the far row is crowned and its move ends; kings move one square
// diagonally in any direction. You lose when you have no legal move (including having no pieces).
// Pure functions so online play can check the opponent's move the same way on both screens.
globalThis.NeonCheckers = (() => {
  const N = 8, SIZE = 64, DRAW_PLIES = 80; // 40 moves each with no capture and no man moving is a draw
  const at = (col, row) => row * N + col;
  const colOf = (index) => index % N, rowOf = (index) => Math.floor(index / N);
  const isDark = (index) => (colOf(index) + rowOf(index)) % 2 === 1;
  const seatOf = (piece) => (piece === 'r' || piece === 'R' ? 0 : piece === 'b' || piece === 'B' ? 1 : -1);
  const isKing = (piece) => piece === 'R' || piece === 'B';
  const DIAGONALS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const forward = (seat) => (seat === 0 ? -1 : 1);

  // `board` is a 64-character string: '.' empty, 'r'/'R' seat 0 man/king, 'b'/'B' seat 1 man/king.
  function newGame(starter = 0, match = [0, 0]) {
    let board = '';
    for (let index = 0; index < SIZE; index += 1) board += !isDark(index) ? '.' : rowOf(index) < 3 ? 'b' : rowOf(index) > 4 ? 'r' : '.';
    return { board, turn: starter, starter, winner: null, draw: false, moves: 0, quiet: 0, last: null, match: [...match], message: `PLAYER ${starter + 1} TO MOVE` };
  }

  function step(index, dc, dr) { const col = colOf(index) + dc, row = rowOf(index) + dr; return col >= 0 && col < N && row >= 0 && row < N ? at(col, row) : -1; }
  const directions = (piece) => (isKing(piece) ? DIAGONALS : DIAGONALS.filter(([, dr]) => dr === forward(seatOf(piece))));
  const crowns = (piece, index) => !isKing(piece) && rowOf(index) === (seatOf(piece) === 0 ? 0 : N - 1);

  // Every full jump sequence from `from`. A man that's crowned mid-sequence stops there.
  function jumps(board, from, piece, path = [], captured = []) {
    const out = [];
    for (const [dc, dr] of directions(piece)) {
      const over = step(from, dc, dr), land = over < 0 ? -1 : step(over, dc, dr);
      if (land < 0 || board[land] !== '.' || seatOf(board[over]) !== 1 - seatOf(piece) || captured.includes(over)) continue;
      const nextPath = [...path, land], nextCaptured = [...captured, over];
      if (crowns(piece, land)) { out.push({ path: nextPath, captures: nextCaptured }); continue; }
      // the jumping piece leaves its square; captured pieces stay on the board until the move ends (they can't be jumped twice)
      const moved = board.slice(0, from) + '.' + board.slice(from + 1);
      const more = jumps(moved.slice(0, land) + piece + moved.slice(land + 1), land, piece, nextPath, nextCaptured);
      if (more.length) out.push(...more); else out.push({ path: nextPath, captures: nextCaptured });
    }
    return out;
  }

  // Legal moves for the side to move: [{ from, path: [squares landed on], captures: [squares taken] }].
  function legalMoves(board, seat) {
    const captures = [], slides = [];
    for (let from = 0; from < SIZE; from += 1) {
      const piece = board[from];
      if (seatOf(piece) !== seat) continue;
      for (const jump of jumps(board, from, piece)) captures.push({ from, ...jump });
      if (captures.length) continue;
      for (const [dc, dr] of directions(piece)) { const to = step(from, dc, dr); if (to >= 0 && board[to] === '.') slides.push({ from, path: [to], captures: [] }); }
    }
    return captures.length ? captures : slides;
  }

  function apply(board, move) {
    const piece = board[move.from], to = move.path[move.path.length - 1];
    const cells = board.split('');
    cells[move.from] = '.';
    for (const captured of move.captures) cells[captured] = '.';
    cells[to] = crowns(piece, to) ? piece.toUpperCase() : piece;
    return cells.join('');
  }
  const sameMove = (a, b) => a.from === b.from && a.path.length === b.path.length && a.path.every((square, i) => square === b.path[i]);

  // Returns the next state, or null if `move` ({ from, path }) isn't legal.
  function play(state, move) {
    if (state.winner !== null || state.draw || !move || !Array.isArray(move.path)) return null;
    const legal = legalMoves(state.board, state.turn).find((candidate) => sameMove(candidate, move));
    if (!legal) return null;
    const seat = state.turn, other = 1 - seat, piece = state.board[legal.from], board = apply(state.board, legal);
    const quiet = legal.captures.length || !isKing(piece) ? 0 : state.quiet + 1;
    const next = { ...state, board, moves: state.moves + 1, quiet, last: { ...legal, seat }, match: [...(state.match || [0, 0])], turn: other };
    if (!legalMoves(board, other).length) { next.winner = seat; next.match[seat] += 1; next.message = `PLAYER ${seat + 1} WINS — NO MOVES LEFT FOR PLAYER ${other + 1}`; return next; }
    if (quiet >= DRAW_PLIES) { next.draw = true; next.message = 'DRAW — 40 MOVES WITHOUT PROGRESS'; return next; }
    next.message = legal.captures.length > 1 ? `PLAYER ${seat + 1} TOOK ${legal.captures.length}! PLAYER ${other + 1} TO MOVE` : `PLAYER ${other + 1} TO MOVE`;
    return next;
  }

  // ---------- computer opponent: negamax with alpha-beta ----------
  const LEVELS = { easy: { depth: 2, blunder: .3 }, medium: { depth: 4, blunder: .06 }, hard: { depth: 8, blunder: 0 } };
  function evaluate(board, seat) {
    let score = 0;
    for (let index = 0; index < SIZE; index += 1) {
      const piece = board[index]; if (piece === '.') continue;
      const owner = seatOf(piece), sign = owner === seat ? 1 : -1, row = rowOf(index), col = colOf(index);
      let value = isKing(piece) ? 165 : 100;
      if (!isKing(piece)) {
        value += (owner === 0 ? 7 - row : row) * 3; // advancement
        if (row === (owner === 0 ? 7 : 0)) value += 8; // back row guards against kings
      }
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) value += 6; // centre
      if (col === 0 || col === 7) value -= 4; // edges are safe but passive
      score += sign * value;
    }
    return score;
  }
  function negamax(board, seat, depth, alpha, beta) {
    const moves = legalMoves(board, seat);
    if (!moves.length) return -100000 - depth; // no move = loss; sooner is worse
    // keep searching while captures are pending so the horizon doesn't hide an obvious recapture
    if (depth <= 0 && !moves[0].captures.length) return evaluate(board, seat);
    if (depth <= -6) return evaluate(board, seat);
    moves.sort((a, b) => b.captures.length - a.captures.length);
    let best = -Infinity;
    for (const move of moves) {
      const value = -negamax(apply(board, move), 1 - seat, depth - 1, -beta, -alpha);
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best;
  }
  function chooseMove(state, level = 'medium', random = Math.random) {
    const { depth, blunder } = LEVELS[level] || LEVELS.medium, seat = state.turn, moves = legalMoves(state.board, seat);
    if (moves.length === 1) return moves[0];
    if (random() < blunder) return moves[Math.floor(random() * moves.length)];
    let best = moves[0], bestValue = -Infinity;
    for (const move of moves) {
      const value = -negamax(apply(state.board, move), 1 - seat, depth - 1, -Infinity, Infinity) + random() * 3;
      if (value > bestValue) { bestValue = value; best = move; }
    }
    return best;
  }

  return { N, SIZE, at, colOf, rowOf, isDark, seatOf, isKing, newGame, legalMoves, play, chooseMove, LEVELS };
})();
