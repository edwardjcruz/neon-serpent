(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#pong-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const keys = new Set();
  const difficulties = {
    easy: { speed: 225, reaction: .2, error: 52 },
    medium: { speed: 305, reaction: .11, error: 28 },
    hard: { speed: 390, reaction: .055, error: 10 },
  };
  let difficulty = 'medium', player, cpu, ball, playerScore = 0, cpuScore = 0, rally = 0, bestRally = 0, matchScore = 0;
  let best = Number(localStorage.neonPongBest || 0), playing = false, paused = false, frame = 0, lastTime = 0, serveDelay = 0, aiClock = 0, aiTarget = 300;

  function updateStats() {
    $('#pong-player').textContent = playerScore; $('#pong-cpu').textContent = cpuScore;
    $('#pong-rally').textContent = String(rally).padStart(2, '0'); $('#pong-best').textContent = String(best).padStart(3, '0');
  }
  function serve(direction = Math.random() < .5 ? -1 : 1) {
    const angle = (Math.random() * .8 - .4), speed = 285;
    ball = { x: 300, y: 300, r: 9, vx: Math.cos(angle) * speed * direction, vy: Math.sin(angle) * speed, speed };
    rally = 0; serveDelay = .7; updateStats();
  }
  function reset() {
    player = { x: 27, y: 300, w: 14, h: 104, velocity: 0 }; cpu = { x: 573, y: 300, w: 14, h: 104 };
    playerScore = 0; cpuScore = 0; rally = 0; bestRally = 0; matchScore = 0; aiClock = 0; aiTarget = 300; serve(); updateStats(); draw();
  }
  function paddleHit(paddle, isPlayer) {
    const relative = Math.max(-1, Math.min(1, (ball.y - paddle.y) / (paddle.h / 2)));
    ball.speed = Math.min(610, ball.speed + 18); ball.vx = (isPlayer ? 1 : -1) * ball.speed * Math.cos(relative * .75); ball.vy = ball.speed * Math.sin(relative * .75);
    ball.x = paddle.x + (isPlayer ? 1 : -1) * (paddle.w / 2 + ball.r + 1); rally += 1; bestRally = Math.max(bestRally, rally); matchScore += 10; updateStats();
  }
  function finish() {
    playing = false; cancelAnimationFrame(frame); const won = playerScore >= 7;
    if (won) matchScore += 2000; matchScore += bestRally * 25;
    if (matchScore > best) localStorage.neonPongBest = best = matchScore; updateStats();
    $('#pong-title').textContent = won ? 'MATCH WON!' : 'COMPUTER WINS';
    $('#pong-message').textContent = `${playerScore}–${cpuScore} on ${difficulty}. Match score: ${matchScore}. Best rally: ${bestRally}.`;
    $('#pong-start').innerHTML = 'PLAY AGAIN <b>→</b>'; $('#pong-overlay').hidden = false; $('#pong-submit').hidden = matchScore < 1;
    window.trackGameEvent?.('game_finished', 'neon_pong', { outcome: won ? 'won' : 'lost', score: matchScore, player_points: playerScore, cpu_points: cpuScore, best_rally: bestRally, difficulty });
  }
  function point(playerWon) {
    if (playerWon) { playerScore += 1; matchScore += 500; } else cpuScore += 1;
    updateStats(); if (playerScore >= 7 || cpuScore >= 7) finish(); else serve(playerWon ? -1 : 1);
  }
  function update(delta) {
    if (serveDelay > 0) { serveDelay -= delta; return; }
    if (keys.has('up')) player.velocity = -390; else if (keys.has('down')) player.velocity = 390; else player.velocity *= .75;
    player.y = Math.max(player.h / 2, Math.min(600 - player.h / 2, player.y + player.velocity * delta));
    const ai = difficulties[difficulty]; aiClock -= delta;
    if (aiClock <= 0) { aiClock = ai.reaction; aiTarget = ball.y + (Math.random() * 2 - 1) * ai.error; }
    const aiMove = Math.max(-ai.speed * delta, Math.min(ai.speed * delta, aiTarget - cpu.y)); cpu.y = Math.max(cpu.h / 2, Math.min(600 - cpu.h / 2, cpu.y + aiMove));
    ball.x += ball.vx * delta; ball.y += ball.vy * delta;
    if (ball.y - ball.r <= 0 && ball.vy < 0) { ball.y = ball.r; ball.vy *= -1; }
    if (ball.y + ball.r >= 600 && ball.vy > 0) { ball.y = 600 - ball.r; ball.vy *= -1; }
    if (ball.vx < 0 && ball.x - ball.r <= player.x + player.w / 2 && ball.x + ball.r >= player.x - player.w / 2 && Math.abs(ball.y - player.y) <= player.h / 2 + ball.r) paddleHit(player, true);
    if (ball.vx > 0 && ball.x + ball.r >= cpu.x - cpu.w / 2 && ball.x - ball.r <= cpu.x + cpu.w / 2 && Math.abs(ball.y - cpu.y) <= cpu.h / 2 + ball.r) paddleHit(cpu, false);
    if (ball.x < -25) point(false); else if (ball.x > 625) point(true);
  }
  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, 600, 600); ctx.strokeStyle = '#ffffff20'; ctx.setLineDash([10, 12]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(300, 0); ctx.lineTo(300, 600); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#cffb4b'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 16; ctx.fillRect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);
    ctx.fillStyle = '#ff4f8c'; ctx.shadowColor = '#ff4f8c'; ctx.fillRect(cpu.x - cpu.w / 2, cpu.y - cpu.h / 2, cpu.w, cpu.h);
    ctx.fillStyle = '#f7faee'; ctx.shadowColor = '#68d8ff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (serveDelay > 0) { ctx.fillStyle = '#ffffff80'; ctx.font = '700 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('GET READY', 300, 280); }
  }
  function loop(time) { if (!playing) return; const delta = Math.min(.035, (time - lastTime) / 1000 || 0); lastTime = time; if (!paused) update(delta); draw(); frame = requestAnimationFrame(loop); }
  function start() { cancelAnimationFrame(frame); reset(); playing = true; paused = false; lastTime = performance.now(); $('#pong-pause').textContent = 'Ⅱ'; $('#pong-overlay').hidden = true; $('#pong-submit').hidden = true; window.trackGameEvent?.('game_started', 'neon_pong', { difficulty }); frame = requestAnimationFrame(loop); }
  function togglePause() { if (!playing) return; paused = !paused; $('#pong-pause').textContent = paused ? '▶' : 'Ⅱ'; lastTime = performance.now(); }
  function setPointer(event) { if (!playing) return; const rect = canvas.getBoundingClientRect(); player.y = Math.max(player.h / 2, Math.min(600 - player.h / 2, (event.clientY - rect.top) * 600 / rect.height)); }
  async function showLeaderboard() { const list = $('#pong-leaders'); if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; } try { const rows = await window.neonLeaderboard.list({ board: 'pong' }); list.innerHTML = rows.length ? rows.map((row) => `<li><b>${String(row.callsign).replace(/[^a-zA-Z0-9 _-]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO PONG CHAMPIONS YET. BE FIRST.</li>'; } catch { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; } }
  document.querySelectorAll('[data-pong-difficulty]').forEach((button) => button.addEventListener('click', () => { difficulty = button.dataset.pongDifficulty; document.querySelectorAll('[data-pong-difficulty]').forEach((item) => item.classList.toggle('active', item === button)); window.trackGameEvent?.('difficulty_selected', 'neon_pong', { difficulty }); }));
  canvas.addEventListener('pointerdown', setPointer); canvas.addEventListener('pointermove', (event) => { if (event.buttons || event.pointerType === 'touch') setPointer(event); }); $('#pong-start').addEventListener('click', start); $('#pong-pause').addEventListener('click', togglePause);
  document.querySelectorAll('[data-pong-direction]').forEach((button) => { const direction = button.dataset.pongDirection; button.addEventListener('pointerdown', (event) => { event.preventDefault(); keys.add(direction); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => button.addEventListener(name, () => keys.delete(direction))); });
  addEventListener('keydown', (event) => { if ($('#pong-game').hidden || event.target.matches('input,textarea')) return; if (['ArrowUp', 'KeyW'].includes(event.code)) { event.preventDefault(); keys.add('up'); } if (['ArrowDown', 'KeyS'].includes(event.code)) { event.preventDefault(); keys.add('down'); } if (event.code === 'KeyP') togglePause(); });
  addEventListener('keyup', (event) => { if (['ArrowUp', 'KeyW'].includes(event.code)) keys.delete('up'); if (['ArrowDown', 'KeyS'].includes(event.code)) keys.delete('down'); });
  $('#pong-upload').addEventListener('click', async () => { const callsign = $('#pong-name').value.trim(), notice = $('#pong-notice'); if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; } try { await window.neonLeaderboard.submit({ callsign, score: matchScore, board: 'pong' }); notice.textContent = 'MATCH SCORE POSTED.'; $('#pong-submit').hidden = true; showLeaderboard(); window.trackGameEvent?.('score_submitted', 'neon_pong', { score: matchScore, difficulty }); } catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; } });
  $('#pong-refresh').addEventListener('click', showLeaderboard); addEventListener('neon-leaderboard-ready', showLeaderboard); reset(); showLeaderboard();
})();
