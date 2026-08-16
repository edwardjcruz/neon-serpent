(() => {
  const el = (selector) => document.querySelector(selector);
  const canvas = el('#breakout-canvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  let score = 0, best = Number(localStorage.neonBreakoutBest || 0), lives = 3, wave = 1;
  let paddle, ball, bricks, power, playing = false, paused = false, frame;

  function updateStats() {
    el('#breakout-score').textContent = String(score).padStart(3, '0');
    el('#breakout-best').textContent = String(best).padStart(3, '0');
    el('#breakout-lives').textContent = String(lives).padStart(2, '0');
    el('#breakout-wave').textContent = String(wave).padStart(2, '0');
  }

  function makeBricks() {
    const rows = Math.min(4 + wave, 7), columns = 8, gap = 8, brickWidth = (width - 80 - gap * (columns - 1)) / columns;
    bricks = Array.from({ length: rows * columns }, (_, index) => ({
      x: 40 + (index % columns) * (brickWidth + gap), y: 56 + Math.floor(index / columns) * 31,
      width: brickWidth, height: 21, alive: true, color: ['#cffb4b', '#68d8ff', '#ff4f8c'][Math.floor(index / columns) % 3],
    }));
  }

  function resetBall() {
    paddle = { x: width / 2 - 58, y: height - 42, width: 116, height: 13, boostUntil: 0 };
    ball = { x: width / 2, y: height - 60, radius: 7, dx: wave % 2 ? 4 : -4, dy: -4.8 - wave * 0.3 };
    power = null;
  }

  function resetRun() {
    score = 0; lives = 3; wave = 1; makeBricks(); resetBall(); updateStats(); draw();
  }

  function movePaddle(direction) {
    if (!playing || paused) return;
    paddle.x = Math.max(14, Math.min(width - paddle.width - 14, paddle.x + direction * 36));
  }

  function collision(rect, point) {
    return point.x + point.radius > rect.x && point.x - point.radius < rect.x + rect.width && point.y + point.radius > rect.y && point.y - point.radius < rect.y + rect.height;
  }

  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
    for (let grid = 0; grid < width; grid += 24) { ctx.beginPath(); ctx.moveTo(grid, 0); ctx.lineTo(grid, height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, grid); ctx.lineTo(width, grid); ctx.stroke(); }
    bricks.forEach((brick) => { if (brick.alive) { ctx.fillStyle = brick.color; ctx.shadowColor = brick.color; ctx.shadowBlur = 12; ctx.fillRect(brick.x, brick.y, brick.width, brick.height); } });
    ctx.shadowBlur = 0;
    if (power) { ctx.fillStyle = '#f6f9ed'; ctx.fillRect(power.x - 8, power.y - 8, 16, 16); ctx.fillStyle = '#142226'; ctx.font = '16px sans-serif'; ctx.fillText('+', power.x - 5, power.y + 6); }
    ctx.fillStyle = '#cffb4b'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 18; ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = '#f6f9ed'; ctx.shadowColor = '#f6f9ed'; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0;
  }

  function endRun() {
    playing = false; cancelAnimationFrame(frame);
    el('#breakout-title').textContent = 'RUN TERMINATED';
    el('#breakout-message').textContent = `Impact score: ${score}. Your personal best is ${best}.`;
    el('#breakout-start').innerHTML = 'RUN AGAIN <b>→</b>';
    el('#breakout-overlay').hidden = false;
    if (score) el('#breakout-submit').hidden = false;
  }

  function tick() {
    if (!playing || paused) return;
    ball.x += ball.dx; ball.y += ball.dy;
    if (ball.x + ball.radius > width || ball.x - ball.radius < 0) ball.dx *= -1;
    if (ball.y - ball.radius < 0) ball.dy *= -1;
    if (collision(paddle, ball) && ball.dy > 0) {
      const angle = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
      ball.dx = angle * 6.2; ball.dy = -Math.max(4.8, Math.abs(ball.dy)); ball.y = paddle.y - ball.radius - 1;
    }
    bricks.forEach((brick) => {
      if (!brick.alive || !collision(brick, ball)) return;
      brick.alive = false; ball.dy *= -1; score += 10;
      if (score > best) localStorage.neonBreakoutBest = best = score;
      if (!power && Math.random() < 0.13) power = { x: brick.x + brick.width / 2, y: brick.y + brick.height / 2 };
      updateStats();
    });
    if (power) { power.y += 2.3; if (power.y > paddle.y && power.x > paddle.x && power.x < paddle.x + paddle.width) { paddle.width = 168; paddle.boostUntil = Date.now() + 7000; power = null; } else if (power.y > height) power = null; }
    if (paddle.boostUntil && Date.now() > paddle.boostUntil) { paddle.width = 116; paddle.boostUntil = 0; }
    if (ball.y - ball.radius > height) { lives -= 1; updateStats(); if (!lives) return endRun(); resetBall(); }
    if (!bricks.some((brick) => brick.alive)) { wave += 1; makeBricks(); resetBall(); updateStats(); }
    draw(); frame = requestAnimationFrame(tick);
  }

  function start() {
    resetRun(); playing = true; paused = false; el('#breakout-submit').hidden = true; el('#breakout-overlay').hidden = true; frame = requestAnimationFrame(tick);
  }

  function showLeaderboard() {
    const list = el('#breakout-leaders');
    if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; }
    list.innerHTML = '<li class="empty">SYNCING LEADERBOARD…</li>';
    window.neonLeaderboard.list({ board: 'breakout' }).then((rows) => { list.innerHTML = rows.length ? rows.map((row) => `<li><b>${row.callsign.replace(/[&<>'"]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO IMPACT RUNS YET. BE FIRST.</li>'; }).catch(() => { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; });
  }

  document.querySelectorAll('.arcade-tab').forEach((button) => button.addEventListener('click', () => {
    const breakout = button.dataset.game === 'breakout';
    if (!breakout) return;
    el('#snake-game').hidden = true; el('#minesweeper-game').hidden = true; el('#breakout-game').hidden = false;
    el('#snake-leaderboard').hidden = true; el('#mine-leaderboard').hidden = true; el('#breakout-leaderboard').hidden = false;
    el('#arcade').classList.remove('mine-mode');
    document.querySelectorAll('.arcade-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    showLeaderboard();
  }));
  document.querySelectorAll('[data-breakout-direction]').forEach((button) => button.addEventListener('click', () => movePaddle(button.dataset.breakoutDirection === 'left' ? -1 : 1)));
  el('#breakout-start').onclick = start;
  el('#breakout-launch').onclick = () => { if (!playing) start(); };
  el('#breakout-pause').onclick = () => { if (!playing) return; paused = !paused; el('#breakout-pause').textContent = paused ? '▶' : 'Ⅱ'; if (!paused) { frame = requestAnimationFrame(tick); } };
  addEventListener('keydown', (event) => { if (el('#breakout-game').hidden) return; if (event.key === 'ArrowLeft') { event.preventDefault(); movePaddle(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); movePaddle(1); } });
  canvas.addEventListener('pointermove', (event) => { if (!playing || paused) return; const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * (width / rect.width); paddle.x = Math.max(14, Math.min(width - paddle.width - 14, x - paddle.width / 2)); });
  el('#breakout-upload').onclick = async () => {
    const callsign = el('#breakout-name').value.trim(), notice = el('#breakout-notice');
    if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; }
    if (!window.neonLeaderboard) { notice.textContent = 'LEADERBOARD IS STILL CONNECTING.'; return; }
    notice.textContent = 'UPLOADING RUN…';
    try { await window.neonLeaderboard.submit({ callsign, score, board: 'breakout' }); notice.textContent = 'RUN UPLOADED.'; el('#breakout-submit').hidden = true; showLeaderboard(); } catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; }
  };
  el('#breakout-refresh').onclick = showLeaderboard;
  addEventListener('neon-leaderboard-ready', showLeaderboard);
  resetRun();
})();
