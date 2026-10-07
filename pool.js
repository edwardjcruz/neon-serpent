(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const canvas = $('#pool-canvas');
  const E = window.NeonPoolEngine, AI = window.NeonPoolAI, Sound = window.NeonPoolSound;
  if (!canvas || !E) return;
  const ctx = canvas.getContext('2d');
  const COLORS = { 1: '#ffd23f', 2: '#3d8bff', 3: '#ff4d4d', 4: '#a66bff', 5: '#ff8c42', 6: '#2fd27a', 7: '#c2415d', 8: '#0d1314' };
  const POCKET_SIZES = [19, 16, 19, 19, 16, 19];
  const DRAWN_POCKETS = E.POCKETS.map(([x, y], i) => [x, y + (i === 1 ? -4 : i === 4 ? 4 : 0), POCKET_SIZES[i]]);
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ROOM_TTL = 24 * 60 * 60;
  // Public half of the push key pair; the private half is an Amplify secret used by the pool-notify function.
  const PUSH_PUBLIC_KEY = 'BOsUaj5d7uTAR2HPVaJl3fB-2Mv1eYnYP2YQ9IemQWvU2Rc-83u5_Cmo6ALXXiXksWiAyuhyE1ZFG_abMDJfs9Q';
  const REACTIONS = ['NICE SHOT!', 'UNLUCKY', 'GOOD GAME', 'REMATCH?', 'HURRY UP 😅', '🔥', '😂', '👏'];

  // Who this browser is in online rooms. Not a login — it only lets a player reclaim their seat after a refresh.
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
  const stored = (key, fallback) => { try { return localStorage[key] ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage[key] = value; } catch {} };

  let spin = { x: 0, y: 0 }; // where the cue tip strikes: x = right english, y = follow (+) / draw (−)
  let mode = 'cpu', state = E.newRack(0), angle = 0, place = null, run = null, final = null, acc = 0, lastTime = 0, frame = 0, dragging = null;
  let cpuLevel = AI?.LEVELS[stored('neonPoolCpu', 'medium')] ? stored('neonPoolCpu', 'medium') : 'medium', cpuTimer = 0, cpuAim = null;
  let call = null, callPicked = false, lastCall = null; // the pocket called for the 8; picked = chosen by tapping rather than following the aim
  let pull = null; // { power } while a touch player is pulling the stick back
  let banner = null, sinking = [], fxFrame = 0, soundIndex = 0, sinkSeen = 0, lastCounted = '';
  let online = null; // { code, seat, seq, room, sub, poll, pending, sending, reactionAt, lastReaction }
  // Phones held upright get the table stood on its end so the balls are big enough to aim at.
  const portraitQuery = matchMedia('(max-width: 760px) and (orientation: portrait)');
  const coarseQuery = matchMedia('(pointer: coarse)');
  let portrait = false;

  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  const names = () => {
    if (mode === 'online' && online?.room) return [clean(online.room.hostName), clean(online.room.guestName) || 'WAITING…'];
    if (mode === 'cpu') return ['YOU', `CPU · ${cpuLevel.toUpperCase()}`];
    return ['PLAYER 1', 'PLAYER 2'];
  };
  const say = (text) => text.replace(/PLAYER ([12])/g, (_, seat) => names()[seat - 1]);
  const mySeat = () => (mode === 'online' ? online?.seat : mode === 'cpu' ? 0 : state.turn);
  const myTurn = () => mode === 'local' || (mode === 'cpu' ? state.turn === 0 : online?.room?.status !== 'waiting' && online?.seat === state.turn);
  const canShoot = () => !run && !cpuAim && state.winner === null && myTurn() && !(mode === 'online' && (!online?.room || online.room.status === 'waiting' || online.sending));
  const sliderPower = () => Number($('#pool-power').value) / 100;
  const power = () => (pull ? pull.power : cpuAim ? cpuAim.power : sliderPower());
  const shooterOnEight = () => state.winner === null && E.onEight(state, state.turn);
  const parse = (text) => { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; } };
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'eight_ball', { mode, ...(mode === 'cpu' ? { difficulty: cpuLevel } : {}), ...details });

  // ---------- table state ----------
  function resetPlacement() {
    place = null;
    if (!state.ballInHand) return;
    const cue = state.balls[0];
    if (!cue.in && E.canPlaceCue(state, cue.x, cue.y)) { place = { x: cue.x, y: cue.y }; return; }
    for (let x = E.HEAD_X; x > E.L + E.BR; x -= 4) for (const dy of [0, 30, -30, 60, -60, 90, -90]) if (E.canPlaceCue(state, x, E.CY + dy)) { place = { x, y: E.CY + dy }; return; }
  }
  function cuePosition() { return state.ballInHand && place ? place : state.balls[0]; }
  function setState(next) {
    state = next; resetPlacement(); call = null; callPicked = false;
    const cue = cuePosition(), target = state.balls.find((b) => b.n && !b.in);
    if (target && cue) angle = Math.atan2(target.y - cue.y, target.x - cue.x);
    render(); maybeCpuTurn();
  }

  function render() {
    draw();
    const [p1, p2] = names(), groups = state.groups, match = state.match || [0, 0], showMatch = match[0] + match[1] > 0;
    const label = (seat) => (groups ? `${groups[seat].toUpperCase()} · ${E.remaining(state, groups[seat])}` : 'OPEN TABLE');
    $('#pool-p1-name').textContent = showMatch ? `${p1} (${match[0]})` : p1; $('#pool-p2-name').textContent = showMatch ? `${p2} (${match[1]})` : p2;
    $('#pool-p1-group').textContent = label(0); $('#pool-p2-group').textContent = label(1);
    $('#pool-p1').classList.toggle('active', state.turn === 0 && state.winner === null);
    $('#pool-p2').classList.toggle('active', state.turn === 1 && state.winner === null);
    let status = say(state.message);
    lastCall = call;
    if (mode === 'online' && online?.room) {
      if (online.room.status === 'waiting') status = `WAITING FOR AN OPPONENT — SHARE CODE ${online.code}`;
      else if (state.winner === null && !run) status = `${status} · ${myTurn() ? 'YOUR SHOT' : 'OPPONENT IS SHOOTING'}`;
    }
    if (mode === 'online' && !online) status = 'CREATE A PRIVATE ROOM, OR JOIN ONE WITH A CODE →';
    if (mode === 'cpu' && state.turn === 1 && state.winner === null && !run) status = `${status} · CPU IS LINING UP…`;
    if (canShoot() && shooterOnEight()) status = call === null ? 'ON THE 8 — TAP A POCKET TO CALL IT' : `ON THE 8 — POCKET CALLED${callPicked ? '' : ' FROM YOUR AIM'} · TAP ANOTHER TO CHANGE`;
    $('#pool-status').textContent = status;
    $('#pool-shoot').disabled = !canShoot();
    $('#pool-pull').classList.toggle('disabled', !canShoot());
    $$('[data-pool-mode]').forEach((button) => button.classList.toggle('active', button.dataset.poolMode === mode));
    $('#pool-levels').hidden = mode !== 'cpu';
    $$('[data-pool-level]').forEach((button) => button.classList.toggle('active', button.dataset.poolLevel === cpuLevel));
    showOverlay(); renderRoom(); renderRecord();
  }

  function showOverlay() {
    const overlay = $('#pool-overlay'), title = $('#pool-title'), message = $('#pool-message'), intro = $('#pool-intro-actions'), end = $('#pool-end-actions');
    if (state.winner !== null && !run) {
      overlay.hidden = false; intro.hidden = true; end.hidden = false;
      const won = state.winner === mySeat();
      title.textContent = mode === 'local' ? `${names()[state.winner]} WINS` : won ? 'YOU WIN!' : mode === 'cpu' ? 'CPU WINS' : 'YOU LOSE';
      const match = state.match || [0, 0];
      message.textContent = `${say(state.message)}. Match: ${names()[0]} ${match[0]} – ${match[1]} ${names()[1]}.`;
      $('#pool-again').innerHTML = mode === 'online' ? 'REMATCH <b>→</b>' : 'NEXT RACK <b>→</b>';
      $('#pool-change-mode').hidden = mode === 'online';
    } else if (mode === 'online' && online?.room?.status === 'waiting') {
      overlay.hidden = false; intro.hidden = true; end.hidden = true;
      title.textContent = 'ROOM OPEN'; message.textContent = `Send your opponent the invite link or room code ${online.code}. The match starts as soon as they join.`;
    } else if (overlay.dataset.intro === 'true') {
      overlay.hidden = false; intro.hidden = false; end.hidden = true;
      title.textContent = "RACK 'EM UP"; message.textContent = 'Sink your group, then call and sink the 8. Play the computer, a friend on this device, or open a private online room.';
    } else overlay.hidden = true;
  }

  // ---------- drawing ----------
  function drawBall(b, x = b.x, y = b.y, scale = 1) {
    const r = E.BR * scale;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (b.n === 0) { ctx.fillStyle = '#f7faee'; ctx.shadowColor = '#68d8ff'; ctx.shadowBlur = 12; ctx.fill(); ctx.restore(); return; }
    const color = COLORS[b.n > 8 ? b.n - 8 : b.n];
    ctx.fillStyle = E.isStripe(b.n) ? '#f7faee' : color; ctx.fill(); ctx.clip();
    if (E.isStripe(b.n)) { ctx.fillStyle = color; ctx.fillRect(x - r, y - r * .55, r * 2, r * 1.1); }
    ctx.beginPath(); ctx.arc(x, y, r * .48, 0, Math.PI * 2); ctx.fillStyle = '#f7faee'; ctx.fill();
    if (scale > .6) {
      ctx.translate(x, y); if (portrait) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#142226'; ctx.font = '700 7px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.n, 0, .5);
    }
    ctx.restore();
    if (b.n === 8) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = '#ff4f8c80'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Where the cue ball would first touch something, for the aim guide.
  function traceAim(from, dx, dy) {
    let best = Infinity, hit = null;
    for (const b of state.balls) {
      if (b.n === 0 || b.in) continue;
      const fx = from.x - b.x, fy = from.y - b.y, bq = fx * dx + fy * dy, disc = bq * bq - (fx * fx + fy * fy - 4 * E.BR * E.BR);
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; hit = b; }
    }
    const walls = [dx > 0 ? (E.R - E.BR - from.x) / dx : dx < 0 ? (E.L + E.BR - from.x) / dx : Infinity, dy > 0 ? (E.B - E.BR - from.y) / dy : dy < 0 ? (E.T + E.BR - from.y) / dy : Infinity];
    const wall = Math.min(...walls);
    return hit && best < wall ? { t: best, hit } : { t: wall, hit: null };
  }
  // The pocket the object ball is heading for, if the aim line points it close enough to one.
  function pocketAlong(from, ux, uy) {
    let best = null, closest = 34;
    E.POCKETS.forEach(([px, py], index) => {
      const ax = px - from.x, ay = py - from.y, along = ax * ux + ay * uy;
      if (along <= 0) return;
      const off = Math.abs(ax * uy - ay * ux);
      if (off < closest) { closest = off; best = index; }
    });
    return best;
  }

  function drawTable(table) {
    ctx.fillStyle = '#0b1517'; ctx.fillRect(0, 0, E.W, E.H);
    ctx.fillStyle = '#142f33'; ctx.fillRect(E.L - 22, E.T - 22, E.R - E.L + 44, E.B - E.T + 44);
    ctx.fillStyle = '#17484a'; ctx.fillRect(E.L, E.T, E.R - E.L, E.B - E.T);
    ctx.strokeStyle = '#ffffff0d'; ctx.lineWidth = 1;
    for (let x = E.L + 30; x < E.R; x += 30) { ctx.beginPath(); ctx.moveTo(x, E.T); ctx.lineTo(x, E.B); ctx.stroke(); }
    for (let y = E.T + 30; y < E.B; y += 30) { ctx.beginPath(); ctx.moveTo(E.L, y); ctx.lineTo(E.R, y); ctx.stroke(); }
    ctx.strokeStyle = '#cffb4b'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.strokeRect(E.L, E.T, E.R - E.L, E.B - E.T); ctx.shadowBlur = 0;
    if (table.kitchen) { ctx.strokeStyle = '#ffffff40'; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(E.HEAD_X, E.T); ctx.lineTo(E.HEAD_X, E.B); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#ffffff30'; for (const x of [E.L + 90, E.L + 180, E.L + 270, E.R - 90, E.R - 180, E.R - 270]) { ctx.fillRect(x - 1.5, E.T - 13, 3, 3); ctx.fillRect(x - 1.5, E.B + 10, 3, 3); }
    DRAWN_POCKETS.forEach(([x, y, r], index) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#050a0b'; ctx.fill();
      const called = !run && index === call && shooterOnEight();
      ctx.strokeStyle = called ? '#cffb4b' : '#ff4f8c55'; ctx.lineWidth = called ? 3 : 2; if (called) { ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 14; } ctx.stroke(); ctx.shadowBlur = 0;
      if (called) { ctx.save(); ctx.translate(x, y); if (portrait) ctx.rotate(Math.PI / 2); ctx.fillStyle = '#cffb4b'; ctx.font = '700 11px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('8', 0, 1); ctx.restore(); }
    });
  }

  function drawStick(cue, dx, dy, held) {
    const back = E.BR + 6 + power() * 46;
    ctx.lineCap = 'round'; ctx.lineWidth = held ? 8 : 6; ctx.strokeStyle = held ? '#f6dca8' : '#e8c690'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = held ? 14 : 0;
    ctx.beginPath(); ctx.moveTo(cue.x - dx * back, cue.y - dy * back); ctx.lineTo(cue.x - dx * (back + 250), cue.y - dy * (back + 250)); ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = 6; ctx.strokeStyle = '#68d8ff'; ctx.beginPath(); ctx.moveTo(cue.x - dx * back, cue.y - dy * back); ctx.lineTo(cue.x - dx * (back + 8), cue.y - dy * (back + 8)); ctx.stroke(); ctx.lineCap = 'butt';
  }

  function drawAimGuide(cue) {
    const dx = Math.cos(angle), dy = Math.sin(angle), { t, hit } = traceAim(cue, dx, dy), gx = cue.x + dx * t, gy = cue.y + dy * t;
    ctx.strokeStyle = '#f7faee90'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(gx, gy, E.BR, 0, Math.PI * 2); ctx.strokeStyle = '#f7faeeaa'; ctx.stroke();
    if (hit) {
      const ox = hit.x - gx, oy = hit.y - gy, d = Math.hypot(ox, oy) || 1, nx = ox / d, ny = oy / d;
      ctx.strokeStyle = '#cffb4bcc'; ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(hit.x + nx * 70, hit.y + ny * 70); ctx.stroke();
      // Where the cue ball heads after contact: the part of its path the object ball doesn't take, plus follow or draw.
      const dn = dx * nx + dy * ny, speed = E.MAX_SPEED * Math.max(.05, power()), top = spin.y * E.FOLLOW * Math.exp(-E.FOLLOW_FADE * t / speed);
      const ax = dx - nx * dn + dx * top, ay = dy - ny * dn + dy * top, length = Math.min(110, Math.hypot(ax, ay) * 110);
      if (length > 4) { const a = Math.hypot(ax, ay); ctx.strokeStyle = '#ff4f8ccc'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + ax / a * length, gy + ay / a * length); ctx.stroke(); ctx.setLineDash([]); }
      // On the 8, the call follows the aim until the player taps a pocket themselves.
      if (shooterOnEight() && !callPicked) call = hit.n === 8 ? pocketAlong(hit, nx, ny) : null;
    } else if (shooterOnEight() && !callPicked) call = null;
    if (call !== lastCall) queueMicrotask(render);
    drawStick(cue, dx, dy, dragging === 'stick' || Boolean(pull));
  }

  function draw() {
    const table = run ? run.table : state;
    // Portrait maps table (x, y) to screen (y, W − x): the break end sits at the bottom, the rack at the top.
    if (portrait) ctx.setTransform(0, -1, 1, 0, 0, E.W); else ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTable(table);
    for (const b of table.balls) {
      if (b.in) continue;
      if (b.n === 0 && !run && state.ballInHand) continue;
      drawBall(b);
    }
    const now = performance.now();
    sinking = sinking.filter((s) => now - s.born < 280);
    for (const s of sinking) { const k = (now - s.born) / 280; drawBall(s.ball, s.x + (s.px - s.x) * k, s.y + (s.py - s.y) * k, 1 - k * .7); }
    const cue = cuePosition();
    if (!run && state.ballInHand && place) {
      drawBall(state.balls[0], place.x, place.y);
      if (canShoot()) { ctx.beginPath(); ctx.arc(place.x, place.y, E.BR + 7, 0, Math.PI * 2); ctx.strokeStyle = '#cffb4b'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
    }
    if (!run && state.winner === null && cue && !(state.ballInHand && !place)) {
      if (canShoot()) drawAimGuide(cue);
      else if (cpuAim) drawStick(cue, Math.cos(cpuAim.angle), Math.sin(cpuAim.angle), false);
    }
    // Pocketed balls along the bottom rail, solids left and stripes right.
    const sunk = table.balls.filter((b) => b.in && b.n !== 0);
    sunk.filter((b) => b.n <= 8).forEach((b, i) => drawBall(b, 60 + i * 22, E.H - 14));
    sunk.filter((b) => b.n > 8).forEach((b, i) => drawBall(b, E.W - 60 - i * 22, E.H - 14));
    drawBanner(now);
  }

  // A short message across the middle of the table after a shot (fouls, groups, pots).
  function showBanner(text, color = '#cffb4b') { banner = { text, color, born: performance.now() }; startFx(); }
  function drawBanner(now) {
    if (!banner) return;
    const age = now - banner.born;
    if (age > 1700) { banner = null; return; }
    const alpha = age < 150 ? age / 150 : age > 1300 ? (1700 - age) / 400 : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = canvas.width, h = canvas.height, size = Math.min(30, w / 14);
    ctx.globalAlpha = alpha * .82; ctx.fillStyle = '#0b1517'; ctx.fillRect(0, h / 2 - size * 1.1, w, size * 2.2);
    ctx.globalAlpha = alpha; ctx.fillStyle = banner.color; ctx.font = `700 ${size}px "Space Grotesk", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = banner.color; ctx.shadowBlur = 12; ctx.fillText(banner.text, w / 2, h / 2 + 1); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  // Keeps redrawing while a banner or sinking ball is still animating between shots.
  function startFx() {
    if (fxFrame) return;
    const loop = () => { fxFrame = 0; if (run) return; draw(); if (banner || sinking.length) fxFrame = requestAnimationFrame(loop); };
    fxFrame = requestAnimationFrame(loop);
  }

  // ---------- shooting ----------
  function animate(shot, after) {
    run = E.beginShot(state, shot, { sounds: true }); final = after || null; acc = 0; lastTime = performance.now(); soundIndex = 0; sinkSeen = 0;
    Sound?.cue(Math.hypot(shot.vx, shot.vy) / E.MAX_SPEED);
    render(); cancelAnimationFrame(frame); frame = requestAnimationFrame(tick);
  }
  function playSounds() {
    const sfx = run.events.sfx || []; let played = 0;
    for (; soundIndex < sfx.length && sfx[soundIndex][0] <= run.steps; soundIndex += 1) {
      const [, kind, strength] = sfx[soundIndex];
      if (played > 3) continue;
      if (kind === 'click' && strength > 40) { Sound?.click(strength); played += 1; }
      if (kind === 'rail' && strength > 120) { Sound?.rail(strength); played += 1; }
      if (kind === 'pocket') { Sound?.pocket(); played += 1; }
    }
    for (; sinkSeen < run.events.pocketed.length; sinkSeen += 1) {
      const n = run.events.pocketed[sinkSeen], ball = run.table.balls.find((b) => b.n === n), [px, py] = DRAWN_POCKETS[run.events.into[n]];
      sinking.push({ ball, x: ball.x, y: ball.y, px, py, born: performance.now() });
    }
  }
  function tick(time) {
    if (!run) return;
    acc += Math.min(.05, (time - lastTime) / 1000) * 240; lastTime = time;
    const steps = Math.floor(acc); acc -= steps;
    const done = E.advance(run, steps);
    playSounds();
    if (done) {
      const before = run.before, next = final || E.resolve(run);
      run = null; final = null; setState(next); afterShot(before, next);
      if (online?.pending) { const room = online.pending; online.pending = null; handleRoom(room); }
      return;
    }
    draw(); frame = requestAnimationFrame(tick);
  }

  // Feedback once a shot settles: banner, sounds, records, and the online "your turn" alert.
  function afterShot(before, next) {
    startFx();
    if (next.winner !== null) { gameOver(); return; }
    const foul = next.message.match(/^FOUL: (.+?) —/);
    if (foul) { showBanner(`FOUL · ${foul[1]}`, '#ff4f8c'); Sound?.foul(); }
    else if (next.groups && !before.groups) showBanner(`${names()[before.turn]}: ${next.groups[before.turn].toUpperCase()}`);
    else if (next.turn === before.turn && !before.isBreak) showBanner(E.onEight(next, next.turn) ? 'ON THE 8!' : 'POTTED · SHOOT AGAIN');
    else if (before.isBreak && next.turn === before.turn) showBanner('GREAT BREAK · SHOOT AGAIN');
    if (before.isBreak) track('break_shot', {});
    if (mode === 'online' && next.turn === online.seat && before.turn !== online.seat) yourTurn('Your opponent has shot. Your turn!');
  }

  function gameOver() {
    const won = state.winner === mySeat();
    if (mode === 'local') Sound?.win(); else if (won) Sound?.win(); else Sound?.lose();
    const key = `${mode}:${online?.code || ''}:${(state.match || []).join()}:${state.shots}`;
    if (key !== lastCounted) {
      lastCounted = key;
      if (mode === 'cpu') { const record = loadRecord(); record.cpu[cpuLevel][won ? 0 : 1] += 1; saveRecord(record); }
      if (mode === 'online') { const record = loadRecord(); record.online[won ? 0 : 1] += 1; saveRecord(record); if (document.hidden) notify(won ? 'You won the rack! 🎱' : 'Your opponent won the rack.'); }
      track('game_finished', { outcome: mode === 'local' ? `player_${state.winner + 1}` : won ? 'won' : 'lost', shots: state.shots });
    }
    render();
  }

  async function shoot() {
    if (!canShoot()) return;
    if (shooterOnEight() && call === null) { $('#pool-status').textContent = 'CALL YOUR POCKET FOR THE 8 — TAP THE POCKET FIRST'; showBanner('CALL A POCKET FOR THE 8', '#ff4f8c'); return; }
    Sound?.unlock();
    const cue = cuePosition(), speed = E.MAX_SPEED * Math.max(.05, power());
    const shot = E.normalizeShot(state, { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, cueX: cue.x, cueY: cue.y, spinX: spin.x, spinY: spin.y, call: shooterOnEight() ? call : null });
    if (!shot) { $('#pool-status').textContent = 'THE CUE BALL CANNOT GO THERE.'; return; }
    if (state.isBreak) track('game_started', {});
    setSpin(0, 0);
    if (mode !== 'online') { animate(shot); return; }
    const next = E.playShot(state, shot), seq = online.seq + 1;
    online.seq = seq; online.sending = true;
    animate(shot, next);
    try {
      await saveRoom({ seq, state: JSON.stringify(next), shot: JSON.stringify({ ...shot, seq, by: online.seat }), status: next.winner === null ? 'playing' : 'finished' });
    } catch {
      $('#pool-notice').textContent = 'SHOT DID NOT SYNC. RELOADING THE TABLE…';
      await refreshRoom(true);
    } finally { online.sending = false; if (!run) render(); }
  }

  // ---------- computer opponent ----------
  function maybeCpuTurn() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || !AI || state.turn !== 1 || state.winner !== null || run || cpuAim) return;
    cpuTimer = setTimeout(cpuTurn, 700);
  }
  function cpuTurn() {
    if (mode !== 'cpu' || state.turn !== 1 || state.winner !== null || run) return;
    const { shot, plan } = AI.chooseShot(state, cpuLevel);
    if (state.ballInHand) place = { x: plan.cue.x, y: plan.cue.y };
    // Swing the stick round to the chosen line and draw it back before firing, so the player can see the shot coming.
    const from = angle, turn = Math.atan2(Math.sin(plan.dir - from), Math.cos(plan.dir - from)), started = performance.now();
    cpuAim = { angle: from, power: .05 };
    const step = (time) => {
      if (mode !== 'cpu' || !cpuAim) { cpuAim = null; return; }
      const k = Math.min(1, (time - started) / 900), ease = k < .6 ? (k / .6) * (2 - k / .6) : 1;
      cpuAim.angle = from + turn * ease; cpuAim.power = k < .6 ? .05 : .05 + (plan.power - .05) * ((k - .6) / .4);
      draw();
      if (k < 1) { requestAnimationFrame(step); return; }
      cpuAim = null; angle = plan.dir;
      const legal = E.normalizeShot(state, shot);
      if (legal) animate(legal); else { setState({ ...state }); }
    };
    requestAnimationFrame(step);
  }

  // ---------- records (this device only) ----------
  function loadRecord() {
    const blank = { cpu: { easy: [0, 0], medium: [0, 0], hard: [0, 0] }, online: [0, 0] };
    const saved = parse(stored('neonPoolRecord', '')) || {};
    return { cpu: { ...blank.cpu, ...(saved.cpu || {}) }, online: saved.online || blank.online };
  }
  function saveRecord(record) { store('neonPoolRecord', JSON.stringify(record)); }
  function renderRecord() {
    const record = loadRecord(), list = $('#pool-record'); list.replaceChildren();
    [['VS CPU · EASY', record.cpu.easy], ['VS CPU · MEDIUM', record.cpu.medium], ['VS CPU · HARD', record.cpu.hard], ['ONLINE', record.online]].forEach(([label, [w, l]]) => {
      const item = document.createElement('li'), name = document.createElement('span'), score = document.createElement('b');
      name.textContent = label; score.textContent = `${w}W – ${l}L`; item.append(name, score); list.append(item);
    });
  }

  // ---------- alerts while the tab is in the background ----------
  const baseTitle = document.title;
  let titleTimer = 0;
  function flashTitle(text) {
    clearInterval(titleTimer); let on = false;
    titleTimer = setInterval(() => { on = !on; document.title = on ? text : baseTitle; }, 900);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(titleTimer); document.title = baseTitle; } });
  function notify(body) {
    if (!document.hidden) return;
    flashTitle('🎱 ' + body.split('.')[0]);
    // With push on, the server sends the system notification; the page only flashes the title and plays a sound.
    if (!('Notification' in window) || Notification.permission !== 'granted' || online?.pushSaved) return;
    const options = { body, tag: `pool-${online?.code || 'game'}`, icon: 'pool-icon-192.png' };
    // Some phones only allow notifications through the service worker.
    navigator.serviceWorker?.getRegistration?.().then((registration) => registration ? registration.showNotification('Neon Cue', options) : new Notification('Neon Cue', options)).catch(() => { try { new Notification('Neon Cue', options); } catch {} });
  }
  function yourTurn(message) { Sound?.turn(); notify(message); }
  // iPhones only allow web push for sites added to the Home Screen and opened from there.
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function renderAlertsButton() {
    const button = $('#pool-alerts'), hint = $('#pool-alerts-hint');
    hint.hidden = true;
    if (!pushSupported) {
      button.hidden = true;
      if (isIos && !installed) { hint.hidden = false; hint.textContent = 'TURN ALERTS ON IPHONE: TAP SHARE → ADD TO HOME SCREEN, THEN OPEN NEON ARCADE FROM YOUR HOME SCREEN AND REJOIN THIS ROOM.'; }
      return;
    }
    button.hidden = false;
    const on = Notification.permission === 'granted' && online?.pushSaved;
    button.textContent = on ? '🔔 TURN ALERTS ON — WE’LL PING YOU' : Notification.permission === 'denied' ? '🔕 ALERTS BLOCKED IN BROWSER SETTINGS' : '🔔 ALERT ME WHEN IT’S MY TURN';
    button.disabled = on || Notification.permission === 'denied';
  }
  function pushKey() { const padded = PUSH_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - PUSH_PUBLIC_KEY.length % 4) % 4); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); }
  // Subscribe this browser to push and store the subscription on our seat, so pool-notify can reach us when the game is closed.
  async function savePushSubscription() {
    if (!pushSupported || Notification.permission !== 'granted' || !online?.room) return;
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey() });
      const field = online.seat === 0 ? 'hostPush' : 'guestPush', value = JSON.stringify(subscription);
      if (online.room[field] !== value) { const { errors } = await rooms().update({ code: online.code, [field]: value }); failIf(errors); online.room[field] = value; }
      online.pushSaved = true; renderAlertsButton();
    } catch (error) { $('#pool-notice').textContent = 'COULD NOT TURN ON ALERTS ON THIS BROWSER.'; console.warn('push subscribe failed', error); }
  }

  // ---------- online rooms ----------
  const client = () => window.neonDataClient;
  const rooms = () => client()?.models?.PoolRoom;
  function setConnection(text, live) { const badge = $('#pool-connection'); badge.textContent = `● ${text}`; badge.classList.toggle('offline', !live); }
  function roomCode() { const bytes = crypto.getRandomValues(new Uint8Array(5)); return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join(''); }
  function inviteLink(code) { const url = new URL(location.href); url.search = `?room=${code}`; url.hash = ''; return url.toString(); }
  function expiry() { return Math.floor(Date.now() / 1000) + ROOM_TTL; }
  function failIf(errors) { if (errors?.length) throw new Error(errors.map((error) => error.message).join(' ')); }

  async function saveRoom(fields) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { data, errors } = await rooms().update({ code: online.code, expiresAt: expiry(), ...fields });
        failIf(errors); online.room = { ...online.room, ...data }; return data;
      } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1))); }
    }
    throw lastError;
  }
  async function fetchRoom(code) { const { data, errors } = await rooms().get({ code }); failIf(errors); return data; }

  function handleReaction(room) {
    const reaction = parse(room.reaction);
    if (!reaction || !(reaction.at > online.reactionAt) || !REACTIONS.includes(reaction.text)) return;
    online.reactionAt = reaction.at;
    const fromMe = reaction.by === online.seat;
    showToast(`${fromMe ? 'YOU' : names()[reaction.by]}: ${reaction.text}`, fromMe);
    if (!fromMe) notify(`${names()[reaction.by]}: ${reaction.text}`);
  }

  function handleRoom(room) {
    if (!online || !room || room.code !== online.code || room.seq < online.seq) return;
    if (run) { if (!online.pending || room.seq >= online.pending.seq) online.pending = room; return; }
    const wasWaiting = online.room?.status === 'waiting', wasMyTurn = state.turn === online.seat;
    online.room = { ...online.room, ...room };
    handleReaction(room);
    if (room.seq > online.seq) {
      const remote = parse(room.state), shot = parse(room.shot);
      const replay = shot && shot.seq === room.seq && room.seq === online.seq + 1 && shot.by !== online.seat;
      online.seq = room.seq;
      if (remote && replay) { const legal = E.normalizeShot(state, shot); if (legal) { animate(legal, remote); return; } }
      if (remote) {
        setState(remote);
        if (remote.winner !== null) gameOver();
        else if (wasWaiting && room.status === 'playing') { $('#pool-notice').textContent = `${clean(room.guestName)} JOINED. GOOD LUCK.`; yourTurn(`${clean(room.guestName)} joined your table. Your break!`); }
        else if (remote.isBreak && remote.turn === online.seat) yourTurn('New rack — your break!');
        else if (!wasMyTurn && remote.turn === online.seat) yourTurn('Your turn!');
      }
    }
    render();
  }

  async function refreshRoom(force = false) {
    if (!online || (run && !force)) return;
    try { const room = await fetchRoom(online.code); if (!room) return; if (force) online.seq = Math.min(online.seq, room.seq - 1); handleRoom(room); setConnection('LIVE', true); } catch { setConnection('RECONNECTING', false); }
  }

  function stopCpu() { clearTimeout(cpuTimer); cpuAim = null; }
  function enterRoom(room, seat) {
    leaveRoom(false); stopCpu();
    mode = 'online';
    online = { code: room.code, seat, seq: room.seq, room, sub: null, poll: 0, pending: null, sending: false, reactionAt: parse(room.reaction)?.at || 0, lastReaction: 0 };
    $('#pool-overlay').dataset.intro = 'false';
    history.replaceState(null, '', inviteLink(room.code));
    try {
      online.sub = rooms().onUpdate({ filter: { code: { eq: room.code } } }).subscribe({ next: handleRoom, error: () => setConnection('POLLING', false) });
      setConnection('LIVE', true);
    } catch { setConnection('POLLING', false); }
    // Subscriptions can drop silently on mobile networks, so also check in every few seconds.
    online.poll = setInterval(() => refreshRoom(), 4000);
    renderAlertsButton(); savePushSubscription();
    setState(parse(room.state) || E.newRack(0));
  }

  function leaveRoom(reset = true) {
    if (online) { online.sub?.unsubscribe?.(); clearInterval(online.poll); }
    online = null; cancelAnimationFrame(frame); run = null; final = null;
    if (!reset) return;
    setConnection('OFFLINE', false);
    const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
  }

  function playerName() {
    const name = clean($('#pool-name').value);
    if (name) store('neonPoolName', name);
    return name;
  }
  function needsClient() {
    if (rooms()) return false;
    $('#pool-notice').textContent = 'CONNECTING TO THE GAME NETWORK… TRY AGAIN IN A MOMENT.';
    return true;
  }

  async function createRoom() {
    const name = playerName(), notice = $('#pool-notice');
    if (!name) { notice.textContent = 'ENTER A CALLSIGN FIRST.'; $('#pool-name').focus(); return; }
    if (needsClient()) return;
    notice.textContent = 'OPENING A PRIVATE ROOM…';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const code = roomCode();
      try {
        const { data, errors } = await rooms().create({ code, hostId: me, hostName: name, status: 'waiting', seq: 1, state: JSON.stringify(E.newRack(0)), expiresAt: expiry() });
        failIf(errors);
        notice.textContent = 'ROOM READY. SEND THE INVITE LINK.'; enterRoom(data, 0); track('room_created'); return;
      } catch { /* code taken or a network blip: try another code */ }
    }
    notice.textContent = 'COULD NOT OPEN A ROOM. CHECK YOUR CONNECTION.';
  }

  async function joinRoom(rawCode = $('#pool-code').value) {
    const code = String(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), notice = $('#pool-notice');
    if (code.length !== 5) { notice.textContent = 'ROOM CODES ARE 5 CHARACTERS.'; return; }
    if (needsClient()) return;
    notice.textContent = `LOOKING FOR ROOM ${code}…`;
    try {
      const room = await fetchRoom(code);
      if (!room) { notice.textContent = `ROOM ${code} NOT FOUND OR EXPIRED.`; return; }
      if (room.hostId === me) { notice.textContent = 'BACK IN YOUR ROOM.'; enterRoom(room, 0); return; }
      if (room.guestId === me) { notice.textContent = 'BACK IN THE MATCH.'; enterRoom(room, 1); return; }
      if (room.guestId) { notice.textContent = 'THAT ROOM ALREADY HAS TWO PLAYERS.'; return; }
      const name = playerName();
      if (!name) { notice.textContent = 'ENTER A CALLSIGN, THEN JOIN.'; $('#pool-name').focus(); return; }
      const { errors } = await rooms().update({ code, guestId: me, guestName: name, status: 'playing', seq: room.seq + 1, expiresAt: expiry() });
      failIf(errors);
      // Two people could click join at the same moment; whoever's write landed last holds the seat.
      const joined = await fetchRoom(code);
      if (joined?.guestId !== me) { notice.textContent = 'SOMEONE ELSE TOOK THAT SEAT.'; return; }
      notice.textContent = `JOINED ${clean(joined.hostName)}'S TABLE.`; enterRoom(joined, 1); track('room_joined');
    } catch { notice.textContent = 'COULD NOT REACH THE ROOM. TRY AGAIN.'; }
  }

  async function rematch() {
    if (!online || online.sending) return;
    const breaker = state.winner === null ? 0 : 1 - state.winner, next = E.newRack(breaker, state.match), seq = online.seq + 1;
    online.seq = seq; online.sending = true; setState(next);
    try { await saveRoom({ seq, state: JSON.stringify(next), shot: null, status: 'playing' }); track('rematch'); } catch { await refreshRoom(true); } finally { online.sending = false; render(); }
  }

  async function react(text) {
    if (!online?.room || Date.now() - online.lastReaction < 2500) return;
    online.lastReaction = Date.now();
    const reaction = { by: online.seat, text, at: Date.now() };
    online.reactionAt = reaction.at; showToast(`YOU: ${text}`, true);
    try { const { errors } = await rooms().update({ code: online.code, reaction: JSON.stringify(reaction) }); failIf(errors); track('reaction_sent', { reaction: text }); } catch { showToast('REACTION DID NOT SEND', true); }
  }
  let toastTimer = 0;
  function showToast(text, mine) {
    const toast = $('#pool-toast'); toast.textContent = text; toast.classList.toggle('mine', mine); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function renderRoom() {
    const inRoom = mode === 'online' && online?.room;
    $('#pool-lobby').hidden = Boolean(inRoom); $('#pool-room').hidden = !inRoom;
    if (!inRoom) return;
    $('#pool-room-code').textContent = online.code;
    $('#pool-reactions').hidden = online.room.status === 'waiting';
    const seats = $('#pool-seats'); seats.replaceChildren();
    [[online.room.hostName, 0], [online.room.guestName, 1]].forEach(([name, seat]) => {
      const item = document.createElement('li'), who = document.createElement('b'), role = document.createElement('span');
      who.textContent = name ? `${clean(name)} · ${(state.match || [0, 0])[seat]}` : 'OPEN SEAT';
      role.textContent = [seat === online.seat ? 'YOU' : '', state.winner === null && name && state.turn === seat && online.room.status !== 'waiting' ? 'SHOOTING' : ''].filter(Boolean).join(' · ') || (seat === 0 ? 'HOST' : 'GUEST');
      item.append(who, role); seats.append(item);
    });
  }

  // ---------- modes ----------
  function begin(nextMode) {
    $('#pool-overlay').dataset.intro = 'false';
    if (nextMode === 'online') { if (mode === 'online' && online) { render(); return; } leaveRoom(true); stopCpu(); mode = 'online'; state = E.newRack(0); render(); $('#pool-name').focus(); $('#pool-lobby').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    leaveRoom(true); stopCpu(); mode = nextMode; Sound?.unlock();
    setState(E.newRack(0));
    track('mode_selected', {});
  }
  function nextRack() {
    if (mode === 'online') { rematch(); return; }
    stopCpu(); Sound?.unlock();
    setState(E.newRack(state.winner === null ? 0 : 1 - state.winner, state.match));
  }

  // ---------- input ----------
  function toTable(event) {
    const rect = canvas.getBoundingClientRect(), sx = (event.clientX - rect.left) * canvas.width / rect.width, sy = (event.clientY - rect.top) * canvas.height / rect.height;
    return portrait ? { x: E.W - sy, y: sx } : { x: sx, y: sy };
  }
  function applyOrientation() {
    portrait = portraitQuery.matches;
    canvas.width = portrait ? E.H : E.W; canvas.height = portrait ? E.W : E.H;
    $('#pool-game').classList.toggle('pool-portrait', portrait);
    draw();
  }
  portraitQuery.addEventListener('change', applyOrientation);
  function applyPointerStyle() { $('.pool-controls').classList.toggle('pull-mode', coarseQuery.matches); }
  coarseQuery.addEventListener('change', applyPointerStyle);

  function aimAt(point) { const cue = cuePosition(); if (cue && (point.x !== cue.x || point.y !== cue.y)) { angle = Math.atan2(point.y - cue.y, point.x - cue.x); draw(); } }
  function pocketAt(point) { const index = DRAWN_POCKETS.findIndex(([x, y]) => Math.hypot(point.x - x, point.y - y) < 30); return index < 0 ? null : index; }
  // Touch: hold anywhere (the stick is the natural spot) and swing it around the cue ball. The aim turns by however far
  // the finger circles the ball, so it never jumps on touch-down and the finger stays behind the shot, off the aim line.
  let fingerAngle = 0, activePointer = null;
  const angleFromCue = (point) => { const cue = cuePosition(); return { angle: Math.atan2(point.y - cue.y, point.x - cue.x), distance: Math.hypot(point.x - cue.x, point.y - cue.y) }; };
  canvas.addEventListener('pointerdown', (event) => {
    if (!canShoot()) return;
    // Only the first finger steers; a second finger or a palm brushing the screen is ignored.
    if (dragging && event.pointerId !== activePointer) return;
    const point = toTable(event);
    if (shooterOnEight()) { const pocket = pocketAt(point); if (pocket !== null) { call = pocket; callPicked = true; render(); return; } }
    activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
    if (state.ballInHand && place && Math.hypot(point.x - place.x, point.y - place.y) < E.BR * 3) { dragging = 'cue'; return; }
    if (event.pointerType === 'mouse') { dragging = 'aim'; aimAt(point); return; }
    dragging = 'stick'; fingerAngle = angleFromCue(point).angle; draw();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canShoot() || (dragging && event.pointerId !== activePointer)) return;
    const point = toTable(event);
    if (dragging === 'cue') { if (E.canPlaceCue(state, point.x, point.y)) { place = point; draw(); } return; }
    if (dragging === 'stick') {
      const { angle: now, distance } = angleFromCue(point);
      // Ignore tiny moves right over the cue ball, and cap each step so one glitchy touch sample can't whip the stick.
      if (distance > E.BR * 2.5) { angle += Math.max(-.3, Math.min(.3, Math.atan2(Math.sin(now - fingerAngle), Math.cos(now - fingerAngle)))); draw(); }
      fingerAngle = now; return;
    }
    if (dragging === 'aim' || event.pointerType === 'mouse') aimAt(point);
  });
  ['pointerup', 'pointercancel'].forEach((name) => canvas.addEventListener(name, (event) => {
    if (event.pointerId !== activePointer) return;
    const wasStick = dragging === 'stick'; dragging = null; activePointer = null; if (wasStick) draw();
  }));
  $('#pool-power').addEventListener('input', draw);

  // Pull to shoot (touch): press the strip, drag back (left or down) to load power, release to fire. Slide back to cancel.
  const pullStrip = $('#pool-pull');
  let pullStart = null;
  function setPull(value) {
    pull = value === null ? null : { power: value };
    $('#pool-pull-fill').style.width = `${Math.round((value || 0) * 100)}%`;
    $('#pool-pull-label').textContent = value === null ? '◀ PULL BACK & RELEASE' : value < .05 ? 'RELEASE TO CANCEL' : `POWER ${Math.round(value * 100)}%`;
    draw();
  }
  pullStrip.addEventListener('pointerdown', (event) => {
    if (!canShoot()) return;
    event.preventDefault(); Sound?.unlock();
    pullStrip.setPointerCapture(event.pointerId); pullStart = { x: event.clientX, y: event.clientY, width: pullStrip.getBoundingClientRect().width };
    setPull(0);
  });
  pullStrip.addEventListener('pointermove', (event) => {
    if (!pullStart) return;
    const back = Math.max(pullStart.x - event.clientX, event.clientY - pullStart.y, 0);
    setPull(Math.min(1, back / Math.max(120, pullStart.width * .8)));
  });
  ['pointerup', 'pointercancel'].forEach((name) => pullStrip.addEventListener(name, (event) => {
    if (!pullStart) return;
    const strength = pull?.power || 0; pullStart = null;
    if (name === 'pointerup' && strength >= .05) { $('#pool-power').value = Math.round(strength * 100); setPull(strength); shoot().finally(() => setPull(null)); } else setPull(null);
  }));

  // Spin pad: a cue ball face you tap or drag to choose where the tip strikes. Double-tap (or press 0) re-centres it.
  const spinPad = $('#pool-spin');
  function setSpin(x, y) {
    const length = Math.hypot(x, y), scale = length > 1 ? 1 / length : 1;
    spin = { x: Math.round(x * scale * 20) / 20, y: Math.round(y * scale * 20) / 20 };
    spinPad.style.setProperty('--spin-x', spin.x); spinPad.style.setProperty('--spin-y', -spin.y);
    const side = spin.x > .05 ? 'right' : spin.x < -.05 ? 'left' : '', top = spin.y > .05 ? 'follow' : spin.y < -.05 ? 'draw' : '';
    const label = [top, side && `${side} english`].filter(Boolean).join(' + ') || 'center';
    spinPad.setAttribute('aria-label', `Cue ball spin: ${label}`); $('#pool-spin-label').textContent = [top.toUpperCase(), side === 'left' ? '←' : side === 'right' ? '→' : ''].filter(Boolean).join(' ') || 'SPIN';
    draw();
  }
  function spinFromPointer(event) { const rect = spinPad.getBoundingClientRect(), r = rect.width * .4; setSpin((event.clientX - rect.left - rect.width / 2) / r, -(event.clientY - rect.top - rect.height / 2) / r); }
  spinPad.addEventListener('pointerdown', (event) => { event.preventDefault(); spinPad.setPointerCapture(event.pointerId); spinFromPointer(event); });
  spinPad.addEventListener('pointermove', (event) => { if (spinPad.hasPointerCapture(event.pointerId)) spinFromPointer(event); });
  spinPad.addEventListener('dblclick', () => setSpin(0, 0));
  spinPad.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-.2, 0], ArrowRight: [.2, 0], ArrowUp: [0, .2], ArrowDown: [0, -.2] };
    if (moves[event.key]) { event.preventDefault(); event.stopPropagation(); setSpin(spin.x + moves[event.key][0], spin.y + moves[event.key][1]); }
    if (event.key === '0') setSpin(0, 0);
  });
  $('#pool-shoot').addEventListener('click', shoot);
  // Holding an aim button keeps turning, slowly at first for fine adjustment and then faster.
  $$('[data-pool-aim]').forEach((button) => {
    let timer = 0, held = 0;
    const turn = () => { angle += Number(button.dataset.poolAim) * (held < 12 ? .25 : held < 30 ? .6 : 1.5) * Math.PI / 180; held += 1; draw(); };
    const stop = () => { clearInterval(timer); timer = 0; };
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); stop(); held = 0; turn(); timer = setInterval(turn, 60); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => button.addEventListener(name, stop));
    button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); held = 0; turn(); } });
  });
  addEventListener('keydown', (event) => {
    if ($('#pool-game').hidden || event.target.matches('input,textarea')) return;
    const step = (event.shiftKey ? 3 : .5) * Math.PI / 180;
    if (event.code === 'ArrowLeft') { event.preventDefault(); angle -= step; draw(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); angle += step; draw(); }
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') { event.preventDefault(); const slider = $('#pool-power'); slider.value = Number(slider.value) + (event.code === 'ArrowUp' ? 5 : -5); draw(); }
    if (event.code === 'Space') { event.preventDefault(); shoot(); }
  });

  $$('[data-pool-begin]').forEach((button) => button.addEventListener('click', () => begin(button.dataset.poolBegin)));
  $$('[data-pool-mode]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.poolMode !== mode || $('#pool-overlay').dataset.intro === 'true') begin(button.dataset.poolMode); }));
  $$('[data-pool-level]').forEach((button) => button.addEventListener('click', () => { cpuLevel = button.dataset.poolLevel; store('neonPoolCpu', cpuLevel); track('difficulty_selected', {}); render(); }));
  $('#pool-again').addEventListener('click', nextRack);
  $('#pool-change-mode').addEventListener('click', () => { $('#pool-overlay').dataset.intro = 'true'; state = E.newRack(0); stopCpu(); render(); });
  $('#pool-restart').addEventListener('click', () => { if (mode !== 'online') { stopCpu(); setState(E.newRack(0, state.match)); } });
  $('#pool-mute').addEventListener('click', () => { Sound?.setMuted(!Sound.muted); renderMute(); if (!Sound?.muted) Sound?.turn(); });
  function renderMute() { const button = $('#pool-mute'); button.textContent = Sound?.muted ? '🔇' : '🔊'; button.setAttribute('aria-label', Sound?.muted ? 'Turn sound on' : 'Turn sound off'); }
  $('#pool-help-button').addEventListener('click', () => { $('#pool-help').hidden = !$('#pool-help').hidden; });
  $('#pool-help-close').addEventListener('click', () => { $('#pool-help').hidden = true; });
  $('#pool-create').addEventListener('click', createRoom);
  $('#pool-join').addEventListener('click', () => joinRoom());
  $('#pool-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#pool-leave').addEventListener('click', () => { leaveRoom(true); mode = 'online'; state = E.newRack(0); render(); $('#pool-notice').textContent = 'YOU LEFT THE ROOM. USE THE CODE TO REJOIN.'; });
  $('#pool-copy').addEventListener('click', async () => {
    const link = inviteLink(online.code);
    try { await navigator.clipboard.writeText(link); $('#pool-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#pool-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  });
  $('#pool-alerts').addEventListener('click', async () => {
    if (!('Notification' in window) || Notification.permission === 'denied') return;
    const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    track('alerts_permission', { result });
    if (result === 'granted') await savePushSubscription(); else renderAlertsButton();
  });
  const reactions = $('#pool-reactions');
  REACTIONS.forEach((text) => { const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', () => react(text)); reactions.append(button); });

  $('#pool-name').value = stored('neonPoolName', '');
  setConnection('OFFLINE', false);
  applyOrientation(); applyPointerStyle(); renderMute(); renderAlertsButton();
  setState(state);

  // Invite links (?room=CODE) open the pool tab and join straight away.
  const invited = new URLSearchParams(location.search).get('room');
  // Wait for the rest of the page's scripts so the arcade tab switcher is listening.
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="pool"]')?.click();
    $('#pool-code').value = invited.toUpperCase();
    $('#pool-overlay').dataset.intro = 'false'; mode = 'online'; render();
    const tryJoin = () => { if (rooms()) joinRoom(invited); };
    if (rooms()) tryJoin(); else { $('#pool-notice').textContent = 'CONNECTING TO YOUR INVITE…'; addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
