(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#storm-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let player, objects, score = 0, best = Number(localStorage.neonStormBest || 0), lives = 3, playing = false, paused = false;
  let frame = 0, lastTime = 0, elapsed = 0, spawnClock = 0, powerClock = 0, shield = false, slowTime = 0, invulnerable = 0;
  const keys = new Set();

  function level() { return 1 + Math.floor(elapsed / 15); }
  function updateStats() {
    $('#storm-score').textContent = String(Math.floor(score)).padStart(3, '0');
    $('#storm-best').textContent = String(best).padStart(3, '0');
    $('#storm-lives').textContent = String(lives).padStart(2, '0');
    $('#storm-level').textContent = String(level()).padStart(2, '0');
  }
  function reset() {
    player = { x: 300, y: 542, width: 54, height: 22, velocity: 0 }; objects = []; score = 0; lives = 3; elapsed = 0; spawnClock = 0; powerClock = 0; shield = false; slowTime = 0; invulnerable = 0; updateStats(); draw();
  }
  function spawnHazard() {
    const current = level(), roll = Math.random(), radius = roll > .75 ? 17 : 12 + Math.random() * 10;
    objects.push({ type: roll > .82 && current >= 3 ? 'shard' : 'meteor', x: 25 + Math.random() * 550, y: -30, r: radius, vx: roll > .82 ? (Math.random() < .5 ? -55 : 55) : (Math.random() - .5) * 18, vy: 150 + current * 24 + Math.random() * 70, near: false, rotation: Math.random() * 6 });
  }
  function spawnPower() {
    const type = Math.random() < .55 ? 'shield' : 'slow';
    objects.push({ type, x: 35 + Math.random() * 530, y: -25, r: 14, vx: 0, vy: 125, near: true, rotation: 0 });
  }
  function circleHitsPlayer(item) {
    const closestX = Math.max(player.x - player.width / 2, Math.min(item.x, player.x + player.width / 2));
    const closestY = Math.max(player.y - player.height / 2, Math.min(item.y, player.y + player.height / 2));
    return (item.x - closestX) ** 2 + (item.y - closestY) ** 2 < item.r ** 2;
  }
  function collect(item) {
    if (item.type === 'shield') shield = true; else slowTime = 5;
    score += 75; window.trackGameEvent?.('powerup_collected', 'neon_storm', { powerup: item.type, score: Math.floor(score), level: level() }); updateStats();
  }
  function hit() {
    if (shield) { shield = false; invulnerable = .5; return; }
    lives -= 1; invulnerable = 1.2; updateStats();
    if (lives <= 0) endGame();
  }
  function endGame() {
    playing = false; cancelAnimationFrame(frame); const finalScore = Math.floor(score);
    if (finalScore > best) localStorage.neonStormBest = best = finalScore; updateStats();
    $('#storm-title').textContent = 'STORM OVERRUN'; $('#storm-message').textContent = `You survived ${Math.floor(elapsed)} seconds, reached storm ${level()}, and scored ${finalScore}.`;
    $('#storm-start').innerHTML = 'DODGE AGAIN <b>→</b>'; $('#storm-overlay').hidden = false; $('#storm-submit').hidden = finalScore < 1;
    window.trackGameEvent?.('game_finished', 'neon_storm', { outcome: 'lost', score: finalScore, seconds: Math.floor(elapsed), level: level() });
  }
  function update(delta) {
    if (keys.has('left')) player.velocity = -330; else if (keys.has('right')) player.velocity = 330; else player.velocity *= .78;
    player.x = Math.max(player.width / 2, Math.min(600 - player.width / 2, player.x + player.velocity * delta));
    const previousLevel = level(); elapsed += delta; score += delta * (10 + level() * 1.5); spawnClock += delta; powerClock += delta; slowTime = Math.max(0, slowTime - delta); invulnerable = Math.max(0, invulnerable - delta);
    if (level() > previousLevel) window.trackGameEvent?.('survival_milestone', 'neon_storm', { seconds: Math.floor(elapsed), level: level(), score: Math.floor(score) });
    const interval = Math.max(.23, .78 - level() * .055);
    if (spawnClock >= interval) { spawnClock = 0; spawnHazard(); }
    if (powerClock >= 8 + Math.random() * 4) { powerClock = 0; spawnPower(); }
    const timeScale = slowTime > 0 ? .52 : 1;
    objects.forEach((item) => { item.x += item.vx * delta * timeScale; item.y += item.vy * delta * timeScale; item.rotation += delta * 3; if (item.x < item.r || item.x > 600 - item.r) item.vx *= -1; });
    objects = objects.filter((item) => {
      if (circleHitsPlayer(item)) {
        if (item.type === 'shield' || item.type === 'slow') collect(item); else if (invulnerable <= 0) hit();
        return false;
      }
      if (!item.near && item.y - item.r > player.y + player.height / 2) {
        item.near = true; if (Math.abs(item.x - player.x) < item.r + player.width / 2 + 35) { score += 25; window.trackGameEvent?.('near_miss', 'neon_storm', { score: Math.floor(score), level: level() }); }
      }
      return item.y < 640;
    });
    const currentScore = Math.floor(score); if (currentScore > best) best = currentScore; updateStats();
  }
  function drawObject(item) {
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(item.rotation); ctx.shadowBlur = 14;
    if (item.type === 'shield') { ctx.strokeStyle = '#cffb4b'; ctx.lineWidth = 5; ctx.shadowColor = '#cffb4b'; ctx.beginPath(); ctx.arc(0, 0, item.r, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#cffb4b'; ctx.font = '18px monospace'; ctx.textAlign = 'center'; ctx.fillText('◇', 0, 6); }
    else if (item.type === 'slow') { ctx.fillStyle = '#68d8ff'; ctx.shadowColor = '#68d8ff'; ctx.beginPath(); ctx.arc(0, 0, item.r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#142226'; ctx.font = '18px monospace'; ctx.textAlign = 'center'; ctx.fillText('◷', 0, 6); }
    else if (item.type === 'shard') { ctx.fillStyle = '#c77dff'; ctx.shadowColor = '#c77dff'; ctx.beginPath(); ctx.moveTo(0, -item.r); ctx.lineTo(item.r * .7, item.r); ctx.lineTo(-item.r * .7, item.r); ctx.closePath(); ctx.fill(); }
    else { ctx.fillStyle = '#ff4f8c'; ctx.shadowColor = '#ff4f8c'; ctx.beginPath(); ctx.arc(0, 0, item.r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#14222655'; ctx.beginPath(); ctx.arc(-4, -3, item.r * .28, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, 600, 600);
    ctx.strokeStyle = '#ffffff0c'; for (let x = 0; x < 600; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 70, 600); ctx.stroke(); }
    objects.forEach(drawObject); ctx.save();
    if (invulnerable > 0 && Math.floor(invulnerable * 10) % 2) ctx.globalAlpha = .3;
    ctx.fillStyle = '#cffb4b'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.roundRect(player.x - player.width / 2, player.y - player.height / 2, player.width, player.height, 7); ctx.fill();
    ctx.fillStyle = '#142226'; ctx.fillRect(player.x - 7, player.y - 5, 14, 6); if (shield) { ctx.strokeStyle = '#68d8ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(player.x, player.y, 42, Math.PI, Math.PI * 2); ctx.stroke(); } ctx.restore();
    if (slowTime > 0) { ctx.fillStyle = '#68d8ff'; ctx.font = '700 11px monospace'; ctx.fillText(`SLOW TIME ${slowTime.toFixed(1)}s`, 18, 25); }
  }
  function loop(time) { if (!playing) return; const delta = Math.min(.035, (time - lastTime) / 1000 || 0); lastTime = time; if (!paused) update(delta); draw(); frame = requestAnimationFrame(loop); }
  function start() { cancelAnimationFrame(frame); reset(); playing = true; paused = false; lastTime = performance.now(); $('#storm-pause').textContent = 'Ⅱ'; $('#storm-overlay').hidden = true; $('#storm-submit').hidden = true; window.trackGameEvent?.('game_started', 'neon_storm'); frame = requestAnimationFrame(loop); }
  function togglePause() { if (!playing) return; paused = !paused; $('#storm-pause').textContent = paused ? '▶' : 'Ⅱ'; lastTime = performance.now(); }
  function setPointer(event) { if (!playing) return; const rect = canvas.getBoundingClientRect(); player.x = Math.max(player.width / 2, Math.min(600 - player.width / 2, (event.clientX - rect.left) * 600 / rect.width)); }
  async function showLeaderboard() { const list = $('#storm-leaders'); if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; } try { const rows = await window.neonLeaderboard.list({ board: 'storm' }); list.innerHTML = rows.length ? rows.map((row) => `<li><b>${String(row.callsign).replace(/[^a-zA-Z0-9 _-]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO STORM SURVIVORS YET. BE FIRST.</li>'; } catch { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; } }
  canvas.addEventListener('pointerdown', setPointer); canvas.addEventListener('pointermove', (event) => { if (event.buttons || event.pointerType === 'touch') setPointer(event); }); $('#storm-start').addEventListener('click', start); $('#storm-pause').addEventListener('click', togglePause);
  document.querySelectorAll('[data-storm-direction]').forEach((button) => { const direction = button.dataset.stormDirection; button.addEventListener('pointerdown', (event) => { event.preventDefault(); keys.add(direction); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => button.addEventListener(name, () => keys.delete(direction))); });
  addEventListener('keydown', (event) => { if ($('#storm-game').hidden || event.target.matches('input,textarea')) return; if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); keys.add(event.code === 'ArrowLeft' ? 'left' : 'right'); } if (event.code === 'KeyP') togglePause(); });
  addEventListener('keyup', (event) => { if (event.code === 'ArrowLeft') keys.delete('left'); if (event.code === 'ArrowRight') keys.delete('right'); });
  $('#storm-upload').addEventListener('click', async () => { const callsign = $('#storm-name').value.trim(), notice = $('#storm-notice'), finalScore = Math.floor(score); if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; } try { await window.neonLeaderboard.submit({ callsign, score: finalScore, board: 'storm' }); notice.textContent = 'SURVIVAL SCORE POSTED.'; $('#storm-submit').hidden = true; showLeaderboard(); window.trackGameEvent?.('score_submitted', 'neon_storm', { score: finalScore, level: level() }); } catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; } });
  $('#storm-refresh').addEventListener('click', showLeaderboard); addEventListener('neon-leaderboard-ready', showLeaderboard); reset(); showLeaderboard();
})();
