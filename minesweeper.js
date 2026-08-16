(() => {
  const el = (selector) => document.querySelector(selector);
  const presets = { easy: { size: 9, mines: 10 }, medium: { size: 12, mines: 22 }, hard: { size: 16, mines: 40 } };
  let difficulty = 'easy';
  let state;
  let flagMode = false;
  let timerId;

  function formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function boardName() {
    return `mines-${difficulty}`;
  }

  function neighborIndexes(index, size) {
    const row = Math.floor(index / size), column = index % size, result = [];
    for (let y = row - 1; y <= row + 1; y += 1) for (let x = column - 1; x <= column + 1; x += 1) {
      if (x >= 0 && y >= 0 && x < size && y < size && (x !== column || y !== row)) result.push(y * size + x);
    }
    return result;
  }

  function updateTimer() {
    const seconds = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
    el('#mine-time').textContent = formatTime(seconds);
    return seconds;
  }

  function newGrid() {
    clearInterval(timerId);
    const { size, mines } = presets[difficulty];
    const cells = Array.from({ length: size * size }, (_, index) => ({ index, mine: false, revealed: false, flagged: false, count: 0 }));
    state = { cells, size, mines, flags: 0, revealed: 0, ended: false, initialized: false, startedAt: null };
    el('#mine-board').style.setProperty('--mine-grid', size);
    el('#mine-count').textContent = mines;
    el('#mine-time').textContent = '00:00';
    el('#mine-message').textContent = 'CLEAR THE GRID.';
    el('#mine-submit').hidden = true;
    el('#mine-board-label').textContent = `${difficulty.toUpperCase()} MODE`;
    render();
    showLeaderboard();
  }

  function plantMines(safeIndex) {
    const safeCells = new Set([safeIndex, ...neighborIndexes(safeIndex, state.size)]);
    let placed = 0;
    while (placed < state.mines) {
      const cell = state.cells[Math.floor(Math.random() * state.cells.length)];
      if (safeCells.has(cell.index)) continue;
      if (!cell.mine) { cell.mine = true; placed += 1; }
    }
    state.cells.forEach((cell) => {
      if (!cell.mine) cell.count = neighborIndexes(cell.index, state.size).filter((index) => state.cells[index].mine).length;
    });
    state.initialized = true;
    state.startedAt = Date.now();
    timerId = setInterval(updateTimer, 250);
  }

  function reveal(index) {
    if (state.ended || state.cells[index].flagged || state.cells[index].revealed) return;
    if (!state.initialized) plantMines(index);
    const cell = state.cells[index];
    if (cell.mine) {
      cell.revealed = true;
      state.ended = true;
      clearInterval(timerId);
      state.cells.filter((item) => item.mine).forEach((item) => { item.revealed = true; });
      el('#mine-message').textContent = 'GRID DETONATED.';
      render();
      return;
    }
    cell.revealed = true;
    state.revealed += 1;
    if (!cell.count) neighborIndexes(index, state.size).forEach(reveal);
    if (state.revealed === state.cells.length - state.mines) {
      state.ended = true;
      clearInterval(timerId);
      const seconds = updateTimer();
      state.cells.filter((item) => item.mine).forEach((item) => { item.flagged = true; });
      el('#mine-message').textContent = `GRID CLEARED IN ${formatTime(seconds)}!`;
      el('#mine-submit').hidden = false;
      el('#mine-submit').dataset.seconds = String(seconds);
    }
    render();
  }

  function flag(index) {
    const cell = state.cells[index];
    if (state.ended || cell.revealed) return;
    cell.flagged = !cell.flagged;
    state.flags += cell.flagged ? 1 : -1;
    el('#mine-count').textContent = state.mines - state.flags;
    render();
  }

  function render() {
    const board = el('#mine-board');
    board.innerHTML = '';
    state.cells.forEach((cell) => {
      const tile = document.createElement('button');
      tile.className = `mine-cell${cell.revealed ? ' revealed' : ''}${cell.flagged ? ' flagged' : ''}${cell.mine && cell.revealed ? ' mine' : ''}`;
      tile.setAttribute('role', 'gridcell');
      tile.setAttribute('aria-label', cell.revealed ? (cell.mine ? 'Mine' : cell.count ? `${cell.count} neighboring mines` : 'Empty tile') : 'Hidden tile');
      tile.textContent = cell.flagged ? '⚑' : cell.revealed ? (cell.mine ? '✹' : cell.count || '') : '';
      tile.onclick = () => (flagMode ? flag(cell.index) : reveal(cell.index));
      tile.oncontextmenu = (event) => { event.preventDefault(); flag(cell.index); };
      board.append(tile);
    });
  }

  async function showLeaderboard() {
    const list = el('#mine-leaders');
    if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; }
    list.innerHTML = '<li class="empty">SYNCING FASTEST CLEARS…</li>';
    try {
      const rows = await window.neonLeaderboard.list({ board: boardName(), sortDirection: 'ASC' });
      list.innerHTML = rows.length ? rows.map((row) => `<li><b>${row.callsign.replace(/[&<>'"]/g, '')}</b><b>${formatTime(row.score)}</b></li>`).join('') : '<li class="empty">NO CLEARS YET. SET THE PACE.</li>';
    } catch (error) { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; }
  }

  document.querySelectorAll('.arcade-tab').forEach((button) => button.addEventListener('click', () => {
    const mines = button.dataset.game === 'mines';
    el('#snake-game').hidden = mines;
    el('#minesweeper-game').hidden = !mines;
    el('#snake-leaderboard').hidden = mines;
    el('#mine-leaderboard').hidden = !mines;
    el('#arcade').classList.toggle('mine-mode', mines);
    document.querySelectorAll('.arcade-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  }));
  document.querySelectorAll('[data-difficulty]').forEach((button) => button.addEventListener('click', () => {
    difficulty = button.dataset.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach((item) => item.classList.toggle('active', item === button));
    newGrid();
  }));
  el('#mine-reset').onclick = newGrid;
  el('#flag-mode').onclick = () => {
    flagMode = !flagMode;
    el('#flag-mode').classList.toggle('active', flagMode);
    el('#flag-mode').setAttribute('aria-pressed', flagMode);
    el('#flag-mode').textContent = flagMode ? '⚑ FLAG MODE ON' : '⚑ FLAG MODE';
  };
  el('#mine-upload').onclick = async () => {
    const callsign = el('#mine-name').value.trim(), notice = el('#mine-notice'), seconds = Number(el('#mine-submit').dataset.seconds);
    if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; }
    if (!window.neonLeaderboard) { notice.textContent = 'LEADERBOARD IS STILL CONNECTING.'; return; }
    notice.textContent = 'UPLOADING CLEAR…';
    try {
      await window.neonLeaderboard.submit({ callsign, score: seconds, board: boardName() });
      notice.textContent = 'CLEAR TIME UPLOADED.';
      el('#mine-submit').hidden = true;
      showLeaderboard();
    } catch (error) { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; }
  };
  el('#mine-refresh').onclick = showLeaderboard;
  addEventListener('neon-leaderboard-ready', showLeaderboard);
  newGrid();
})();
