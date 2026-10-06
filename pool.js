(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#pool-canvas');
  const E = window.NeonPoolEngine;
  if (!canvas || !E) return;
  const ctx = canvas.getContext('2d');
  const COLORS = { 1: '#ffd23f', 2: '#3d8bff', 3: '#ff4d4d', 4: '#a66bff', 5: '#ff8c42', 6: '#2fd27a', 7: '#c2415d', 8: '#0d1314' };
  const POCKETS = [[E.L, E.T, 19], [E.MID, E.T - 4, 16], [E.R, E.T, 19], [E.L, E.B, 19], [E.MID, E.B + 4, 16], [E.R, E.B, 19]];
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ROOM_TTL = 24 * 60 * 60;

  // Who this browser is in online rooms. Not a login — it only lets a player reclaim their seat after a refresh.
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
  let savedName = ''; try { savedName = localStorage.neonPoolName || ''; } catch {}

  let spin = { x: 0, y: 0 }; // where the cue tip strikes: x = right english, y = follow (+) / draw (−)
  let mode = 'local', state = E.newRack(0), angle = 0, place = null, run = null, final = null, acc = 0, lastTime = 0, frame = 0, dragging = null;
  let online = null; // { code, seat, seq, room, sub, poll, pending, sending }
  // Phones held upright get the table stood on its end so the balls are big enough to aim at.
  const portraitQuery = matchMedia('(max-width: 760px) and (orientation: portrait)');
  let portrait = false;

  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  const names = () => (mode === 'online' && online?.room ? [online.room.hostName, online.room.guestName || 'WAITING…'] : ['PLAYER 1', 'PLAYER 2']);
  const say = (text) => text.replace(/PLAYER ([12])/g, (_, seat) => names()[seat - 1]);
  const myTurn = () => mode === 'local' || (online?.room?.status !== 'waiting' && online?.seat === state.turn);
  const canShoot = () => !run && state.winner === null && myTurn() && !(mode === 'online' && (!online?.room || online.room.status === 'waiting' || online.sending));
  const power = () => Number($('#pool-power').value) / 100;
  const parse = (text) => { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; } };
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'eight_ball', { mode, ...details });

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
    state = next; resetPlacement();
    const cue = cuePosition(), target = state.balls.find((b) => b.n && !b.in);
    if (target && cue) angle = Math.atan2(target.y - cue.y, target.x - cue.x);
    render();
  }

  function render() {
    const [p1, p2] = names(), groups = state.groups;
    const label = (seat) => (groups ? `${groups[seat].toUpperCase()} · ${E.remaining(state, groups[seat])}` : 'OPEN TABLE');
    $('#pool-p1-name').textContent = p1; $('#pool-p2-name').textContent = p2;
    $('#pool-p1-group').textContent = label(0); $('#pool-p2-group').textContent = label(1);
    $('#pool-p1').classList.toggle('active', state.turn === 0 && state.winner === null);
    $('#pool-p2').classList.toggle('active', state.turn === 1 && state.winner === null);
    let status = say(state.message);
    if (mode === 'online' && online?.room) {
      if (online.room.status === 'waiting') status = `WAITING FOR AN OPPONENT — SHARE CODE ${online.code}`;
      else if (state.winner === null && !run) status = `${status} · ${myTurn() ? 'YOUR SHOT' : 'OPPONENT IS SHOOTING'}`;
    }
    $('#pool-status').textContent = status;
    $('#pool-shoot').disabled = !canShoot();
    showOverlay(); renderRoom(); draw();
  }

  function showOverlay() {
    const overlay = $('#pool-overlay'), title = $('#pool-title'), message = $('#pool-message'), start = $('#pool-start'), onlineButton = $('#pool-online-start');
    if (state.winner !== null && !run) {
      const winnerName = names()[state.winner];
      overlay.hidden = false;
      title.textContent = mode === 'online' ? (state.winner === online.seat ? 'YOU WIN!' : 'YOU LOSE') : `${winnerName} WINS`;
      message.textContent = say(state.message);
      start.innerHTML = mode === 'online' ? 'REMATCH <b>→</b>' : 'RACK AGAIN <b>→</b>'; start.hidden = false; onlineButton.hidden = mode === 'online';
    } else if (mode === 'online' && online?.room?.status === 'waiting') {
      overlay.hidden = false; title.textContent = 'ROOM OPEN'; message.textContent = `Send your opponent the invite link or room code ${online.code}. The match starts as soon as they join.`;
      start.hidden = true; onlineButton.hidden = true;
    } else if (overlay.dataset.intro === 'true') {
      overlay.hidden = false;
    } else overlay.hidden = true;
  }

  // ---------- drawing ----------
  function drawBall(b, x = b.x, y = b.y) {
    const r = E.BR;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (b.n === 0) { ctx.fillStyle = '#f7faee'; ctx.shadowColor = '#68d8ff'; ctx.shadowBlur = 12; ctx.fill(); ctx.restore(); return; }
    const color = COLORS[b.n > 8 ? b.n - 8 : b.n];
    ctx.fillStyle = E.isStripe(b.n) ? '#f7faee' : color; ctx.fill(); ctx.clip();
    if (E.isStripe(b.n)) { ctx.fillStyle = color; ctx.fillRect(x - r, y - r * .55, r * 2, r * 1.1); }
    ctx.beginPath(); ctx.arc(x, y, r * .48, 0, Math.PI * 2); ctx.fillStyle = '#f7faee'; ctx.fill();
    ctx.translate(x, y); if (portrait) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#142226'; ctx.font = '700 7px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.n, 0, .5);
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

  function draw() {
    const table = run ? run.table : state;
    // Portrait maps table (x, y) to screen (y, W − x): the break end sits at the bottom, the rack at the top.
    if (portrait) ctx.setTransform(0, -1, 1, 0, 0, E.W); else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1517'; ctx.fillRect(0, 0, E.W, E.H);
    ctx.fillStyle = '#142f33'; ctx.fillRect(E.L - 22, E.T - 22, E.R - E.L + 44, E.B - E.T + 44);
    ctx.fillStyle = '#17484a'; ctx.fillRect(E.L, E.T, E.R - E.L, E.B - E.T);
    ctx.strokeStyle = '#ffffff0d'; ctx.lineWidth = 1;
    for (let x = E.L + 30; x < E.R; x += 30) { ctx.beginPath(); ctx.moveTo(x, E.T); ctx.lineTo(x, E.B); ctx.stroke(); }
    for (let y = E.T + 30; y < E.B; y += 30) { ctx.beginPath(); ctx.moveTo(E.L, y); ctx.lineTo(E.R, y); ctx.stroke(); }
    ctx.strokeStyle = '#cffb4b'; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.strokeRect(E.L, E.T, E.R - E.L, E.B - E.T); ctx.shadowBlur = 0;
    if (table.kitchen) { ctx.strokeStyle = '#ffffff40'; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(E.HEAD_X, E.T); ctx.lineTo(E.HEAD_X, E.B); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#ffffff30'; for (const x of [E.L + 90, E.L + 180, E.L + 270, E.R - 90, E.R - 180, E.R - 270]) { ctx.fillRect(x - 1.5, E.T - 13, 3, 3); ctx.fillRect(x - 1.5, E.B + 10, 3, 3); }
    for (const [x, y, r] of POCKETS) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#050a0b'; ctx.fill(); ctx.strokeStyle = '#ff4f8c55'; ctx.lineWidth = 2; ctx.stroke(); }

    for (const b of table.balls) {
      if (b.in) continue;
      if (b.n === 0 && !run && state.ballInHand) continue;
      drawBall(b);
    }
    const cue = cuePosition();
    if (!run && state.ballInHand && place) {
      drawBall(state.balls[0], place.x, place.y);
      if (canShoot()) { ctx.beginPath(); ctx.arc(place.x, place.y, E.BR + 7, 0, Math.PI * 2); ctx.strokeStyle = '#cffb4b'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
    }
    if (!run && state.winner === null && cue && !(state.ballInHand && !place) && canShoot()) {
      const dx = Math.cos(angle), dy = Math.sin(angle), { t, hit } = traceAim(cue, dx, dy), gx = cue.x + dx * t, gy = cue.y + dy * t;
      ctx.strokeStyle = '#f7faee90'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(gx, gy, E.BR, 0, Math.PI * 2); ctx.strokeStyle = '#f7faeeaa'; ctx.stroke();
      if (hit) { const ox = hit.x - gx, oy = hit.y - gy, d = Math.hypot(ox, oy) || 1; ctx.strokeStyle = '#cffb4bcc'; ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(hit.x + ox / d * 70, hit.y + oy / d * 70); ctx.stroke(); }
      if (hit) {
        // Where the cue ball heads after contact: the part of its path the object ball doesn't take, plus follow or draw.
        const ox = hit.x - gx, oy = hit.y - gy, d = Math.hypot(ox, oy) || 1, nx = ox / d, ny = oy / d, dn = dx * nx + dy * ny;
        const speed = E.MAX_SPEED * Math.max(.05, power()), top = spin.y * E.FOLLOW * Math.exp(-E.FOLLOW_FADE * t / speed);
        const ax = dx - nx * dn + dx * top, ay = dy - ny * dn + dy * top, length = Math.min(110, Math.hypot(ax, ay) * 110);
        if (length > 4) { const a = Math.hypot(ax, ay); ctx.strokeStyle = '#ff4f8ccc'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + ax / a * length, gy + ay / a * length); ctx.stroke(); ctx.setLineDash([]); }
      }
      const back = E.BR + 6 + power() * 46;
      ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#e8c690'; ctx.beginPath(); ctx.moveTo(cue.x - dx * back, cue.y - dy * back); ctx.lineTo(cue.x - dx * (back + 250), cue.y - dy * (back + 250)); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = '#68d8ff'; ctx.beginPath(); ctx.moveTo(cue.x - dx * back, cue.y - dy * back); ctx.lineTo(cue.x - dx * (back + 8), cue.y - dy * (back + 8)); ctx.stroke(); ctx.lineCap = 'butt';
    }
    // Pocketed balls along the bottom rail, solids left and stripes right.
    const sunk = table.balls.filter((b) => b.in && b.n !== 0);
    sunk.filter((b) => b.n <= 8).forEach((b, i) => drawBall(b, 60 + i * 22, E.H - 14));
    sunk.filter((b) => b.n > 8).forEach((b, i) => drawBall(b, E.W - 60 - i * 22, E.H - 14));
  }

  // ---------- shooting ----------
  function animate(shot, after) {
    run = E.beginShot(state, shot); final = after || null; acc = 0; lastTime = performance.now();
    render(); cancelAnimationFrame(frame); frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    if (!run) return;
    acc += Math.min(.05, (time - lastTime) / 1000) * 240; lastTime = time;
    const steps = Math.floor(acc); acc -= steps;
    if (E.advance(run, steps)) {
      const done = final || E.resolve(run), wasBreak = run.before.isBreak;
      run = null; final = null; setState(done);
      if (state.winner !== null) track('game_finished', { outcome: mode === 'online' ? (state.winner === online?.seat ? 'won' : 'lost') : `player_${state.winner + 1}`, shots: state.shots });
      else if (wasBreak) track('break_shot', {});
      if (online?.pending) { const room = online.pending; online.pending = null; handleRoom(room); }
      return;
    }
    draw(); frame = requestAnimationFrame(tick);
  }

  async function shoot() {
    if (!canShoot()) return;
    const cue = cuePosition(), speed = E.MAX_SPEED * Math.max(.05, power());
    const shot = E.normalizeShot(state, { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, cueX: cue.x, cueY: cue.y, spinX: spin.x, spinY: spin.y });
    if (!shot) { $('#pool-status').textContent = 'THE CUE BALL CANNOT GO THERE.'; return; }
    if (state.isBreak) track('game_started', {});
    setSpin(0, 0);
    if (mode === 'local') { animate(shot); return; }
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
        failIf(errors); online.room = data; return data;
      } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1))); }
    }
    throw lastError;
  }
  async function fetchRoom(code) { const { data, errors } = await rooms().get({ code }); failIf(errors); return data; }

  function handleRoom(room) {
    if (!online || !room || room.code !== online.code || room.seq < online.seq) return;
    if (run) { if (!online.pending || room.seq > online.pending.seq) online.pending = room; return; }
    const wasWaiting = online.room?.status === 'waiting';
    online.room = { ...online.room, ...room };
    if (room.seq > online.seq) {
      const remote = parse(room.state), shot = parse(room.shot);
      const replay = shot && shot.seq === room.seq && room.seq === online.seq + 1 && shot.by !== online.seat;
      online.seq = room.seq;
      if (remote && replay) { const legal = E.normalizeShot(state, shot); if (legal) { animate(legal, remote); return; } }
      if (remote) setState(remote);
    }
    if (wasWaiting && room.status === 'playing') $('#pool-notice').textContent = `${clean(room.guestName)} JOINED. GOOD LUCK.`;
    render();
  }

  async function refreshRoom(force = false) {
    if (!online || (run && !force)) return;
    try { const room = await fetchRoom(online.code); if (!room) return; if (force) online.seq = Math.min(online.seq, room.seq - 1); handleRoom(room); setConnection('LIVE', true); } catch { setConnection('RECONNECTING', false); }
  }

  function enterRoom(room, seat) {
    leaveRoom(false);
    mode = 'online'; online = { code: room.code, seat, seq: room.seq, room, sub: null, poll: 0, pending: null, sending: false };
    $('#pool-overlay').dataset.intro = 'false';
    document.querySelectorAll('[data-pool-mode]').forEach((button) => button.classList.toggle('active', button.dataset.poolMode === 'online'));
    history.replaceState(null, '', inviteLink(room.code));
    try {
      online.sub = rooms().onUpdate({ filter: { code: { eq: room.code } } }).subscribe({ next: handleRoom, error: () => setConnection('POLLING', false) });
      setConnection('LIVE', true);
    } catch { setConnection('POLLING', false); }
    // Subscriptions can drop silently on mobile networks, so also check in every few seconds.
    online.poll = setInterval(() => refreshRoom(), 4000);
    setState(parse(room.state) || E.newRack(0));
  }

  function leaveRoom(toLocal = true) {
    if (online) { online.sub?.unsubscribe?.(); clearInterval(online.poll); }
    online = null; cancelAnimationFrame(frame); run = null; final = null;
    if (!toLocal) return;
    mode = 'local'; setConnection('OFFLINE', false);
    const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
    document.querySelectorAll('[data-pool-mode]').forEach((button) => button.classList.toggle('active', button.dataset.poolMode === 'local'));
    setState(E.newRack(0));
  }

  function playerName() {
    const name = clean($('#pool-name').value);
    if (name) { try { localStorage.neonPoolName = name; } catch {} }
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
    const breaker = state.winner === null ? 0 : 1 - state.winner, next = E.newRack(breaker), seq = online.seq + 1;
    online.seq = seq; online.sending = true; setState(next);
    try { await saveRoom({ seq, state: JSON.stringify(next), shot: null, status: 'playing' }); track('rematch'); } catch { await refreshRoom(true); } finally { online.sending = false; render(); }
  }

  function renderRoom() {
    const inRoom = mode === 'online' && online?.room;
    $('#pool-lobby').hidden = Boolean(inRoom); $('#pool-room').hidden = !inRoom;
    if (!inRoom) return;
    $('#pool-room-code').textContent = online.code;
    const seats = $('#pool-seats'); seats.replaceChildren();
    [[online.room.hostName, 0], [online.room.guestName, 1]].forEach(([name, seat]) => {
      const item = document.createElement('li'), who = document.createElement('b'), role = document.createElement('span');
      who.textContent = name ? clean(name) : 'OPEN SEAT';
      role.textContent = [seat === online.seat ? 'YOU' : '', state.winner === null && name && state.turn === seat && online.room.status !== 'waiting' ? 'SHOOTING' : ''].filter(Boolean).join(' · ') || (seat === 0 ? 'HOST' : 'GUEST');
      item.append(who, role); seats.append(item);
    });
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
  function aimAt(point) { const cue = cuePosition(); if (cue && (point.x !== cue.x || point.y !== cue.y)) { angle = Math.atan2(point.y - cue.y, point.x - cue.x); draw(); } }
  canvas.addEventListener('pointerdown', (event) => {
    if (!canShoot()) return;
    const point = toTable(event);
    dragging = state.ballInHand && place && Math.hypot(point.x - place.x, point.y - place.y) < E.BR * 3 ? 'cue' : 'aim';
    canvas.setPointerCapture(event.pointerId);
    if (dragging === 'aim') aimAt(point);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canShoot()) return;
    const point = toTable(event);
    if (dragging === 'cue') { if (E.canPlaceCue(state, point.x, point.y)) { place = point; draw(); } return; }
    if (dragging === 'aim' || event.pointerType === 'mouse') aimAt(point);
  });
  ['pointerup', 'pointercancel'].forEach((name) => canvas.addEventListener(name, () => { dragging = null; }));
  $('#pool-power').addEventListener('input', draw);

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
  document.querySelectorAll('[data-pool-aim]').forEach((button) => {
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

  function startLocal() { leaveRoom(true); $('#pool-overlay').dataset.intro = 'false'; setState(E.newRack(0)); }
  $('#pool-start').addEventListener('click', () => { if (mode === 'online' && online) rematch(); else startLocal(); });
  $('#pool-online-start').addEventListener('click', () => { $('#pool-overlay').dataset.intro = 'false'; render(); $('#pool-name').focus(); $('#pool-lobby').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  $('#pool-restart').addEventListener('click', () => { if (mode === 'local') startLocal(); });
  document.querySelectorAll('[data-pool-mode]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.poolMode === 'local') { if (mode !== 'local') startLocal(); return; }
    $('#pool-overlay').dataset.intro = 'false'; render(); $('#pool-name').focus();
  }));
  $('#pool-create').addEventListener('click', createRoom);
  $('#pool-join').addEventListener('click', () => joinRoom());
  $('#pool-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#pool-leave').addEventListener('click', () => { leaveRoom(true); $('#pool-notice').textContent = 'YOU LEFT THE ROOM. USE THE CODE TO REJOIN.'; });
  $('#pool-copy').addEventListener('click', async () => {
    const link = inviteLink(online.code);
    try { await navigator.clipboard.writeText(link); $('#pool-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#pool-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  });

  $('#pool-name').value = savedName;
  setConnection('OFFLINE', false);
  applyOrientation();
  setState(state);

  // Invite links (?room=CODE) open the pool tab and join straight away.
  const invited = new URLSearchParams(location.search).get('room');
  // Wait for the rest of the page's scripts so the arcade tab switcher is listening.
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="pool"]')?.click();
    $('#pool-code').value = invited.toUpperCase();
    $('#pool-overlay').dataset.intro = 'false'; render();
    const tryJoin = () => { if (rooms()) joinRoom(invited); };
    if (rooms()) tryJoin(); else { $('#pool-notice').textContent = 'CONNECTING TO YOUR INVITE…'; addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
