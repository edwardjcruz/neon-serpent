(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#tower-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const TARGET = 12, COLS = 12, PITCH = 46, CUBE = 40, ROW_HEIGHT = 36, BASE_Y = 548, OFFSET_X = 24;
  const COLORS = ['#68d8ff', '#cffb4b', '#ff4f8c', '#ffe66d', '#c77dff'];
  let rows = [], moving, score = 0, best = Number(localStorage.neonTowerBest || 0), perfects = 0;
  let playing = false, qualified = false, frame = 0, lastTime = 0, flash = 0;

  function height() { return Math.max(0, rows.length - 1); }
  function updateStats() {
    $('#tower-score').textContent = String(score).padStart(3, '0');
    $('#tower-best').textContent = String(best).padStart(3, '0');
    $('#tower-height').textContent = String(height()).padStart(2, '0');
    $('#tower-perfects').textContent = String(perfects).padStart(2, '0');
  }
  function speedForHeight(currentHeight) {
    if (currentHeight <= 5) return 3.7 + currentHeight * .22;
    if (currentHeight <= 10) return 4.8 + (currentHeight - 5) * .32;
    if (currentHeight <= 20) return 6.4 + (currentHeight - 10) * .25;
    if (currentHeight <= 30) return 8.9 + (currentHeight - 20) * .2;
    return 11;
  }
  function newMovingRow() {
    const previous = rows[rows.length - 1], startsRight = rows.length % 2 === 0, currentHeight = height();
    moving = {
      col: startsRight ? COLS - previous.cubes : 0,
      y: BASE_Y - rows.length * ROW_HEIGHT,
      cubes: previous.cubes,
      direction: startsRight ? -1 : 1,
      speed: speedForHeight(currentHeight),
      color: COLORS[rows.length % COLORS.length],
      elapsed: 0,
      fakeoutAt: currentHeight >= 21 && Math.random() < .55 ? .7 + Math.random() * .8 : Infinity,
      fakeoutDone: false,
      nextBurst: currentHeight >= 16 ? 1.1 + Math.random() * 1.2 : Infinity,
      burstUntil: 0,
    };
  }
  function reset() {
    rows = [{ col: 4, y: BASE_Y, cubes: 4, color: '#426066' }];
    score = 0; perfects = 0; qualified = false; flash = 0; newMovingRow(); updateStats(); draw();
  }
  function cameraOffset() { return Math.max(0, (height() - 11) * ROW_HEIGHT); }
  function drawCube(col, y, color) {
    const x = OFFSET_X + col * PITCH, screenY = y + cameraOffset();
    if (screenY < -ROW_HEIGHT || screenY > 600) return;
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.roundRect(x, screenY, CUBE, ROW_HEIGHT - 5, 5); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff35'; ctx.fillRect(x + 6, screenY + 5, CUBE - 12, 3);
  }
  function drawRow(row) {
    for (let cube = 0; cube < row.cubes; cube += 1) drawCube(row.col + cube, row.y, row.color);
  }
  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, 600, 600);
    ctx.strokeStyle = '#ffffff0a';
    for (let n = 0; n <= 600; n += 30) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 600); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, n); ctx.lineTo(600, n); ctx.stroke(); }
    const nextMilestone = height() < TARGET ? TARGET : (Math.floor(height() / 10) + 1) * 10;
    ctx.font = '700 11px monospace'; ctx.textAlign = 'right'; ctx.fillStyle = qualified ? '#cffb4b' : '#cffb4b90';
    ctx.fillText(qualified ? `WIN SECURED · NEXT BONUS ROW ${nextMilestone}` : 'FIRST WIN · REACH ROW 12', 582, 24);
    rows.forEach(drawRow); if (moving) drawRow(moving);
    if (flash > 0) { ctx.fillStyle = `rgba(207,251,75,${Math.min(.28, flash / 500)})`; ctx.fillRect(0, 0, 600, 600); }
  }
  function finish() {
    playing = false; cancelAnimationFrame(frame); moving = null;
    $('#tower-title').textContent = qualified ? 'ENDLESS RUN COMPLETE' : 'TOWER COLLAPSED';
    $('#tower-message').textContent = qualified ? `You won at row 12 and kept climbing to row ${height()}! Post your ${score} points.` : `You reached row ${height()} and scored ${score}. Post your run and try for row 12.`;
    $('#tower-start').innerHTML = 'BUILD AGAIN <b>→</b>'; $('#tower-overlay').hidden = false; $('#tower-submit').hidden = score < 1;
    window.trackGameEvent?.('game_finished', 'neon_tower', { outcome: qualified ? 'won' : 'lost', score, height: height(), perfects }); draw();
  }
  function place() {
    if (!playing || !moving) return;
    const previous = rows[rows.length - 1], snappedCol = Math.round(moving.col);
    const overlapStart = Math.max(snappedCol, previous.col), overlapEnd = Math.min(snappedCol + moving.cubes, previous.col + previous.cubes);
    const supportedCubes = overlapEnd - overlapStart;
    if (supportedCubes <= 0) return finish();
    const perfect = snappedCol === previous.col;
    if (perfect) { perfects += 1; score += 250 + perfects * 25; flash = 220; }
    else score += supportedCubes * 100 + height() * 25;
    rows.push({ col: overlapStart, y: moving.y, cubes: supportedCubes, color: moving.color });
    if (height() === TARGET) { qualified = true; score += 2500; flash = 700; window.trackGameEvent?.('game_won', 'neon_tower', { score, height: height(), perfects }); }
    else if (height() > TARGET && height() % 10 === 0) { score += 1000 * (height() / 10); flash = 500; window.trackGameEvent?.('height_milestone', 'neon_tower', { score, height: height() }); }
    if (score > best) localStorage.neonTowerBest = best = score;
    updateStats();
    newMovingRow();
  }
  function loop(time) {
    if (!playing) return;
    const delta = Math.min(.035, (time - lastTime) / 1000 || 0); lastTime = time;
    moving.elapsed += delta;
    if (!moving.fakeoutDone && moving.elapsed >= moving.fakeoutAt) { moving.direction *= -1; moving.fakeoutDone = true; }
    if (moving.elapsed >= moving.nextBurst) { moving.burstUntil = moving.elapsed + .36; moving.nextBurst += 1.8 + Math.random() * 1.3; }
    const burstMultiplier = moving.elapsed < moving.burstUntil ? 1.28 : 1;
    moving.col += moving.speed * burstMultiplier * moving.direction * delta;
    if (moving.col <= 0) { moving.col = 0; moving.direction = 1; }
    if (moving.col + moving.cubes >= COLS) { moving.col = COLS - moving.cubes; moving.direction = -1; }
    flash = Math.max(0, flash - delta * 1000); draw(); frame = requestAnimationFrame(loop);
  }
  function start() {
    cancelAnimationFrame(frame); reset(); playing = true; lastTime = performance.now(); $('#tower-overlay').hidden = true; $('#tower-submit').hidden = true;
    window.trackGameEvent?.('game_started', 'neon_tower'); frame = requestAnimationFrame(loop);
  }
  async function showLeaderboard() {
    const list = $('#tower-leaders');
    if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; }
    try { const data = await window.neonLeaderboard.list({ board: 'tower' }); list.innerHTML = data.length ? data.map((row) => `<li><b>${String(row.callsign).replace(/[^a-zA-Z0-9 _-]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO TOWER ELITE YET. BE FIRST.</li>'; }
    catch { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; }
  }
  canvas.addEventListener('pointerdown', place); $('#tower-drop').addEventListener('click', place); $('#tower-start').addEventListener('click', start);
  addEventListener('keydown', (event) => { if (!$('#tower-game').hidden && event.code === 'Space' && !event.target.matches('input,textarea')) { event.preventDefault(); place(); } });
  $('#tower-upload').addEventListener('click', async () => {
    const callsign = $('#tower-name').value.trim(), notice = $('#tower-notice');
    if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; }
    try { await window.neonLeaderboard.submit({ callsign, score, board: 'tower' }); notice.textContent = 'TOWER UPLOADED.'; $('#tower-submit').hidden = true; showLeaderboard(); window.trackGameEvent?.('score_submitted', 'neon_tower', { score, height: height(), perfects }); }
    catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; }
  });
  $('#tower-refresh').addEventListener('click', showLeaderboard); addEventListener('neon-leaderboard-ready', showLeaderboard);
  reset(); showLeaderboard();
})();
