(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#stack-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const COLS = 10, ROWS = 20, CELL = 30, OFFSET_X = 50;
  const COLORS = { I: '#68d8ff', J: '#7189ff', L: '#ff9f43', O: '#ffe66d', S: '#cffb4b', T: '#c77dff', Z: '#ff4f8c' };
  const SHAPES = {
    I: [[1, 1, 1, 1]], J: [[1, 0, 0], [1, 1, 1]], L: [[0, 0, 1], [1, 1, 1]],
    O: [[1, 1], [1, 1]], S: [[0, 1, 1], [1, 1, 0]], T: [[0, 1, 0], [1, 1, 1]], Z: [[1, 1, 0], [0, 1, 1]],
  };
  let board, piece, bag = [], score = 0, lines = 0, best = Number(localStorage.neonStackBest || 0);
  let playing = false, paused = false, frame = 0, lastDrop = 0;

  const cloneShape = (shape) => shape.map((row) => [...row]);
  const level = () => Math.floor(lines / 10) + 1;
  const dropDelay = () => Math.max(105, 820 - (level() - 1) * 65);
  function updateStats() {
    $('#stack-score').textContent = String(score).padStart(3, '0');
    $('#stack-best').textContent = String(best).padStart(3, '0');
    $('#stack-lines').textContent = String(lines).padStart(2, '0');
    $('#stack-level').textContent = String(level()).padStart(2, '0');
  }
  function refillBag() {
    bag = Object.keys(SHAPES);
    for (let i = bag.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
  function nextPiece() {
    if (!bag.length) refillBag();
    const type = bag.pop(), shape = cloneShape(SHAPES[type]);
    return { type, shape, x: Math.floor((COLS - shape[0].length) / 2), y: -1 };
  }
  function collides(target = piece, dx = 0, dy = 0, shape = target.shape) {
    return shape.some((row, y) => row.some((cell, x) => {
      if (!cell) return false;
      const bx = target.x + x + dx, by = target.y + y + dy;
      return bx < 0 || bx >= COLS || by >= ROWS || (by >= 0 && board[by][bx]);
    }));
  }
  function move(dx, dy) {
    if (!playing || paused || collides(piece, dx, dy)) return false;
    piece.x += dx; piece.y += dy; draw(); return true;
  }
  function rotate() {
    if (!playing || paused || piece.type === 'O') return;
    const rotated = piece.shape[0].map((_, x) => piece.shape.map((row) => row[x]).reverse());
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(piece, kick, 0, rotated)) { piece.x += kick; piece.shape = rotated; draw(); return; }
    }
  }
  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y -= 1) {
      if (board[y].every(Boolean)) { board.splice(y, 1); board.unshift(Array(COLS).fill(null)); cleared += 1; y += 1; }
    }
    if (cleared) { lines += cleared; score += [0, 100, 300, 500, 800][cleared] * level(); }
  }
  function lock() {
    let aboveGrid = false;
    piece.shape.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return;
      const by = piece.y + y;
      if (by < 0) aboveGrid = true; else board[by][piece.x + x] = piece.type;
    }));
    if (aboveGrid) return endGame();
    clearLines();
    if (score > best) localStorage.neonStackBest = best = score;
    updateStats(); piece = nextPiece();
    if (collides()) endGame();
  }
  function descend(manual = false) {
    if (!move(0, 1)) lock(); else if (manual) { score += 1; updateStats(); }
  }
  function hardDrop() {
    if (!playing || paused) return;
    let distance = 0;
    while (!collides(piece, 0, distance + 1)) distance += 1;
    piece.y += distance; score += distance * 2; lock(); draw();
  }
  function drawCell(x, y, color, alpha = 1) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(OFFSET_X + x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = '#ffffff30'; ctx.fillRect(OFFSET_X + x * CELL + 5, y * CELL + 5, CELL - 10, 3); ctx.globalAlpha = 1;
  }
  function drawPiece(target, yPosition = target.y, alpha = 1) {
    target.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell && yPosition + y >= 0) drawCell(target.x + x, yPosition + y, COLORS[target.type], alpha); }));
  }
  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff0a'; ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x += 1) { ctx.beginPath(); ctx.moveTo(OFFSET_X + x * CELL, 0); ctx.lineTo(OFFSET_X + x * CELL, 600); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y += 1) { ctx.beginPath(); ctx.moveTo(OFFSET_X, y * CELL); ctx.lineTo(OFFSET_X + COLS * CELL, y * CELL); ctx.stroke(); }
    board.forEach((row, y) => row.forEach((type, x) => { if (type) drawCell(x, y, COLORS[type]); }));
    if (piece) { let ghostY = piece.y; while (!collides(piece, 0, ghostY - piece.y + 1)) ghostY += 1; drawPiece(piece, ghostY, .2); drawPiece(piece); }
  }
  function loop(time) {
    if (!playing) return;
    if (!paused && time - lastDrop >= dropDelay()) { descend(); lastDrop = time; draw(); }
    frame = requestAnimationFrame(loop);
  }
  function start() {
    cancelAnimationFrame(frame); board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = []; score = 0; lines = 0; piece = nextPiece(); playing = true; paused = false; lastDrop = performance.now();
    $('#stack-overlay').hidden = true; $('#stack-submit').hidden = true; $('#stack-pause').textContent = 'Ⅱ'; updateStats(); draw();
    window.trackGameEvent?.('game_started', 'neon_stack'); frame = requestAnimationFrame(loop);
  }
  function endGame() {
    playing = false; cancelAnimationFrame(frame);
    $('#stack-title').textContent = 'STACK OVERLOAD'; $('#stack-message').textContent = `You cleared ${lines} lines and scored ${score}.`;
    $('#stack-start').innerHTML = 'STACK AGAIN <b>→</b>'; $('#stack-overlay').hidden = false; $('#stack-submit').hidden = score < 1;
    window.trackGameEvent?.('game_finished', 'neon_stack', { outcome: 'lost', score, lines, level: level() });
  }
  function togglePause() {
    if (!playing) return;
    paused = !paused; $('#stack-pause').textContent = paused ? '▶' : 'Ⅱ';
    if (!paused) lastDrop = performance.now();
  }
  function act(action) {
    if (action === 'left') move(-1, 0); else if (action === 'right') move(1, 0); else if (action === 'rotate') rotate(); else if (action === 'down') descend(true); else if (action === 'drop') hardDrop();
  }
  async function showLeaderboard() {
    const list = $('#stack-leaders');
    if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; }
    try { const rows = await window.neonLeaderboard.list({ board: 'stack' }); list.innerHTML = rows.length ? rows.map((row) => `<li><b>${String(row.callsign).replace(/[^a-zA-Z0-9 _-]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO STACK MASTERS YET. BE FIRST.</li>'; }
    catch { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; }
  }
  $('#stack-start').addEventListener('click', start); $('#stack-pause').addEventListener('click', togglePause);
  document.querySelectorAll('[data-stack-action]').forEach((button) => button.addEventListener('click', () => act(button.dataset.stackAction)));
  addEventListener('keydown', (event) => {
    if ($('#stack-game').hidden || event.target.matches('input,textarea')) return;
    const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rotate', ArrowDown: 'down', Space: 'drop' };
    if (actions[event.code]) { event.preventDefault(); act(actions[event.code]); }
    if (event.code === 'KeyP') togglePause();
  });
  $('#stack-upload').addEventListener('click', async () => {
    const callsign = $('#stack-name').value.trim(), notice = $('#stack-notice');
    if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; }
    try { await window.neonLeaderboard.submit({ callsign, score, board: 'stack' }); notice.textContent = 'STACK UPLOADED.'; $('#stack-submit').hidden = true; showLeaderboard(); window.trackGameEvent?.('score_submitted', 'neon_stack', { score, lines }); }
    catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; }
  });
  $('#stack-refresh').addEventListener('click', showLeaderboard); addEventListener('neon-leaderboard-ready', showLeaderboard);
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(null)); piece = nextPiece(); updateStats(); draw(); showLeaderboard();
})();
