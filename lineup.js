(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const canvas = $('#lu-canvas');
  const G = window.NeonLineUp, Sound = window.NeonPoolSound, Rivals = window.NeonRivals;
  if (!canvas || !G) return;
  const ctx = canvas.getContext('2d');
  const W = 700, H = 660, CELL = 92, X0 = (W - G.COLS * CELL) / 2, Y0 = 92, R = 36;
  const COLORS = ['#cffb4b', '#ff4f8c'];
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', ROOM_TTL = 24 * 60 * 60;
  const REACTIONS = ['NICE MOVE!', 'UNLUCKY', 'GOOD GAME', 'REMATCH?', 'HURRY UP 😅', '🔥', '😂', '👏'];

  // Same browser player id as the pool rooms, so rivals line up across games.
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
  const stored = (key, fallback) => { try { return localStorage[key] ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage[key] = value; } catch {} };

  let mode = 'cpu', state = G.newGame(0), level = G.LEVELS[stored('neonLineUpCpu', 'medium')] ? stored('neonLineUpCpu', 'medium') : 'medium';
  let revealAt = 0; // the result screen waits a moment so the winning line can be seen
  let hover = 3, anim = null, cpuTimer = 0, lastCounted = '', online = null; // online: { code, seat, seq, room, sub, poll, pending, sending, reactionAt, lastReaction, invitee }

  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  const names = () => {
    if (mode === 'online' && online?.room) return [clean(online.room.hostName), clean(online.room.guestName) || 'WAITING…'];
    if (mode === 'cpu') return ['YOU', `CPU · ${level.toUpperCase()}`];
    return ['PLAYER 1', 'PLAYER 2'];
  };
  const say = (text) => text.replace(/PLAYER ([12])/g, (_, seat) => names()[seat - 1]);
  const mySeat = () => (mode === 'online' ? online?.seat : mode === 'cpu' ? 0 : state.turn);
  const over = () => state.winner !== null || state.draw;
  const myTurn = () => mode === 'local' || (mode === 'cpu' ? state.turn === 0 : online?.room?.status === 'playing' && online.seat === state.turn);
  const canMove = () => !anim && !over() && myTurn() && !(mode === 'online' && (!online?.room || online.sending));
  const parse = (text) => { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; } };
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'line_up', { mode, ...(mode === 'cpu' ? { difficulty: level } : {}), ...details });

  // ---------- rendering ----------
  const cellCenter = (col, row) => ({ x: X0 + col * CELL + CELL / 2, y: Y0 + (G.ROWS - 1 - row) * CELL + CELL / 2 });
  function disc(x, y, seat, alpha = 1) {
    ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[seat]; ctx.shadowColor = COLORS[seat]; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x, y, R * .62, 0, Math.PI * 2); ctx.strokeStyle = '#0b151744'; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
  }
  function draw() {
    ctx.fillStyle = '#0b1517'; ctx.fillRect(0, 0, W, H);
    // a falling disc sits behind the board face, so draw it first
    if (anim) disc(anim.x, anim.y, anim.seat);
    // board face with holes punched out
    ctx.save(); ctx.beginPath(); ctx.rect(X0 - 10, Y0 - 10, G.COLS * CELL + 20, G.ROWS * CELL + 20);
    for (let col = 0; col < G.COLS; col += 1) for (let row = 0; row < G.ROWS; row += 1) { const { x, y } = cellCenter(col, row); ctx.moveTo(x + R + 3, y); ctx.arc(x, y, R + 3, 0, Math.PI * 2, true); }
    ctx.fillStyle = '#17484a'; ctx.fill('evenodd'); ctx.restore();
    ctx.strokeStyle = '#cffb4b'; ctx.lineWidth = 2; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 10; ctx.strokeRect(X0 - 10, Y0 - 10, G.COLS * CELL + 20, G.ROWS * CELL + 20); ctx.shadowBlur = 0;
    for (let col = 0; col < G.COLS; col += 1) for (let row = 0; row < G.ROWS; row += 1) {
      const value = state.board[G.at(col, row)], { x, y } = cellCenter(col, row);
      if (value !== '.' && !(anim && anim.col === col && anim.row === row)) disc(x, y, Number(value));
    }
    if (state.line && !anim) {
      const pulse = .55 + .45 * Math.sin(performance.now() / 180), cells = state.line.map((index) => cellCenter(index % G.COLS, Math.floor(index / G.COLS)));
      ctx.strokeStyle = '#f7faee'; ctx.lineWidth = 6; ctx.globalAlpha = pulse; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cells[0].x, cells[0].y); ctx.lineTo(cells[3].x, cells[3].y); ctx.stroke();
      for (const { x, y } of cells) { ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    // the disc waiting above the column you're pointing at
    if (canMove() && G.canDrop(state, hover)) {
      const { x } = cellCenter(hover, 0);
      disc(x, Y0 / 2, state.turn, .9);
      ctx.fillStyle = COLORS[state.turn] + '22'; ctx.fillRect(X0 + hover * CELL, Y0 - 10, CELL, G.ROWS * CELL + 20);
    }
  }
  // the winning line keeps pulsing until the next game starts
  (function idle() { if (state.line && !anim && !$('#lineup-game').hidden) draw(); requestAnimationFrame(idle); })();

  function render() {
    draw();
    const [p1, p2] = names(), match = state.match || [0, 0];
    $('#lu-p1-name').textContent = p1; $('#lu-p2-name').textContent = p2;
    $('#lu-p1-info').textContent = `${match[0]} WON`; $('#lu-p2-info').textContent = `${match[1]} WON`;
    $('#lu-p1').classList.toggle('active', !over() && state.turn === 0); $('#lu-p2').classList.toggle('active', !over() && state.turn === 1);
    let status = say(state.message);
    if (mode === 'online' && !online) status = 'CREATE A PRIVATE ROOM, OR JOIN ONE WITH A CODE →';
    else if (mode === 'online' && online.room.status === 'waiting') status = `WAITING FOR AN OPPONENT — SHARE CODE ${online.code}`;
    else if (mode === 'online' && !over()) status += myTurn() ? ' · YOUR MOVE' : ' · OPPONENT IS THINKING';
    if (mode === 'cpu' && state.turn === 1 && !over()) status += ' · CPU IS THINKING…';
    $('#lu-status').textContent = status;
    $$('[data-lu-mode]').forEach((button) => button.classList.toggle('active', button.dataset.luMode === mode));
    $('#lu-levels').hidden = mode !== 'cpu';
    $$('[data-lu-level]').forEach((button) => button.classList.toggle('active', button.dataset.luLevel === level));
    $('#lu-restart').hidden = mode === 'online';
    showOverlay(); renderRoom(); renderRecord();
  }

  function showOverlay() {
    const overlay = $('#lu-overlay'), title = $('#lu-title'), message = $('#lu-message');
    $('#lu-intro-actions').hidden = true; $('#lu-end-actions').hidden = true; $('#lu-wait-actions').hidden = true;
    if (over() && !anim && performance.now() < revealAt) { overlay.hidden = true; return; }
    if (over() && !anim) {
      $('#lu-eyebrow').textContent = state.draw ? 'NO LINE OF FOUR' : 'GAME OVER';
      overlay.hidden = false; $('#lu-end-actions').hidden = false;
      const won = state.winner === mySeat(), match = state.match || [0, 0];
      title.textContent = state.draw ? 'DRAW' : mode === 'local' ? `${names()[state.winner]} WINS` : won ? 'YOU WIN!' : mode === 'cpu' ? 'CPU WINS' : 'YOU LOSE';
      message.textContent = `${state.draw ? 'The board filled up with no line of four.' : 'Four in a row.'} Match: ${names()[0]} ${match[0]} – ${match[1]} ${names()[1]}.`;
      $('#lu-again').innerHTML = mode === 'online' ? 'REMATCH <b>→</b>' : 'NEXT GAME <b>→</b>';
      $('#lu-change-mode').hidden = mode === 'online';
    } else if (mode === 'online' && online?.room.status === 'waiting') {
      overlay.hidden = false; $('#lu-wait-actions').hidden = false; $('#lu-eyebrow').textContent = 'WAITING FOR A PLAYER';
      title.textContent = online.invitee ? `REMATCH VS ${online.invitee}` : 'ROOM OPEN';
      message.textContent = `Send ${online.invitee || 'your opponent'} the invite link or room code ${online.code}. The game starts as soon as they join.`;
    } else if (overlay.dataset.intro === 'true') {
      overlay.hidden = false; $('#lu-intro-actions').hidden = false; $('#lu-eyebrow').textContent = 'THE GRID IS EMPTY';
      title.textContent = 'LINE UP'; message.textContent = 'Drop discs into the grid. First to line up four in a row — across, up, or diagonally — wins.';
    } else overlay.hidden = true;
  }

  // ---------- moves ----------
  // Drop a disc with a little gravity and bounce, then apply the move.
  function animateDrop(col, next, after) {
    const row = G.landingRow(state.board, col), target = cellCenter(col, row), seat = state.turn;
    anim = { col, row, seat, x: target.x, y: Y0 / 2, vy: 0, target: target.y, bounced: false };
    let last = performance.now();
    render();
    const step = (time) => {
      const dt = Math.min(.034, (time - last) / 1000); last = time;
      anim.vy += 5200 * dt; anim.y += anim.vy * dt;
      if (anim.y >= anim.target) {
        if (!anim.bounced && anim.vy > 900) { anim.y = anim.target; anim.vy = -anim.vy * .22; anim.bounced = true; Sound?.rail(700); }
        else { anim = null; state = next; render(); after?.(); return; }
      }
      draw(); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function afterMove(previous) {
    if (over()) { gameOver(); return; }
    if (mode === 'online' && state.turn === online.seat && previous.turn !== online.seat) yourTurn('Your move!');
    maybeCpu();
  }

  async function play(col) {
    if (!canMove() || !G.canDrop(state, col)) return;
    Sound?.unlock();
    const previous = state, next = G.drop(state, col);
    if (previous.moves === 0) track('game_started', {});
    if (mode !== 'online') { animateDrop(col, next, () => afterMove(previous)); return; }
    const seq = online.seq + 1;
    online.seq = seq; online.sending = true;
    animateDrop(col, next, () => afterMove(previous));
    try { await saveRoom({ seq, state: JSON.stringify(next), shot: JSON.stringify({ col, seq, by: online.seat }), status: next.winner !== null || next.draw ? 'finished' : 'playing' }); }
    catch { $('#lu-notice').textContent = 'MOVE DID NOT SYNC. RELOADING THE BOARD…'; await refreshRoom(true); }
    finally { online.sending = false; if (!anim) render(); }
  }

  function maybeCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
    cpuTimer = setTimeout(() => {
      if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
      const col = G.chooseMove(state, level), previous = state;
      animateDrop(col, G.drop(state, col), () => afterMove(previous));
    }, 450);
  }

  function gameOver() {
    const won = state.winner === mySeat();
    revealAt = performance.now() + (state.line ? 1500 : 600); setTimeout(render, state.line ? 1550 : 650);
    if (state.draw) Sound?.turn(); else if (mode === 'local' || won) Sound?.win(); else Sound?.lose();
    const key = `${mode}:${online?.code || ''}:${(state.match || []).join()}:${state.moves}:${state.board}`;
    if (key !== lastCounted && !state.draw) {
      lastCounted = key;
      const record = loadRecord();
      if (mode === 'cpu') { record.cpu[level][won ? 0 : 1] += 1; saveRecord(record); }
      if (mode === 'online') {
        record.online[won ? 0 : 1] += 1; saveRecord(record);
        const rival = opponent(); if (rival.id) Rivals?.record('lineup', { ...rival, won });
        if (document.hidden) notify(won ? 'You won at Line Up! 🏆' : 'Your opponent lined up four.');
      }
      track('game_finished', { outcome: mode === 'local' ? `player_${state.winner + 1}` : won ? 'won' : 'lost', moves: state.moves });
    } else if (state.draw && key !== lastCounted) { lastCounted = key; track('game_finished', { outcome: 'draw', moves: state.moves }); }
    render();
  }
  // Loser starts the next game; after a draw the other player starts.
  const nextStarter = () => (state.draw ? 1 - (state.starter ?? 0) : 1 - state.winner);

  // ---------- records (this device) ----------
  function loadRecord() {
    const saved = parse(stored('neonLineUpRecord', '')) || {};
    return { cpu: { easy: [0, 0], medium: [0, 0], hard: [0, 0], ...(saved.cpu || {}) }, online: saved.online || [0, 0] };
  }
  function saveRecord(record) { store('neonLineUpRecord', JSON.stringify(record)); }
  function renderRecord() {
    const record = loadRecord(), list = $('#lu-record'); list.replaceChildren();
    [['VS CPU · EASY', record.cpu.easy], ['VS CPU · MEDIUM', record.cpu.medium], ['VS CPU · HARD', record.cpu.hard], ['ONLINE', record.online]].forEach(([label, [w, l]]) => {
      const item = document.createElement('li'), name = document.createElement('span'), score = document.createElement('b');
      name.textContent = label; score.textContent = `${w}W – ${l}L`; item.append(name, score); list.append(item);
    });
    Rivals?.render('lineup', $('#lu-rivals'), (rival) => { begin('online'); createRoom(rival); });
  }

  // ---------- alerts while the tab is in the background ----------
  const baseTitle = document.title;
  let titleTimer = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(titleTimer); document.title = baseTitle; } });
  function notify(body) {
    if (!document.hidden) return;
    clearInterval(titleTimer); let on = false;
    titleTimer = setInterval(() => { on = !on; document.title = on ? `🟢 ${body}` : baseTitle; }, 900);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body, tag: `lineup-${online?.code || 'game'}` };
    navigator.serviceWorker?.getRegistration?.().then((registration) => registration ? registration.showNotification('Line Up', options) : new Notification('Line Up', options)).catch(() => { try { new Notification('Line Up', options); } catch {} });
  }
  function yourTurn(message) { Sound?.turn(); notify(message); }

  // ---------- online rooms (shared PoolRoom table, marked game: 'lineup') ----------
  const rooms = () => window.neonDataClient?.models?.PoolRoom;
  const failIf = (errors) => { if (errors?.length) throw new Error(errors.map((error) => error.message).join(' ')); };
  const expiry = () => Math.floor(Date.now() / 1000) + ROOM_TTL;
  const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('');
  function inviteLink(code) { const url = new URL(location.href); url.search = `?lineup=${code}`; url.hash = ''; return url.toString(); }
  function setConnection(text, live) { const badge = $('#lu-connection'); badge.textContent = `● ${text}`; badge.classList.toggle('offline', !live); }
  function opponent() { const room = online?.room; if (!room) return {}; return online.seat === 0 ? { id: room.guestId, name: room.guestName } : { id: room.hostId, name: room.hostName }; }
  function announceRival() { const rival = opponent(); if (rival.id && Rivals) showToast(Rivals.summary('lineup', rival.id, rival.name), true); }

  async function saveRoom(fields) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { const { data, errors } = await rooms().update({ code: online.code, expiresAt: expiry(), ...fields }); failIf(errors); online.room = { ...online.room, ...data }; return data; }
      catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1))); }
    }
    throw lastError;
  }
  async function fetchRoom(code) { const { data, errors } = await rooms().get({ code }); failIf(errors); return data; }

  function handleRoom(room) {
    if (!online || !room || room.code !== online.code || room.seq < online.seq) return;
    if (anim) { if (!online.pending || room.seq >= online.pending.seq) online.pending = room; return; }
    const wasWaiting = online.room?.status === 'waiting', wasMine = state.turn === online.seat;
    online.room = { ...online.room, ...room };
    const reaction = parse(room.reaction);
    if (reaction && reaction.at > online.reactionAt && REACTIONS.includes(reaction.text)) {
      online.reactionAt = reaction.at; const fromMe = reaction.by === online.seat;
      showToast(`${fromMe ? 'YOU' : names()[reaction.by]}: ${reaction.text}`, fromMe); if (!fromMe) notify(`${names()[reaction.by]}: ${reaction.text}`);
    }
    if (room.seq > online.seq) {
      const remote = parse(room.state), shot = parse(room.shot);
      const replay = remote && shot && shot.seq === room.seq && room.seq === online.seq + 1 && shot.by !== online.seat && G.canDrop(state, shot.col);
      online.seq = room.seq;
      if (replay) { const previous = state; animateDrop(shot.col, remote, () => { afterMove(previous); flushPending(); }); return; }
      if (remote) {
        state = remote; render();
        if (over()) gameOver();
        else if (wasWaiting && room.status === 'playing') { $('#lu-notice').textContent = `${clean(room.guestName)} JOINED.`; yourTurn(`${clean(room.guestName)} joined. You go first!`); announceRival(); }
        else if (!wasMine && state.turn === online.seat) yourTurn(state.moves === 0 ? 'New game — you go first!' : 'Your move!');
      }
    }
    render();
  }
  function flushPending() { if (online?.pending) { const room = online.pending; online.pending = null; handleRoom(room); } }

  async function refreshRoom(force = false) {
    if (!online || (anim && !force)) return;
    try { const room = await fetchRoom(online.code); if (!room) return; if (force) online.seq = Math.min(online.seq, room.seq - 1); handleRoom(room); setConnection('LIVE', true); } catch { setConnection('RECONNECTING', false); }
  }

  function enterRoom(room, seat) {
    leaveRoom(false); clearTimeout(cpuTimer);
    mode = 'online';
    online = { code: room.code, seat, seq: room.seq, room, sub: null, poll: 0, pending: null, sending: false, reactionAt: parse(room.reaction)?.at || 0, lastReaction: 0, invitee: null };
    $('#lu-overlay').dataset.intro = 'false';
    history.replaceState(null, '', inviteLink(room.code));
    try { online.sub = rooms().onUpdate({ filter: { code: { eq: room.code } } }).subscribe({ next: handleRoom, error: () => setConnection('POLLING', false) }); setConnection('LIVE', true); }
    catch { setConnection('POLLING', false); }
    online.poll = setInterval(() => refreshRoom(), 4000);
    state = parse(room.state) || G.newGame(0); render();
  }
  function leaveRoom(reset = true) {
    if (online) { online.sub?.unsubscribe?.(); clearInterval(online.poll); }
    online = null; anim = null;
    if (!reset) return;
    setConnection('OFFLINE', false);
    const url = new URL(location.href); url.searchParams.delete('lineup'); history.replaceState(null, '', url);
  }
  function playerName() { const name = clean($('#lu-name').value); if (name) store('neonPoolName', name); return name; }
  function needsClient() { if (rooms()) return false; $('#lu-notice').textContent = 'CONNECTING TO THE GAME NETWORK… TRY AGAIN IN A MOMENT.'; return true; }

  async function createRoom(invitee = null) {
    const name = playerName(), notice = $('#lu-notice');
    if (!name) { notice.textContent = invitee ? 'ENTER YOUR CALLSIGN, THEN TAP REMATCH AGAIN.' : 'ENTER A CALLSIGN FIRST.'; $('#lu-name').focus(); return; }
    if (needsClient()) return;
    notice.textContent = 'OPENING A PRIVATE ROOM…';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { data, errors } = await rooms().create({ code: roomCode(), game: 'lineup', hostId: me, hostName: name, status: 'waiting', seq: 1, state: JSON.stringify(G.newGame(0)), expiresAt: expiry() });
        failIf(errors);
        notice.textContent = invitee ? `ROOM READY. SEND ${invitee.name} THE INVITE.` : 'ROOM READY. SEND THE INVITE LINK.';
        enterRoom(data, 0); online.invitee = invitee?.name || null; render(); track('room_created', { rematch: Boolean(invitee) }); return;
      } catch { /* code taken or a network blip: try another */ }
    }
    notice.textContent = 'COULD NOT OPEN A ROOM. CHECK YOUR CONNECTION.';
  }

  async function joinRoom(rawCode = $('#lu-code').value) {
    const code = String(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), notice = $('#lu-notice');
    if (code.length !== 5) { notice.textContent = 'ROOM CODES ARE 5 CHARACTERS.'; return; }
    if (needsClient()) return;
    notice.textContent = `LOOKING FOR ROOM ${code}…`;
    try {
      const room = await fetchRoom(code);
      if (!room) { notice.textContent = `ROOM ${code} NOT FOUND OR EXPIRED.`; return; }
      // The online games share room codes; send another game's code to that game (rooms with no game are pool).
      if (room.game !== 'lineup') { location.search = `?${room.game === 'gomoku' ? 'gomoku' : 'room'}=${code}`; return; }
      if (room.hostId === me) { notice.textContent = 'BACK IN YOUR ROOM.'; enterRoom(room, 0); return; }
      if (room.guestId === me) { notice.textContent = 'BACK IN THE GAME.'; enterRoom(room, 1); return; }
      if (room.guestId) { notice.textContent = 'THAT ROOM ALREADY HAS TWO PLAYERS.'; return; }
      const name = playerName();
      if (!name) { notice.textContent = 'ENTER A CALLSIGN, THEN JOIN.'; $('#lu-name').focus(); return; }
      const { errors } = await rooms().update({ code, guestId: me, guestName: name, status: 'playing', seq: room.seq + 1, expiresAt: expiry() });
      failIf(errors);
      const joined = await fetchRoom(code);
      if (joined?.guestId !== me) { notice.textContent = 'SOMEONE ELSE TOOK THAT SEAT.'; return; }
      notice.textContent = `JOINED ${clean(joined.hostName)}'S GAME.`; enterRoom(joined, 1); announceRival(); track('room_joined');
    } catch { notice.textContent = 'COULD NOT REACH THE ROOM. TRY AGAIN.'; }
  }

  async function rematch() {
    if (!online || online.sending) return;
    const next = G.newGame(nextStarter(), state.match), seq = online.seq + 1;
    online.seq = seq; online.sending = true; state = next; render();
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
  function showToast(text, mine) { const toast = $('#lu-toast'); toast.textContent = text; toast.classList.toggle('mine', mine); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200); }

  function renderRoom() {
    const inRoom = mode === 'online' && online?.room;
    $('#lu-lobby').hidden = Boolean(inRoom); $('#lu-room').hidden = !inRoom;
    if (!inRoom) return;
    $('#lu-room-code').textContent = online.code;
    $('#lu-reactions').hidden = online.room.status === 'waiting';
    const rival = opponent(); $('#lu-h2h').textContent = rival.id && Rivals ? Rivals.summary('lineup', rival.id, rival.name) : '';
    const seats = $('#lu-seats'); seats.replaceChildren();
    [[online.room.hostName, 0], [online.room.guestName, 1]].forEach(([name, seat]) => {
      const item = document.createElement('li'), who = document.createElement('b'), role = document.createElement('span');
      who.textContent = name ? `${clean(name)} · ${(state.match || [0, 0])[seat]}` : 'OPEN SEAT'; who.style.color = name ? COLORS[seat] === '#cffb4b' ? '#5f8d12' : '#d1336d' : '';
      role.textContent = [seat === online.seat ? 'YOU' : '', !over() && name && state.turn === seat && online.room.status !== 'waiting' ? 'TO MOVE' : ''].filter(Boolean).join(' · ') || (seat === 0 ? 'HOST' : 'GUEST');
      item.append(who, role); seats.append(item);
    });
    const alerts = $('#lu-alerts'); alerts.hidden = !('Notification' in window);
    if (!alerts.hidden) alerts.textContent = Notification.permission === 'granted' ? '🔔 TURN ALERTS ON' : Notification.permission === 'denied' ? '🔕 ALERTS BLOCKED IN BROWSER' : '🔔 TURN ON TURN ALERTS';
  }

  // ---------- modes ----------
  function begin(nextMode) {
    $('#lu-overlay').dataset.intro = 'false'; clearTimeout(cpuTimer);
    if (nextMode === 'online') { if (mode === 'online' && online) { render(); return; } leaveRoom(true); mode = 'online'; state = G.newGame(0); render(); $('#lu-name').focus(); return; }
    leaveRoom(true); mode = nextMode; state = G.newGame(0); Sound?.unlock(); render(); track('mode_selected', {});
  }
  function nextGame() {
    if (mode === 'online') { rematch(); return; }
    state = G.newGame(nextStarter(), state.match); render(); maybeCpu();
  }

  // ---------- input ----------
  function columnAt(event) { const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * W / rect.width; return Math.max(0, Math.min(G.COLS - 1, Math.floor((x - X0) / CELL))); }
  canvas.addEventListener('pointermove', (event) => { const col = columnAt(event); if (col !== hover) { hover = col; draw(); } });
  canvas.addEventListener('pointerdown', (event) => { hover = columnAt(event); draw(); });
  canvas.addEventListener('pointerup', (event) => { const col = columnAt(event); hover = col; play(col); });
  addEventListener('keydown', (event) => {
    if ($('#lineup-game').hidden || event.target.matches('input,textarea')) return;
    if (event.code === 'ArrowLeft') { event.preventDefault(); hover = Math.max(0, hover - 1); draw(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); hover = Math.min(G.COLS - 1, hover + 1); draw(); }
    if (['Space', 'Enter', 'ArrowDown'].includes(event.code)) { event.preventDefault(); play(hover); }
    if (/^Digit[1-7]$/.test(event.code)) { hover = Number(event.code.slice(5)) - 1; play(hover); }
  });

  $$('[data-lu-begin]').forEach((button) => button.addEventListener('click', () => begin(button.dataset.luBegin)));
  $$('[data-lu-mode]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.luMode !== mode || $('#lu-overlay').dataset.intro === 'true') begin(button.dataset.luMode); }));
  $$('[data-lu-level]').forEach((button) => button.addEventListener('click', () => { level = button.dataset.luLevel; store('neonLineUpCpu', level); track('difficulty_selected', {}); render(); }));
  $('#lu-again').addEventListener('click', nextGame);
  $('#lu-change-mode').addEventListener('click', () => { $('#lu-overlay').dataset.intro = 'true'; clearTimeout(cpuTimer); state = G.newGame(0); render(); });
  $('#lu-restart').addEventListener('click', () => { if (mode !== 'online') { clearTimeout(cpuTimer); anim = null; state = G.newGame(state.starter ?? 0, state.match); render(); maybeCpu(); } });
  $('#lu-mute').addEventListener('click', () => { Sound?.setMuted(!Sound.muted); renderMute(); if (!Sound?.muted) Sound?.turn(); });
  function renderMute() { const button = $('#lu-mute'); button.textContent = Sound?.muted ? '🔇' : '🔊'; button.setAttribute('aria-label', Sound?.muted ? 'Turn sound on' : 'Turn sound off'); }
  $('#lu-help-button').addEventListener('click', () => { $('#lu-help').hidden = !$('#lu-help').hidden; });
  $('#lu-help-close').addEventListener('click', () => { $('#lu-help').hidden = true; });
  $('#lu-create').addEventListener('click', () => createRoom());
  $('#lu-join').addEventListener('click', () => joinRoom());
  $('#lu-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#lu-leave').addEventListener('click', () => { leaveRoom(true); mode = 'online'; state = G.newGame(0); render(); $('#lu-notice').textContent = 'YOU LEFT THE ROOM. USE THE CODE TO REJOIN.'; });
  async function share() {
    const link = inviteLink(online.code);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'Line Up', text: `${online.invitee ? 'Rematch? ' : ''}Join my Line Up game (room ${online.code})`, url: link }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); $('#lu-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#lu-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  }
  $('#lu-copy').addEventListener('click', share); $('#lu-overlay-copy').addEventListener('click', share);
  $('#lu-alerts').addEventListener('click', async () => { if ('Notification' in window && Notification.permission === 'default') { await Notification.requestPermission(); render(); } });
  REACTIONS.forEach((text) => { const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', () => react(text)); $('#lu-reactions').append(button); });

  $('#lu-name').value = stored('neonPoolName', '');
  setConnection('OFFLINE', false); renderMute(); render();

  // Invite links (?lineup=CODE) open Line Up and join straight away.
  const invited = new URLSearchParams(location.search).get('lineup');
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="lineup"]')?.click();
    $('#lu-code').value = invited.toUpperCase(); $('#lu-overlay').dataset.intro = 'false'; mode = 'online'; render();
    const tryJoin = () => { if (rooms()) joinRoom(invited); };
    if (rooms()) tryJoin(); else { $('#lu-notice').textContent = 'CONNECTING TO YOUR INVITE…'; addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
