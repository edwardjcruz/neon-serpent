// Gomoku rules and computer opponent: a 15×15 board, stones go on any empty intersection, and five or more in a row
// (any direction) wins. Pure functions so online play can check the opponent's move the same way on both screens.
globalThis.NeonGomoku = (() => {
  const N = 15, SIZE = N * N;
  const at = (col, row) => row * N + col;
  const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // Every five-cell window on the board, and the windows each cell belongs to. The computer scores positions by
  // how many of its stones (and none of the opponent's) each window holds.
  const WINDOWS = [], CELL_WINDOWS = Array.from({ length: SIZE }, () => []);
  for (let row = 0; row < N; row += 1) for (let col = 0; col < N; col += 1) for (const [dc, dr] of DIRECTIONS) {
    const cells = [0, 1, 2, 3, 4].map((i) => [col + dc * i, row + dr * i]);
    if (!cells.every(([c, r]) => c >= 0 && c < N && r >= 0 && r < N)) continue;
    const window = cells.map(([c, r]) => at(c, r));
    for (const cell of window) CELL_WINDOWS[cell].push(WINDOWS.length);
    WINDOWS.push(window);
  }

  // `board` is a 225-character string: '.' empty, '0' or '1' for each seat's stone.
  function newGame(starter = 0, match = [0, 0]) {
    return { board: '.'.repeat(SIZE), turn: starter, starter, winner: null, draw: false, line: null, moves: 0, last: null, match: [...match], message: 'PLAYER ' + (starter + 1) + ' TO PLACE' };
  }
  const canPlace = (state, index) => state.winner === null && !state.draw && Number.isInteger(index) && index >= 0 && index < SIZE && state.board[index] === '.';

  // The full run of five or more through `index`, ends first, or null.
  function winningLine(board, index) {
    const mark = board[index], col = index % N, row = Math.floor(index / N);
    for (const [dc, dr] of DIRECTIONS) {
      const run = [index];
      for (const sign of [1, -1]) for (let c = col + dc * sign, r = row + dr * sign; c >= 0 && c < N && r >= 0 && r < N && board[at(c, r)] === mark; c += dc * sign, r += dr * sign) {
        if (sign > 0) run.push(at(c, r)); else run.unshift(at(c, r));
      }
      if (run.length >= 5) return run;
    }
    return null;
  }

  // Returns the next state, or null if that intersection can't be played.
  function place(state, index) {
    if (!canPlace(state, index)) return null;
    const seat = state.turn, board = state.board.slice(0, index) + seat + state.board.slice(index + 1);
    const next = { ...state, board, moves: state.moves + 1, last: { index, seat }, match: [...(state.match || [0, 0])] };
    const line = winningLine(board, index);
    if (line) { next.winner = seat; next.line = line; next.match[seat] += 1; next.message = `PLAYER ${seat + 1} GETS FIVE IN A ROW`; return next; }
    if (!board.includes('.')) { next.draw = true; next.message = 'BOARD FULL — DRAW'; return next; }
    next.turn = 1 - seat; next.message = `PLAYER ${next.turn + 1} TO PLACE`;
    return next;
  }

  // ---------- computer opponent: window scoring + negamax with alpha-beta over the most promising moves ----------
  // Value of a window holding n of one player's stones and none of the other's.
  const WEIGHT = [0, 1, 12, 180, 4000, 1e7];
  const WIN = 1e9;
  const LEVELS = { easy: { depth: 1, beam: 5, defense: .55, blunder: .35 }, medium: { depth: 2, beam: 10, defense: 1, blunder: .05 }, hard: { depth: 8, beam: 7, defense: 1, blunder: 0 } };

  // Mutable search board: stones per cell, stone counts per window, running scores, and how many open fours each
  // seat has (a window one stone from five — the player to move with one wins next turn).
  function searchBoard(board) {
    const s = { cells: new Int8Array(SIZE).fill(-1), counts: [new Uint8Array(WINDOWS.length), new Uint8Array(WINDOWS.length)], total: [0, 0], fours: [0, 0], near: new Uint8Array(SIZE), stones: 0 };
    for (let i = 0; i < SIZE; i += 1) if (board[i] !== '.') put(s, i, Number(board[i]));
    return s;
  }
  function put(s, index, seat) {
    const mine = s.counts[seat], theirs = s.counts[1 - seat];
    let won = false;
    for (const w of CELL_WINDOWS[index]) {
      if (theirs[w] === 0) { s.total[seat] += WEIGHT[mine[w] + 1] - WEIGHT[mine[w]]; if (mine[w] === 3) s.fours[seat] += 1; else if (mine[w] === 4) { s.fours[seat] -= 1; won = true; } }
      if (mine[w] === 0) { s.total[1 - seat] -= WEIGHT[theirs[w]]; if (theirs[w] === 4) s.fours[1 - seat] -= 1; }
      mine[w] += 1;
    }
    s.cells[index] = seat; s.stones += 1; nudge(s, index, 1);
    return won;
  }
  function take(s, index, seat) {
    const mine = s.counts[seat], theirs = s.counts[1 - seat];
    for (const w of CELL_WINDOWS[index]) {
      mine[w] -= 1;
      if (theirs[w] === 0) { s.total[seat] -= WEIGHT[mine[w] + 1] - WEIGHT[mine[w]]; if (mine[w] === 3) s.fours[seat] -= 1; else if (mine[w] === 4) s.fours[seat] += 1; }
      if (mine[w] === 0) { s.total[1 - seat] += WEIGHT[theirs[w]]; if (theirs[w] === 4) s.fours[1 - seat] += 1; }
    }
    s.cells[index] = -1; s.stones -= 1; nudge(s, index, -1);
  }
  // Only cells within two of an existing stone are worth considering.
  function nudge(s, index, delta) {
    const col = index % N, row = Math.floor(index / N);
    for (let r = Math.max(0, row - 2); r <= Math.min(N - 1, row + 2); r += 1) for (let c = Math.max(0, col - 2); c <= Math.min(N - 1, col + 2); c += 1) s.near[at(c, r)] += delta;
  }
  // How much a stone here helps `seat` (attack) plus how much it spoils for the opponent (defense).
  function gain(s, index, seat, defense = 1) {
    const mine = s.counts[seat], theirs = s.counts[1 - seat];
    let attack = 0, block = 0;
    for (const w of CELL_WINDOWS[index]) {
      if (theirs[w] === 0) attack += WEIGHT[mine[w] + 1] - WEIGHT[mine[w]];
      if (mine[w] === 0) block += WEIGHT[theirs[w] + 1] - WEIGHT[theirs[w]];
    }
    return attack + block * defense;
  }
  // Cells that would complete a five for `seat`.
  function finishing(s, seat) {
    const mine = s.counts[seat], theirs = s.counts[1 - seat], cells = new Set();
    WINDOWS.forEach((window, w) => { if (mine[w] === 4 && theirs[w] === 0) for (const cell of window) if (s.cells[cell] < 0) cells.add(cell); });
    return [...cells];
  }
  function candidates(s, seat, beam, defense = 1) {
    if (s.stones === 0) return [at(7, 7)];
    // When the opponent threatens five, blocking is the only move that doesn't lose on the spot.
    if (s.fours[1 - seat] > 0) return finishing(s, 1 - seat);
    const scored = [];
    for (let i = 0; i < SIZE; i += 1) if (s.cells[i] < 0 && s.near[i]) scored.push([gain(s, i, seat, defense), i]);
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, beam).map(([, i]) => i);
  }
  function negamax(s, seat, depth, alpha, beta, beam) {
    if (s.fours[seat] > 0) return WIN + depth; // this seat completes five on its move
    if (s.stones === SIZE) return 0;
    if (depth === 0) return s.total[seat] * 1.2 - s.total[1 - seat]; // the side to move has the initiative
    let best = -Infinity;
    for (const index of candidates(s, seat, beam)) {
      // Quicker wins score higher, slower losses less badly.
      const value = put(s, index, seat) ? WIN + depth : -negamax(s, 1 - seat, depth - 1, -beta, -alpha, beam);
      take(s, index, seat);
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(state, level = 'medium', random = Math.random) {
    const { depth, beam, defense, blunder } = LEVELS[level] || LEVELS.medium, seat = state.turn, s = searchBoard(state.board);
    // Always take a five and always block one, even on Easy, so it never looks broken.
    const win = finishing(s, seat); if (win.length) return win[0];
    const block = finishing(s, 1 - seat); if (block.length) return block[0];
    const moves = candidates(s, seat, beam, defense);
    if (moves.length === 1) return moves[0];
    if (random() < blunder) return moves[Math.floor(random() * Math.min(moves.length, 4))];
    if (depth <= 1) return moves[0];
    let best = moves[0], bestValue = -Infinity;
    for (const index of moves) {
      const value = (put(s, index, seat) ? WIN : -negamax(s, 1 - seat, depth - 1, -Infinity, Infinity, beam)) + random() * 2;
      take(s, index, seat);
      if (value > bestValue) { bestValue = value; best = index; }
    }
    return best;
  }

  return { N, SIZE, at, newGame, place, canPlace, chooseMove, LEVELS };
})();
