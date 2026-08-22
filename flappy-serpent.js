(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#flappy-canvas'), ctx = canvas.getContext('2d');
  let pilot, gates, score = 0, best = Number(localStorage.neonFlappyBest || 0), playing = false, frame, lastGate = 0, sound = true;

  function stats() {
    $('#flappy-score').textContent = String(score).padStart(3, '0');
    $('#flappy-best').textContent = String(best).padStart(3, '0');
    $('#flappy-gates').textContent = String(score / 10).padStart(2, '0');
    $('#flappy-speed').textContent = String(1 + Math.floor(score / 50)).padStart(2, '0');
  }
  function tone(frequency) { if (!sound) return; const audio = new (window.AudioContext || window.webkitAudioContext)(), oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.frequency.value = frequency; gain.gain.value = .025; oscillator.connect(gain).connect(audio.destination); oscillator.start(); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .07); oscillator.stop(audio.currentTime + .07); }
  function reset() { pilot = { x: 130, y: 300, velocity: 0, radius: 13 }; gates = []; score = 0; lastGate = 0; stats(); draw(); }
  function addGate() { const gap = Math.max(160, 215 - Math.floor(score / 50) * 8), top = 65 + Math.random() * (600 - gap - 145); gates.push({ x: 640, top, gap, passed: false }); }
  function boost() { if (!playing) return; pilot.velocity = -6.2; tone(440); }
  function draw() {
    ctx.fillStyle = '#142226'; ctx.fillRect(0, 0, 600, 600);
    ctx.strokeStyle = '#ffffff0a'; for (let n = 0; n < 600; n += 24) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 600); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, n); ctx.lineTo(600, n); ctx.stroke(); }
    gates.forEach((gate) => { ctx.fillStyle = '#68d8ff'; ctx.shadowColor = '#68d8ff'; ctx.shadowBlur = 15; ctx.fillRect(gate.x, 0, 62, gate.top); ctx.fillRect(gate.x, gate.top + gate.gap, 62, 600); });
    ctx.shadowBlur = 0; for (let tail = 4; tail >= 0; tail -= 1) { ctx.beginPath(); ctx.arc(pilot.x - tail * 12, pilot.y + Math.sin(Date.now() / 90 + tail) * 4, Math.max(7, pilot.radius - tail * 1.5), 0, Math.PI * 2); ctx.fillStyle = tail ? '#8fbd35' : '#cffb4b'; ctx.fill(); }
    ctx.fillStyle = '#142226'; ctx.beginPath(); ctx.arc(pilot.x + 5, pilot.y - 5, 3, 0, Math.PI * 2); ctx.fill();
  }
  function crash() {
    playing = false; cancelAnimationFrame(frame); tone(120);
    $('#flappy-title').textContent = 'FLIGHT TERMINATED'; $('#flappy-message').textContent = `You cleared ${score / 10} gates and scored ${score}.`;
    $('#flappy-start').innerHTML = 'FLY AGAIN <b>→</b>'; $('#flappy-overlay').hidden = false; $('#flappy-submit').hidden = score < 1;
    window.trackGameEvent?.('game_finished', 'flappy_serpent', { outcome: 'lost', score, gates: score / 10 });
  }
  function tick(time) {
    if (!playing) return;
    if (time - lastGate > Math.max(1250, 1750 - score * 2)) { addGate(); lastGate = time; }
    const speed = 2.75 + Math.floor(score / 50) * .32; pilot.velocity += .3; pilot.y += pilot.velocity;
    gates.forEach((gate) => { gate.x -= speed; if (!gate.passed && gate.x + 62 < pilot.x) { gate.passed = true; score += 10; if (score > best) localStorage.neonFlappyBest = best = score; stats(); tone(720); } });
    gates = gates.filter((gate) => gate.x > -70);
    const hit = pilot.y - pilot.radius < 0 || pilot.y + pilot.radius > 600 || gates.some((gate) => pilot.x + pilot.radius > gate.x && pilot.x - pilot.radius < gate.x + 62 && (pilot.y - pilot.radius < gate.top || pilot.y + pilot.radius > gate.top + gate.gap));
    if (hit) return crash(); draw(); frame = requestAnimationFrame(tick);
  }
  function start() { reset(); playing = true; $('#flappy-submit').hidden = true; $('#flappy-overlay').hidden = true; lastGate = performance.now(); window.trackGameEvent?.('game_started', 'flappy_serpent'); frame = requestAnimationFrame(tick); }
  async function showLeaderboard() { const list = $('#flappy-leaders'); if (!window.neonLeaderboard) { list.innerHTML = '<li class="empty">CONNECTING TO GLOBAL NETWORK…</li>'; return; } try { const rows = await window.neonLeaderboard.list({ board: 'flappy' }); list.innerHTML = rows.length ? rows.map((row) => `<li><b>${String(row.callsign).replace(/[&<>'"]/g, '')}</b><b>${row.score}</b></li>`).join('') : '<li class="empty">NO SKY PILOTS YET. BE FIRST.</li>'; } catch { list.innerHTML = '<li class="empty">LEADERBOARD TEMPORARILY OFFLINE.</li>'; } }
  canvas.addEventListener('pointerdown', boost); $('#flappy-boost').onclick = boost; $('#flappy-start').onclick = start; $('#flappy-sound').onclick = () => { sound = !sound; $('#flappy-sound').textContent = sound ? '♪' : '×'; };
  addEventListener('keydown', (event) => { if (!$('#flappy-game').hidden && event.code === 'Space' && !event.target.matches('input,textarea')) { event.preventDefault(); boost(); } });
  $('#flappy-upload').onclick = async () => { const callsign = $('#flappy-name').value.trim(), notice = $('#flappy-notice'); if (!callsign) { notice.textContent = 'ENTER A CALLSIGN.'; return; } try { await window.neonLeaderboard.submit({ callsign, score, board: 'flappy' }); notice.textContent = 'FLIGHT UPLOADED.'; $('#flappy-submit').hidden = true; showLeaderboard(); } catch { notice.textContent = 'UPLOAD FAILED. TRY AGAIN.'; } };
  $('#flappy-refresh').onclick = showLeaderboard; addEventListener('neon-leaderboard-ready', showLeaderboard); reset(); showLeaderboard();
})();
