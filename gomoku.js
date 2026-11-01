(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const canvas = $('#gm-canvas');
  const G = window.NeonGomoku, Sound = window.NeonPoolSound, Rivals = window.NeonRivals;
  if (!canvas || !G) return;
  const ctx = canvas.getContext('2d');
  const W = 660, CELL = 40, X0 = (W - (G.N - 1) * CELL) / 2, R = 17;
  const COLORS = ['#ffcf33', '#ff5a4d'];
  const STARS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', ROOM_TTL = 24 * 60 * 60;
  const REACTIONS = ['NICE MOVE!', 'UNLUCKY', 'GOOD GAME', 'REMATCH?', 'HURRY UP 😅', '🔥', '😂', '👏'];
  // Each online game's invite parameter, so a code typed into the wrong game opens the right one.
  const INVITES = { pool: 'room', lineup: 'lineup', gomoku: 'gomoku', checkers: 'checkers' };

  // Same browser player id as the pool rooms, so rivals line up across games.
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
  const stored = (key, fallback) => { try { return localStorage[key] ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage[key] = value; } catch {} };

  let mode = 'cpu', state = G.newGame(0), level = G.LEVELS[stored('neonGomokuCpu', 'medium')] ? stored('neonGomokuCpu', 'medium') : 'medium';
  let revealAt = 0; // the result screen waits a moment so the winning line can be seen
  // aim: the intersection under the mouse, picked by a first tap on touch screens, or moved with the arrow keys
  let aim = G.at(7, 7), aimShown = false, touchAim = false, anim = null, cpuTimer = 0, lastCounted = '', online = null; // online: { code, seat, seq, room, sub, poll, pending, sending, reactionAt, lastReaction, invitee }

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
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'gomoku', { mode, ...(mode === 'cpu' ? { difficulty: level } : {}), ...details });

  // ---------- rendering ----------
  const point = (index) => ({ x: X0 + (index % G.N) * CELL, y: X0 + Math.floor(index / G.N) * CELL });
  function stone(x, y, seat, alpha = 1, scale = 1) {
    ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, R * scale, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[seat]; ctx.shadowColor = COLORS[seat]; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x - R * .3 * scale, y - R * .3 * scale, R * .32 * scale, 0, Math.PI * 2); ctx.fillStyle = '#ffffff55'; ctx.fill(); ctx.globalAlpha = 1;
  }
  function draw() {
    ctx.fillStyle = '#100b2e'; ctx.fillRect(0, 0, W, W);
    const end = X0 + (G.N - 1) * CELL;
    ctx.strokeStyle = '#ffcf33'; ctx.lineWidth = 2; ctx.shadowColor = '#ffcf33'; ctx.shadowBlur = 10; ctx.strokeRect(X0 - 26, X0 - 26, end - X0 + 52, end - X0 + 52); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#4a3e99'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < G.N; i += 1) { const p = X0 + i * CELL; ctx.moveTo(X0, p); ctx.lineTo(end, p); ctx.moveTo(p, X0); ctx.lineTo(p, end); }
    ctx.stroke();
    ctx.fillStyle = '#6a5cc4';
    for (const [col, row] of STARS) { const { x, y } = point(G.at(col, row)); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    for (let index = 0; index < G.SIZE; index += 1) {
      const value = state.board[index];
      if (value === '.' || anim?.index === index) continue;
      const { x, y } = point(index); stone(x, y, Number(value));
    }
    if (anim) { const { x, y } = point(anim.index); stone(x, y, anim.seat, 1, anim.scale); }
    // mark the latest stone so it's easy to see what just happened
    if (state.last && !anim && !state.line) { const { x, y } = point(state.last.index); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#100b2e'; ctx.fill(); }
    if (state.line && !anim) {
      const pulse = .55 + .45 * Math.sin(performance.now() / 180), first = point(state.line[0]), last = point(state.line[state.line.length - 1]);
      ctx.strokeStyle = '#faf6ee'; ctx.lineWidth = 5; ctx.globalAlpha = pulse; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(first.x, first.y); ctx.lineTo(last.x, last.y); ctx.stroke();
      for (const index of state.line) { const { x, y } = point(index); ctx.beginPath(); ctx.arc(x, y, R + 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    // the stone you're about to place
    if (aimShown && canMove() && G.canPlace(state, aim)) { const { x, y } = point(aim); stone(x, y, state.turn, .45); }
  }
  // the winning line keeps pulsing until the next game starts
  (function idle() { if (state.line && !anim && !$('#gomoku-game').hidden) draw(); requestAnimationFrame(idle); })();

  function render() {
    draw();
    const [p1, p2] = names(), match = state.match || [0, 0];
    $('#gm-p1-name').textContent = p1; $('#gm-p2-name').textContent = p2;
    $('#gm-p1-info').textContent = `${match[0]} WON`; $('#gm-p2-info').textContent = `${match[1]} WON`;
    $('#gm-p1').classList.toggle('active', !over() && state.turn === 0); $('#gm-p2').classList.toggle('active', !over() && state.turn === 1);
    let status = say(state.message);
    if (mode === 'online' && !online) status = 'CREATE A PRIVATE ROOM, OR JOIN ONE WITH A CODE →';
    else if (mode === 'online' && online.room.status === 'waiting') status = `WAITING FOR AN OPPONENT — SHARE CODE ${online.code}`;
    else if (mode === 'online' && !over()) status += myTurn() ? ' · YOUR MOVE' : ' · OPPONENT IS THINKING';
    if (mode === 'cpu' && state.turn === 1 && !over()) status += ' · CPU IS THINKING…';
    if (aimShown && touchAim && canMove()) status += ' · TAP AGAIN TO PLACE';
    $('#gm-status').textContent = status;
    $$('[data-gm-mode]').forEach((button) => button.classList.toggle('active', button.dataset.gmMode === mode));
    $('#gm-levels').hidden = mode !== 'cpu';
    $$('[data-gm-level]').forEach((button) => button.classList.toggle('active', button.dataset.gmLevel === level));
    $('#gm-restart').hidden = mode === 'online';
    showOverlay(); renderRoom(); renderRecord();
  }

  function showOverlay() {
    const overlay = $('#gm-overlay'), title = $('#gm-title'), message = $('#gm-message');
    $('#gm-intro-actions').hidden = true; $('#gm-end-actions').hidden = true; $('#gm-wait-actions').hidden = true;
    if (over() && !anim && performance.now() < revealAt) { overlay.hidden = true; return; }
    if (over() && !anim) {
      $('#gm-eyebrow').textContent = state.draw ? 'NO FIVE IN A ROW' : 'GAME OVER';
      overlay.hidden = false; $('#gm-end-actions').hidden = false;
      const won = state.winner === mySeat(), match = state.match || [0, 0];
      title.textContent = state.draw ? 'DRAW' : mode === 'local' ? `${names()[state.winner]} WINS` : won ? 'YOU WIN!' : mode === 'cpu' ? 'CPU WINS' : 'YOU LOSE';
      message.textContent = `${state.draw ? 'The board filled up with no five in a row.' : 'Five in a row.'} Match: ${names()[0]} ${match[0]} – ${match[1]} ${names()[1]}.`;
      $('#gm-again').innerHTML = mode === 'online' ? 'REMATCH <b>→</b>' : 'NEXT GAME <b>→</b>';
      $('#gm-change-mode').hidden = mode === 'online';
    } else if (mode === 'online' && online?.room.status === 'waiting') {
      overlay.hidden = false; $('#gm-wait-actions').hidden = false; $('#gm-eyebrow').textContent = 'WAITING FOR A PLAYER';
      title.textContent = online.invitee ? `REMATCH VS ${online.invitee}` : 'ROOM OPEN';
      message.textContent = `Send ${online.invitee || 'your opponent'} the invite link or room code ${online.code}. The game starts as soon as they join.`;
    } else if (overlay.dataset.intro === 'true') {
      overlay.hidden = false; $('#gm-intro-actions').hidden = false; $('#gm-eyebrow').textContent = 'THE BOARD IS EMPTY';
      title.textContent = 'GOMOKU'; message.textContent = 'Take turns placing stones on the grid. First to get five in a row — across, up and down, or diagonally — wins.';
    } else overlay.hidden = true;
  }

  // ---------- moves ----------
  // Pop the stone onto the board, then apply the move.
  function animatePlace(index, next, after) {
    anim = { index, seat: state.turn, scale: 1.5 }; aimShown = false;
    const start = performance.now();
    render(); Sound?.click(900);
    const step = (time) => {
      const t = Math.min(1, (time - start) / 140);
      anim.scale = 1.5 - .5 * t * (2 - t);
      if (t >= 1) { anim = null; state = next; render(); after?.(); return; }
      draw(); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function afterMove(previous) {
    if (over()) { gameOver(); return; }
    if (mode === 'online' && state.turn === online.seat && previous.turn !== online.seat) yourTurn('Your move!');
    maybeCpu();
  }

  async function play(index) {
    if (!canMove() || !G.canPlace(state, index)) return;
    Sound?.unlock();
    const previous = state, next = G.place(state, index);
    if (previous.moves === 0) track('game_started', {});
    if (mode !== 'online') { animatePlace(index, next, () => afterMove(previous)); return; }
    const seq = online.seq + 1;
    online.seq = seq; online.sending = true;
    animatePlace(index, next, () => afterMove(previous));
    try { await saveRoom({ seq, state: JSON.stringify(next), shot: JSON.stringify({ index, seq, by: online.seat }), status: next.winner !== null || next.draw ? 'finished' : 'playing' }); }
    catch { $('#gm-notice').textContent = 'MOVE DID NOT SYNC. RELOADING THE BOARD…'; await refreshRoom(true); }
    finally { online.sending = false; if (!anim) render(); }
  }

  function maybeCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
    cpuTimer = setTimeout(() => {
      if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
      const index = G.chooseMove(state, level), previous = state;
      animatePlace(index, G.place(state, index), () => afterMove(previous));
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
        const rival = opponent(); if (rival.id) Rivals?.record('gomoku', { ...rival, won });
        if (document.hidden) notify(won ? 'You won at Gomoku! 🏆' : 'Your opponent got five in a row.');
      }
      track('game_finished', { outcome: mode === 'local' ? `player_${state.winner + 1}` : won ? 'won' : 'lost', moves: state.moves });
    } else if (state.draw && key !== lastCounted) { lastCounted = key; track('game_finished', { outcome: 'draw', moves: state.moves }); }
    render();
  }
  // Loser starts the next game; after a draw the other player starts.
  const nextStarter = () => (state.draw ? 1 - (state.starter ?? 0) : 1 - state.winner);

  // ---------- records (this device) ----------
  function loadRecord() {
    const saved = parse(stored('neonGomokuRecord', '')) || {};
    return { cpu: { easy: [0, 0], medium: [0, 0], hard: [0, 0], ...(saved.cpu || {}) }, online: saved.online || [0, 0] };
  }
  function saveRecord(record) { store('neonGomokuRecord', JSON.stringify(record)); }
  function renderRecord() {
    const record = loadRecord(), list = $('#gm-record'); list.replaceChildren();
    [['VS CPU · EASY', record.cpu.easy], ['VS CPU · MEDIUM', record.cpu.medium], ['VS CPU · HARD', record.cpu.hard], ['ONLINE', record.online]].forEach(([label, [w, l]]) => {
      const item = document.createElement('li'), name = document.createElement('span'), score = document.createElement('b');
      name.textContent = label; score.textContent = `${w}W – ${l}L`; item.append(name, score); list.append(item);
    });
    Rivals?.render('gomoku', $('#gm-rivals'), (rival) => { begin('online'); createRoom(rival); });
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
    const options = { body, tag: `gomoku-${online?.code || 'game'}` };
    navigator.serviceWorker?.getRegistration?.().then((registration) => registration ? registration.showNotification('Gomoku', options) : new Notification('Gomoku', options)).catch(() => { try { new Notification('Gomoku', options); } catch {} });
  }
  function yourTurn(message) { Sound?.turn(); notify(message); }

  // ---------- online rooms (shared PoolRoom table, marked game: 'gomoku') ----------
  const rooms = () => window.neonDataClient?.models?.PoolRoom;
  const failIf = (errors) => { if (errors?.length) throw new Error(errors.map((error) => error.message).join(' ')); };
  const expiry = () => Math.floor(Date.now() / 1000) + ROOM_TTL;
  const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('');
  function inviteLink(code) { const url = new URL(location.href); url.search = `?gomoku=${code}`; url.hash = ''; return url.toString(); }
  function setConnection(text, live) { const badge = $('#gm-connection'); badge.textContent = `● ${text}`; badge.classList.toggle('offline', !live); }
  function opponent() { const room = online?.room; if (!room) return {}; return online.seat === 0 ? { id: room.guestId, name: room.guestName } : { id: room.hostId, name: room.hostName }; }
  function announceRival() { const rival = opponent(); if (rival.id && Rivals) showToast(Rivals.summary('gomoku', rival.id, rival.name), true); }

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
      const replay = remote && shot && shot.seq === room.seq && room.seq === online.seq + 1 && shot.by !== online.seat && G.canPlace(state, shot.index);
      online.seq = room.seq;
      if (replay) { const previous = state; animatePlace(shot.index, remote, () => { afterMove(previous); flushPending(); }); return; }
      if (remote) {
        state = remote; render();
        if (over()) gameOver();
        else if (wasWaiting && room.status === 'playing') { $('#gm-notice').textContent = `${clean(room.guestName)} JOINED.`; yourTurn(`${clean(room.guestName)} joined. You go first!`); announceRival(); }
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
    $('#gm-overlay').dataset.intro = 'false';
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
    const url = new URL(location.href); url.searchParams.delete('gomoku'); history.replaceState(null, '', url);
  }
  function playerName() { const name = clean($('#gm-name').value); if (name) store('neonPoolName', name); return name; }
  function needsClient() { if (rooms()) return false; $('#gm-notice').textContent = 'CONNECTING TO THE GAME NETWORK… TRY AGAIN IN A MOMENT.'; return true; }

  async function createRoom(invitee = null) {
    const name = playerName(), notice = $('#gm-notice');
    if (!name) { notice.textContent = invitee ? 'ENTER YOUR CALLSIGN, THEN TAP REMATCH AGAIN.' : 'ENTER A CALLSIGN FIRST.'; $('#gm-name').focus(); return; }
    if (needsClient()) return;
    notice.textContent = 'OPENING A PRIVATE ROOM…';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { data, errors } = await rooms().create({ code: roomCode(), game: 'gomoku', hostId: me, hostName: name, status: 'waiting', seq: 1, state: JSON.stringify(G.newGame(0)), expiresAt: expiry() });
        failIf(errors);
        notice.textContent = invitee ? `ROOM READY. SEND ${invitee.name} THE INVITE.` : 'ROOM READY. SEND THE INVITE LINK.';
        enterRoom(data, 0); online.invitee = invitee?.name || null; render(); track('room_created', { rematch: Boolean(invitee) }); return;
      } catch { /* code taken or a network blip: try another */ }
    }
    notice.textContent = 'COULD NOT OPEN A ROOM. CHECK YOUR CONNECTION.';
  }

  async function joinRoom(rawCode = $('#gm-code').value) {
    const code = String(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), notice = $('#gm-notice');
    if (code.length !== 5) { notice.textContent = 'ROOM CODES ARE 5 CHARACTERS.'; return; }
    if (needsClient()) return;
    notice.textContent = `LOOKING FOR ROOM ${code}…`;
    try {
      const room = await fetchRoom(code);
      if (!room) { notice.textContent = `ROOM ${code} NOT FOUND OR EXPIRED.`; return; }
      // The online games share room codes; send another game's code to that game (rooms with no game are pool).
      if (room.game !== 'gomoku') { location.search = `?${INVITES[room.game] || 'room'}=${code}`; return; }
      if (room.hostId === me) { notice.textContent = 'BACK IN YOUR ROOM.'; enterRoom(room, 0); return; }
      if (room.guestId === me) { notice.textContent = 'BACK IN THE GAME.'; enterRoom(room, 1); return; }
      if (room.guestId) { notice.textContent = 'THAT ROOM ALREADY HAS TWO PLAYERS.'; return; }
      const name = playerName();
      if (!name) { notice.textContent = 'ENTER A CALLSIGN, THEN JOIN.'; $('#gm-name').focus(); return; }
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
  function showToast(text, mine) { const toast = $('#gm-toast'); toast.textContent = text; toast.classList.toggle('mine', mine); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200); }

  function renderRoom() {
    const inRoom = mode === 'online' && online?.room;
    $('#gm-lobby').hidden = Boolean(inRoom); $('#gm-room').hidden = !inRoom;
    if (!inRoom) return;
    $('#gm-room-code').textContent = online.code;
    $('#gm-reactions').hidden = online.room.status === 'waiting';
    const rival = opponent(); $('#gm-h2h').textContent = rival.id && Rivals ? Rivals.summary('gomoku', rival.id, rival.name) : '';
    const seats = $('#gm-seats'); seats.replaceChildren();
    [[online.room.hostName, 0], [online.room.guestName, 1]].forEach(([name, seat]) => {
      const item = document.createElement('li'), who = document.createElement('b'), role = document.createElement('span');
      who.textContent = name ? `${clean(name)} · ${(state.match || [0, 0])[seat]}` : 'OPEN SEAT'; who.style.color = name ? seat === 0 ? '#9a6f00' : '#d13a2e' : '';
      role.textContent = [seat === online.seat ? 'YOU' : '', !over() && name && state.turn === seat && online.room.status !== 'waiting' ? 'TO MOVE' : ''].filter(Boolean).join(' · ') || (seat === 0 ? 'HOST' : 'GUEST');
      item.append(who, role); seats.append(item);
    });
    const alerts = $('#gm-alerts'); alerts.hidden = !('Notification' in window);
    if (!alerts.hidden) alerts.textContent = Notification.permission === 'granted' ? '🔔 TURN ALERTS ON' : Notification.permission === 'denied' ? '🔕 ALERTS BLOCKED IN BROWSER' : '🔔 TURN ON TURN ALERTS';
  }

  // ---------- modes ----------
  function begin(nextMode) {
    $('#gm-overlay').dataset.intro = 'false'; clearTimeout(cpuTimer); aimShown = false;
    if (nextMode === 'online') { if (mode === 'online' && online) { render(); return; } leaveRoom(true); mode = 'online'; state = G.newGame(0); render(); $('#gm-name').focus(); return; }
    leaveRoom(true); mode = nextMode; state = G.newGame(0); Sound?.unlock(); render(); track('mode_selected', {});
  }
  function nextGame() {
    aimShown = false;
    if (mode === 'online') { rematch(); return; }
    state = G.newGame(nextStarter(), state.match); render(); maybeCpu();
  }

  // ---------- input ----------
  // Mouse: hover to preview, click to place. Touch: the intersections are small, so the first tap shows the stone
  // and a second tap on the same spot places it (tap elsewhere to move it).
  function pointAt(event) {
    const rect = canvas.getBoundingClientRect(), scale = W / rect.width;
    const col = Math.round(((event.clientX - rect.left) * scale - X0) / CELL), row = Math.round(((event.clientY - rect.top) * scale - X0) / CELL);
    return G.at(Math.max(0, Math.min(G.N - 1, col)), Math.max(0, Math.min(G.N - 1, row)));
  }
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const index = pointAt(event); touchAim = false;
    if (index !== aim || !aimShown) { aim = index; aimShown = true; draw(); }
  });
  canvas.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse' && aimShown) { aimShown = false; draw(); } });
  canvas.addEventListener('pointerup', (event) => {
    const index = pointAt(event);
    if (event.pointerType === 'mouse') { aim = index; play(index); return; }
    if (!canMove() || !G.canPlace(state, index)) return;
    if (touchAim && aimShown && aim === index) { touchAim = false; play(index); return; }
    aim = index; aimShown = true; touchAim = true; render();
  });
  addEventListener('keydown', (event) => {
    if ($('#gomoku-game').hidden || event.target.matches('input,textarea')) return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.code];
    if (moves) {
      event.preventDefault();
      const col = Math.max(0, Math.min(G.N - 1, aim % G.N + (aimShown ? moves[0] : 0))), row = Math.max(0, Math.min(G.N - 1, Math.floor(aim / G.N) + (aimShown ? moves[1] : 0)));
      aim = G.at(col, row); aimShown = true; touchAim = false; draw();
    }
    if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); if (aimShown) play(aim); else { aimShown = true; draw(); } }
  });

  $$('[data-gm-begin]').forEach((button) => button.addEventListener('click', () => begin(button.dataset.gmBegin)));
  $$('[data-gm-mode]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.gmMode !== mode || $('#gm-overlay').dataset.intro === 'true') begin(button.dataset.gmMode); }));
  $$('[data-gm-level]').forEach((button) => button.addEventListener('click', () => { level = button.dataset.gmLevel; store('neonGomokuCpu', level); track('difficulty_selected', {}); render(); }));
  $('#gm-again').addEventListener('click', nextGame);
  $('#gm-change-mode').addEventListener('click', () => { $('#gm-overlay').dataset.intro = 'true'; clearTimeout(cpuTimer); state = G.newGame(0); render(); });
  $('#gm-restart').addEventListener('click', () => { if (mode !== 'online') { clearTimeout(cpuTimer); anim = null; aimShown = false; state = G.newGame(state.starter ?? 0, state.match); render(); maybeCpu(); } });
  $('#gm-mute').addEventListener('click', () => { Sound?.setMuted(!Sound.muted); renderMute(); if (!Sound?.muted) Sound?.turn(); });
  function renderMute() { const button = $('#gm-mute'); button.textContent = Sound?.muted ? '🔇' : '🔊'; button.setAttribute('aria-label', Sound?.muted ? 'Turn sound on' : 'Turn sound off'); }
  $('#gm-help-button').addEventListener('click', () => { $('#gm-help').hidden = !$('#gm-help').hidden; });
  $('#gm-help-close').addEventListener('click', () => { $('#gm-help').hidden = true; });
  $('#gm-create').addEventListener('click', () => createRoom());
  $('#gm-join').addEventListener('click', () => joinRoom());
  $('#gm-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#gm-leave').addEventListener('click', () => { leaveRoom(true); mode = 'online'; state = G.newGame(0); render(); $('#gm-notice').textContent = 'YOU LEFT THE ROOM. USE THE CODE TO REJOIN.'; });
  async function share() {
    const link = inviteLink(online.code);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'Gomoku', text: `${online.invitee ? 'Rematch? ' : ''}Join my Gomoku game (room ${online.code})`, url: link }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); $('#gm-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#gm-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  }
  $('#gm-copy').addEventListener('click', share); $('#gm-overlay-copy').addEventListener('click', share);
  $('#gm-alerts').addEventListener('click', async () => { if ('Notification' in window && Notification.permission === 'default') { await Notification.requestPermission(); render(); } });
  REACTIONS.forEach((text) => { const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', () => react(text)); $('#gm-reactions').append(button); });

  $('#gm-name').value = stored('neonPoolName', '');
  setConnection('OFFLINE', false); renderMute(); render();

  // Invite links (?gomoku=CODE) open Gomoku and join straight away.
  const invited = new URLSearchParams(location.search).get('gomoku');
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="gomoku"]')?.click();
    $('#gm-code').value = invited.toUpperCase(); $('#gm-overlay').dataset.intro = 'false'; mode = 'online'; render();
    const tryJoin = () => { if (rooms()) joinRoom(invited); };
    if (rooms()) tryJoin(); else { $('#gm-notice').textContent = 'CONNECTING TO YOUR INVITE…'; addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
