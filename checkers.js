(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const canvas = $('#ck-canvas');
  const C = window.NeonCheckers, Sound = window.NeonPoolSound, Rivals = window.NeonRivals;
  if (!canvas || !C) return;
  const ctx = canvas.getContext('2d');
  const W = 640, CELL = W / C.N, R = CELL * .36;
  const COLORS = ['#cffb4b', '#ff4f8c'];
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', ROOM_TTL = 24 * 60 * 60;
  const REACTIONS = ['NICE MOVE!', 'UNLUCKY', 'GOOD GAME', 'REMATCH?', 'HURRY UP 😅', '🔥', '😂', '👏'];
  // Each online game's invite parameter, so a code typed into the wrong game opens the right one.
  const INVITES = { pool: 'room', lineup: 'lineup', gomoku: 'gomoku', checkers: 'checkers' };

  // Same browser player id as the pool rooms, so rivals line up across games.
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
  const stored = (key, fallback) => { try { return localStorage[key] ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage[key] = value; } catch {} };

  let mode = 'cpu', state = C.newGame(0), level = C.LEVELS[stored('neonCheckersCpu', 'medium')] ? stored('neonCheckersCpu', 'medium') : 'medium';
  let revealAt = 0; // the result screen waits a moment so the final position can be seen
  // selected: { from, path } while a piece is picked up (path holds the jump squares chosen so far); cursor: keyboard square
  let selected = null, cursor = C.at(1, 5), cursorShown = false, anim = null, cpuTimer = 0, lastCounted = '', online = null; // online: { code, seat, seq, room, sub, poll, pending, sending, reactionAt, lastReaction, invitee }

  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  const names = () => {
    if (mode === 'online' && online?.room) return [clean(online.room.hostName), clean(online.room.guestName) || 'WAITING…'];
    if (mode === 'cpu') return ['YOU', `CPU · ${level.toUpperCase()}`];
    return ['PLAYER 1', 'PLAYER 2'];
  };
  const say = (text) => text.replace(/PLAYER ([12])/g, (_, seat) => names()[seat - 1]).replace('YOU WINS', 'YOU WIN');
  const mySeat = () => (mode === 'online' ? online?.seat : mode === 'cpu' ? 0 : state.turn);
  const over = () => state.winner !== null || state.draw;
  const myTurn = () => mode === 'local' || (mode === 'cpu' ? state.turn === 0 : online?.room?.status === 'playing' && online.seat === state.turn);
  const canMove = () => !anim && !over() && myTurn() && !(mode === 'online' && (!online?.room || online.sending));
  const parse = (text) => { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; } };
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'checkers', { mode, ...(mode === 'cpu' ? { difficulty: level } : {}), ...details });
  // Online, the guest sees the board turned round so their pieces start at the bottom.
  const flipped = () => mode === 'online' && online?.seat === 1;

  // ---------- moves the player can make from the current selection ----------
  const legal = () => C.legalMoves(state.board, state.turn);
  const movable = () => new Set(legal().map((move) => move.from));
  const startsWith = (move, path) => path.every((square, i) => move.path[i] === square);
  const candidates = () => (selected ? legal().filter((move) => move.from === selected.from && startsWith(move, selected.path)) : []);
  // Squares worth highlighting: the next landing square of each move, and where each move finally ends.
  function targets() {
    const out = new Map();
    for (const move of candidates()) {
      const end = move.path[move.path.length - 1];
      out.set(move.path[selected.path.length], 'step');
      if (move.path.length > selected.path.length + 1 && !out.has(end)) out.set(end, 'end');
    }
    return out;
  }

  // ---------- rendering ----------
  const point = (index) => {
    const col = flipped() ? C.N - 1 - C.colOf(index) : C.colOf(index), row = flipped() ? C.N - 1 - C.rowOf(index) : C.rowOf(index);
    return { x: (col + .5) * CELL, y: (row + .5) * CELL };
  };
  function piece(x, y, value, alpha = 1, lift = 0) {
    const seat = C.seatOf(value), color = COLORS[seat];
    ctx.globalAlpha = alpha;
    if (lift) { ctx.beginPath(); ctx.ellipse(x + lift * .4, y + lift * .8, R, R * .9, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000066'; ctx.fill(); }
    y -= lift;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x, y, R * .7, 0, Math.PI * 2); ctx.strokeStyle = '#0b151744'; ctx.lineWidth = 3; ctx.stroke();
    if (C.isKing(value)) {
      // a small crown
      const s = R * .42; ctx.fillStyle = '#0b1517';
      ctx.beginPath(); ctx.moveTo(x - s, y + s * .55); ctx.lineTo(x - s, y - s * .45); ctx.lineTo(x - s * .5, y + s * .05); ctx.lineTo(x, y - s * .7); ctx.lineTo(x + s * .5, y + s * .05); ctx.lineTo(x + s, y - s * .45); ctx.lineTo(x + s, y + s * .55); ctx.closePath(); ctx.fill();
    } else { ctx.beginPath(); ctx.arc(x - R * .3, y - R * .3, R * .28, 0, Math.PI * 2); ctx.fillStyle = '#ffffff55'; ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function square(index, fill) { const { x, y } = point(index); ctx.fillStyle = fill; ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL); }
  function ring(index, color, width = 3, inset = 4) { const { x, y } = point(index); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(x - CELL / 2 + inset, y - CELL / 2 + inset, CELL - inset * 2, CELL - inset * 2); }

  function draw() {
    ctx.fillStyle = '#0b1517'; ctx.fillRect(0, 0, W, W);
    for (let index = 0; index < C.SIZE; index += 1) if (C.isDark(index)) square(index, '#16343a');
    // the last move: where it came from and where it landed
    if (state.last && !anim) [state.last.from, ...state.last.path].forEach((index) => square(index, '#1f4c50'));
    const playable = canMove();
    if (playable && !selected) for (const index of movable()) ring(index, '#cffb4b55', 2, 3);
    if (playable && selected) {
      ring(selected.from, '#f7faee', 3, 3);
      selected.path.forEach((index) => square(index, '#2a6366'));
      for (const [index, kind] of targets()) {
        const { x, y } = point(index);
        ctx.beginPath(); ctx.arc(x, y, kind === 'step' ? CELL * .14 : CELL * .1, 0, Math.PI * 2);
        ctx.fillStyle = kind === 'step' ? '#f7faee' : '#f7faee66'; ctx.fill();
      }
    }
    for (let index = 0; index < C.SIZE; index += 1) {
      const value = state.board[index];
      if (value === '.' || anim?.from === index || (selected && selected.from === index && playable)) continue;
      const fading = anim?.gone.includes(index);
      const { x, y } = point(index); piece(x, y, value, fading ? .25 : 1);
    }
    if (selected && playable) {
      const value = state.board[selected.from], at = point(selected.path.length ? selected.path[selected.path.length - 1] : selected.from);
      if (selected.path.length) { const home = point(selected.from); piece(home.x, home.y, value, .25); }
      piece(at.x, at.y, value, 1, 6);
    }
    if (anim) piece(anim.x, anim.y, anim.value, 1, anim.lift);
    if (cursorShown && playable) ring(cursor, '#f7faee', 2, 1);
    ctx.strokeStyle = '#cffb4b'; ctx.lineWidth = 3; ctx.shadowColor = '#cffb4b'; ctx.shadowBlur = 10; ctx.strokeRect(1.5, 1.5, W - 3, W - 3); ctx.shadowBlur = 0;
  }

  function render() {
    draw();
    const [p1, p2] = names(), match = state.match || [0, 0], count = (seat) => [...state.board].filter((value) => C.seatOf(value) === seat).length;
    $('#ck-p1-name').textContent = p1; $('#ck-p2-name').textContent = p2;
    $('#ck-p1-info').textContent = `${count(0)} LEFT · ${match[0]} WON`; $('#ck-p2-info').textContent = `${match[1]} WON · ${count(1)} LEFT`;
    $('#ck-p1').classList.toggle('active', !over() && state.turn === 0); $('#ck-p2').classList.toggle('active', !over() && state.turn === 1);
    let status = say(state.message);
    if (mode === 'online' && !online) status = 'CREATE A PRIVATE ROOM, OR JOIN ONE WITH A CODE →';
    else if (mode === 'online' && online.room.status === 'waiting') status = `WAITING FOR AN OPPONENT — SHARE CODE ${online.code}`;
    else if (mode === 'online' && !over()) status += myTurn() ? ' · YOUR MOVE' : ' · OPPONENT IS THINKING';
    if (mode === 'cpu' && state.turn === 1 && !over()) status += ' · CPU IS THINKING…';
    if (canMove() && !selected && legal()[0]?.captures.length) status += ' · YOU MUST JUMP';
    if (canMove() && selected?.path.length) status += ' · KEEP JUMPING';
    $('#ck-status').textContent = status;
    $$('[data-ck-mode]').forEach((button) => button.classList.toggle('active', button.dataset.ckMode === mode));
    $('#ck-levels').hidden = mode !== 'cpu';
    $$('[data-ck-level]').forEach((button) => button.classList.toggle('active', button.dataset.ckLevel === level));
    $('#ck-restart').hidden = mode === 'online';
    showOverlay(); renderRoom(); renderRecord();
  }

  function showOverlay() {
    const overlay = $('#ck-overlay'), title = $('#ck-title'), message = $('#ck-message');
    $('#ck-intro-actions').hidden = true; $('#ck-end-actions').hidden = true; $('#ck-wait-actions').hidden = true;
    if (over() && !anim && performance.now() < revealAt) { overlay.hidden = true; return; }
    if (over() && !anim) {
      $('#ck-eyebrow').textContent = state.draw ? 'NO PROGRESS' : 'GAME OVER';
      overlay.hidden = false; $('#ck-end-actions').hidden = false;
      const won = state.winner === mySeat(), match = state.match || [0, 0];
      title.textContent = state.draw ? 'DRAW' : mode === 'local' ? `${names()[state.winner]} WINS` : won ? 'YOU WIN!' : mode === 'cpu' ? 'CPU WINS' : 'YOU LOSE';
      const loser = 1 - state.winner, you = !state.draw && mode !== 'local' && loser === mySeat(), blocked = [...state.board].some((value) => C.seatOf(value) === loser);
      const how = state.draw ? '40 moves each with no capture and no ordinary piece moving.' : you ? (blocked ? 'You have no move left.' : 'All your pieces were taken.') : blocked ? `${names()[loser]} has no move left.` : `Every one of ${names()[loser]}'s pieces was taken.`;
      message.textContent = `${how} Match: ${names()[0]} ${match[0]} – ${match[1]} ${names()[1]}.`;
      $('#ck-again').innerHTML = mode === 'online' ? 'REMATCH <b>→</b>' : 'NEXT GAME <b>→</b>';
      $('#ck-change-mode').hidden = mode === 'online';
    } else if (mode === 'online' && online?.room.status === 'waiting') {
      overlay.hidden = false; $('#ck-wait-actions').hidden = false; $('#ck-eyebrow').textContent = 'WAITING FOR A PLAYER';
      title.textContent = online.invitee ? `REMATCH VS ${online.invitee}` : 'ROOM OPEN';
      message.textContent = `Send ${online.invitee || 'your opponent'} the invite link or room code ${online.code}. The game starts as soon as they join.`;
    } else if (overlay.dataset.intro === 'true') {
      overlay.hidden = false; $('#ck-intro-actions').hidden = false; $('#ck-eyebrow').textContent = 'TWELVE PIECES EACH';
      title.textContent = 'CHECKERS'; message.textContent = 'Move diagonally and jump over your opponent\'s pieces to take them. Jumps are compulsory. Reach the far side to crown a king. Take every piece — or leave them no move — to win.';
    } else overlay.hidden = true;
  }

  // ---------- moves ----------
  // Slide the piece square by square, hopping over each piece it takes, then apply the move.
  function animateMove(move, next, after) {
    const value = state.board[move.from], stops = [move.from, ...move.path], hop = move.captures.length ? 200 : 170;
    selected = null; cursorShown = false;
    anim = { from: move.from, value, gone: [], x: point(move.from).x, y: point(move.from).y, lift: 0 };
    const start = performance.now();
    render();
    const step = (time) => {
      const leg = Math.min(stops.length - 1, Math.floor((time - start) / hop)), t = Math.min(1, (time - start) / hop - leg);
      if (time - start >= hop * (stops.length - 1)) {
        anim = null; state = next; render();
        if (next.board[stops[stops.length - 1]] !== value) Sound?.turn(); // crowned
        after?.(); return;
      }
      const a = point(stops[leg]), b = point(stops[leg + 1]), ease = t * (2 - t);
      anim.x = a.x + (b.x - a.x) * ease; anim.y = a.y + (b.y - a.y) * ease;
      anim.lift = move.captures.length ? Math.sin(t * Math.PI) * 14 : 4;
      if (move.captures.length && t > .5 && !anim.gone.includes(move.captures[leg])) { anim.gone.push(move.captures[leg]); Sound?.click(1100); }
      if (!move.captures.length && anim.ticked !== true && t > .8) { anim.ticked = true; Sound?.click(700); }
      draw(); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function afterMove(previous) {
    if (over()) { gameOver(); return; }
    if (mode === 'online' && state.turn === online.seat && previous.turn !== online.seat) yourTurn('Your move!');
    maybeCpu();
  }

  async function play(move) {
    if (!canMove()) return;
    const previous = state, next = C.play(state, move);
    if (!next) return;
    Sound?.unlock();
    if (previous.moves === 0) track('game_started', {});
    if (mode !== 'online') { animateMove(move, next, () => afterMove(previous)); return; }
    const seq = online.seq + 1;
    online.seq = seq; online.sending = true;
    animateMove(move, next, () => afterMove(previous));
    try { await saveRoom({ seq, state: JSON.stringify(next), shot: JSON.stringify({ from: move.from, path: move.path, seq, by: online.seat }), status: next.winner !== null || next.draw ? 'finished' : 'playing' }); }
    catch { $('#ck-notice').textContent = 'MOVE DID NOT SYNC. RELOADING THE BOARD…'; await refreshRoom(true); }
    finally { online.sending = false; if (!anim) render(); }
  }

  // Tap a piece to pick it up, then tap where it goes. A multi-jump can be tapped one landing at a time, or by
  // tapping the final square straight away when only one route ends there.
  function choose(index) {
    if (!canMove()) return;
    const moves = legal();
    if (!selected) {
      if (moves.some((move) => move.from === index)) { selected = { from: index, path: [] }; Sound?.unlock(); Sound?.click(500); render(); return; }
      render();
      // a piece of yours that can't move while a jump is available elsewhere
      if (C.seatOf(state.board[index]) === state.turn && moves[0]?.captures.length) $('#ck-status').textContent = 'A JUMP IS AVAILABLE — YOU MUST TAKE IT';
      return;
    }
    const options = candidates();
    const stepping = options.filter((move) => move.path[selected.path.length] === index);
    if (stepping.length) {
      const path = [...selected.path, index], done = stepping.find((move) => move.path.length === path.length);
      if (done) { play(done); return; }
      selected = { from: selected.from, path }; Sound?.click(600); render(); return;
    }
    const ending = options.filter((move) => move.path[move.path.length - 1] === index);
    if (ending.length === 1) { play(ending[0]); return; }
    // tap the piece again to put it down, or a square already jumped to to back up to there
    if (index === selected.from) { selected = null; render(); return; }
    if (selected.path.includes(index)) { selected = { from: selected.from, path: selected.path.slice(0, selected.path.indexOf(index) + 1) }; render(); return; }
    // tapping another of your movable pieces switches to it
    selected = !selected.path.length && moves.some((move) => move.from === index) ? { from: index, path: [] } : selected.path.length ? selected : null; render();
  }

  function maybeCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
    cpuTimer = setTimeout(() => {
      if (mode !== 'cpu' || state.turn !== 1 || over() || anim) return;
      const move = C.chooseMove(state, level), previous = state;
      animateMove(move, C.play(state, move), () => afterMove(previous));
    }, 450);
  }

  function gameOver() {
    const won = state.winner === mySeat();
    revealAt = performance.now() + 1200; setTimeout(render, 1250);
    if (state.draw) Sound?.turn(); else if (mode === 'local' || won) Sound?.win(); else Sound?.lose();
    const key = `${mode}:${online?.code || ''}:${(state.match || []).join()}:${state.moves}:${state.board}`;
    if (key !== lastCounted && !state.draw) {
      lastCounted = key;
      const record = loadRecord();
      if (mode === 'cpu') { record.cpu[level][won ? 0 : 1] += 1; saveRecord(record); }
      if (mode === 'online') {
        record.online[won ? 0 : 1] += 1; saveRecord(record);
        const rival = opponent(); if (rival.id) Rivals?.record('checkers', { ...rival, won });
        if (document.hidden) notify(won ? 'You won at Checkers! 🏆' : 'Your opponent won at Checkers.');
      }
      track('game_finished', { outcome: mode === 'local' ? `player_${state.winner + 1}` : won ? 'won' : 'lost', moves: state.moves });
    } else if (state.draw && key !== lastCounted) { lastCounted = key; track('game_finished', { outcome: 'draw', moves: state.moves }); }
    render();
  }
  // Loser starts the next game; after a draw the other player starts.
  const nextStarter = () => (state.draw ? 1 - (state.starter ?? 0) : 1 - state.winner);

  // ---------- records (this device) ----------
  function loadRecord() {
    const saved = parse(stored('neonCheckersRecord', '')) || {};
    return { cpu: { easy: [0, 0], medium: [0, 0], hard: [0, 0], ...(saved.cpu || {}) }, online: saved.online || [0, 0] };
  }
  function saveRecord(record) { store('neonCheckersRecord', JSON.stringify(record)); }
  function renderRecord() {
    const record = loadRecord(), list = $('#ck-record'); list.replaceChildren();
    [['VS CPU · EASY', record.cpu.easy], ['VS CPU · MEDIUM', record.cpu.medium], ['VS CPU · HARD', record.cpu.hard], ['ONLINE', record.online]].forEach(([label, [w, l]]) => {
      const item = document.createElement('li'), name = document.createElement('span'), score = document.createElement('b');
      name.textContent = label; score.textContent = `${w}W – ${l}L`; item.append(name, score); list.append(item);
    });
    Rivals?.render('checkers', $('#ck-rivals'), (rival) => { begin('online'); createRoom(rival); });
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
    const options = { body, tag: `checkers-${online?.code || 'game'}` };
    navigator.serviceWorker?.getRegistration?.().then((registration) => registration ? registration.showNotification('Checkers', options) : new Notification('Checkers', options)).catch(() => { try { new Notification('Checkers', options); } catch {} });
  }
  function yourTurn(message) { Sound?.turn(); notify(message); }

  // ---------- online rooms (shared PoolRoom table, marked game: 'checkers') ----------
  const rooms = () => window.neonDataClient?.models?.PoolRoom;
  const failIf = (errors) => { if (errors?.length) throw new Error(errors.map((error) => error.message).join(' ')); };
  const expiry = () => Math.floor(Date.now() / 1000) + ROOM_TTL;
  const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('');
  function inviteLink(code) { const url = new URL(location.href); url.search = `?checkers=${code}`; url.hash = ''; return url.toString(); }
  function setConnection(text, live) { const badge = $('#ck-connection'); badge.textContent = `● ${text}`; badge.classList.toggle('offline', !live); }
  function opponent() { const room = online?.room; if (!room) return {}; return online.seat === 0 ? { id: room.guestId, name: room.guestName } : { id: room.hostId, name: room.hostName }; }
  function announceRival() { const rival = opponent(); if (rival.id && Rivals) showToast(Rivals.summary('checkers', rival.id, rival.name), true); }

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
      // replay the opponent's move only if it's legal from the position we have; otherwise just take their board
      const move = shot && shot.seq === room.seq && room.seq === online.seq + 1 && shot.by !== online.seat && Array.isArray(shot.path) ? C.legalMoves(state.board, state.turn).find((candidate) => candidate.from === shot.from && candidate.path.join() === shot.path.join()) : null;
      online.seq = room.seq;
      if (remote && move) { const previous = state; selected = null; animateMove(move, remote, () => { afterMove(previous); flushPending(); }); return; }
      if (remote) {
        state = remote; selected = null; render();
        if (over()) gameOver();
        else if (wasWaiting && room.status === 'playing') { $('#ck-notice').textContent = `${clean(room.guestName)} JOINED.`; yourTurn(`${clean(room.guestName)} joined. You go first!`); announceRival(); }
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
    mode = 'online'; selected = null;
    online = { code: room.code, seat, seq: room.seq, room, sub: null, poll: 0, pending: null, sending: false, reactionAt: parse(room.reaction)?.at || 0, lastReaction: 0, invitee: null };
    $('#ck-overlay').dataset.intro = 'false';
    history.replaceState(null, '', inviteLink(room.code));
    try { online.sub = rooms().onUpdate({ filter: { code: { eq: room.code } } }).subscribe({ next: handleRoom, error: () => setConnection('POLLING', false) }); setConnection('LIVE', true); }
    catch { setConnection('POLLING', false); }
    online.poll = setInterval(() => refreshRoom(), 4000);
    state = parse(room.state) || C.newGame(0); render();
  }
  function leaveRoom(reset = true) {
    if (online) { online.sub?.unsubscribe?.(); clearInterval(online.poll); }
    online = null; anim = null;
    if (!reset) return;
    setConnection('OFFLINE', false);
    const url = new URL(location.href); url.searchParams.delete('checkers'); history.replaceState(null, '', url);
  }
  function playerName() { const name = clean($('#ck-name').value); if (name) store('neonPoolName', name); return name; }
  function needsClient() { if (rooms()) return false; $('#ck-notice').textContent = 'CONNECTING TO THE GAME NETWORK… TRY AGAIN IN A MOMENT.'; return true; }

  async function createRoom(invitee = null) {
    const name = playerName(), notice = $('#ck-notice');
    if (!name) { notice.textContent = invitee ? 'ENTER YOUR CALLSIGN, THEN TAP REMATCH AGAIN.' : 'ENTER A CALLSIGN FIRST.'; $('#ck-name').focus(); return; }
    if (needsClient()) return;
    notice.textContent = 'OPENING A PRIVATE ROOM…';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { data, errors } = await rooms().create({ code: roomCode(), game: 'checkers', hostId: me, hostName: name, status: 'waiting', seq: 1, state: JSON.stringify(C.newGame(0)), expiresAt: expiry() });
        failIf(errors);
        notice.textContent = invitee ? `ROOM READY. SEND ${invitee.name} THE INVITE.` : 'ROOM READY. SEND THE INVITE LINK.';
        enterRoom(data, 0); online.invitee = invitee?.name || null; render(); track('room_created', { rematch: Boolean(invitee) }); return;
      } catch { /* code taken or a network blip: try another */ }
    }
    notice.textContent = 'COULD NOT OPEN A ROOM. CHECK YOUR CONNECTION.';
  }

  async function joinRoom(rawCode = $('#ck-code').value) {
    const code = String(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), notice = $('#ck-notice');
    if (code.length !== 5) { notice.textContent = 'ROOM CODES ARE 5 CHARACTERS.'; return; }
    if (needsClient()) return;
    notice.textContent = `LOOKING FOR ROOM ${code}…`;
    try {
      const room = await fetchRoom(code);
      if (!room) { notice.textContent = `ROOM ${code} NOT FOUND OR EXPIRED.`; return; }
      // The online games share room codes; send another game's code to that game (rooms with no game are pool).
      if (room.game !== 'checkers') { location.search = `?${INVITES[room.game] || 'room'}=${code}`; return; }
      if (room.hostId === me) { notice.textContent = 'BACK IN YOUR ROOM.'; enterRoom(room, 0); return; }
      if (room.guestId === me) { notice.textContent = 'BACK IN THE GAME.'; enterRoom(room, 1); return; }
      if (room.guestId) { notice.textContent = 'THAT ROOM ALREADY HAS TWO PLAYERS.'; return; }
      const name = playerName();
      if (!name) { notice.textContent = 'ENTER A CALLSIGN, THEN JOIN.'; $('#ck-name').focus(); return; }
      const { errors } = await rooms().update({ code, guestId: me, guestName: name, status: 'playing', seq: room.seq + 1, expiresAt: expiry() });
      failIf(errors);
      const joined = await fetchRoom(code);
      if (joined?.guestId !== me) { notice.textContent = 'SOMEONE ELSE TOOK THAT SEAT.'; return; }
      notice.textContent = `JOINED ${clean(joined.hostName)}'S GAME.`; enterRoom(joined, 1); announceRival(); track('room_joined');
    } catch { notice.textContent = 'COULD NOT REACH THE ROOM. TRY AGAIN.'; }
  }

  async function rematch() {
    if (!online || online.sending) return;
    const next = C.newGame(nextStarter(), state.match), seq = online.seq + 1;
    online.seq = seq; online.sending = true; state = next; selected = null; render();
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
  function showToast(text, mine) { const toast = $('#ck-toast'); toast.textContent = text; toast.classList.toggle('mine', mine); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200); }

  function renderRoom() {
    const inRoom = mode === 'online' && online?.room;
    $('#ck-lobby').hidden = Boolean(inRoom); $('#ck-room').hidden = !inRoom;
    if (!inRoom) return;
    $('#ck-room-code').textContent = online.code;
    $('#ck-reactions').hidden = online.room.status === 'waiting';
    const rival = opponent(); $('#ck-h2h').textContent = rival.id && Rivals ? Rivals.summary('checkers', rival.id, rival.name) : '';
    const seats = $('#ck-seats'); seats.replaceChildren();
    [[online.room.hostName, 0], [online.room.guestName, 1]].forEach(([name, seat]) => {
      const item = document.createElement('li'), who = document.createElement('b'), role = document.createElement('span');
      who.textContent = name ? `${clean(name)} · ${(state.match || [0, 0])[seat]}` : 'OPEN SEAT'; who.style.color = name ? seat === 0 ? '#5f8d12' : '#d1336d' : '';
      role.textContent = [seat === online.seat ? 'YOU' : '', !over() && name && state.turn === seat && online.room.status !== 'waiting' ? 'TO MOVE' : ''].filter(Boolean).join(' · ') || (seat === 0 ? 'HOST' : 'GUEST');
      item.append(who, role); seats.append(item);
    });
    const alerts = $('#ck-alerts'); alerts.hidden = !('Notification' in window);
    if (!alerts.hidden) alerts.textContent = Notification.permission === 'granted' ? '🔔 TURN ALERTS ON' : Notification.permission === 'denied' ? '🔕 ALERTS BLOCKED IN BROWSER' : '🔔 TURN ON TURN ALERTS';
  }

  // ---------- modes ----------
  function begin(nextMode) {
    $('#ck-overlay').dataset.intro = 'false'; clearTimeout(cpuTimer); selected = null; cursorShown = false;
    if (nextMode === 'online') { if (mode === 'online' && online) { render(); return; } leaveRoom(true); mode = 'online'; state = C.newGame(0); render(); $('#ck-name').focus(); return; }
    leaveRoom(true); mode = nextMode; state = C.newGame(0); Sound?.unlock(); render(); track('mode_selected', {});
  }
  function nextGame() {
    selected = null;
    if (mode === 'online') { rematch(); return; }
    state = C.newGame(nextStarter(), state.match); render(); maybeCpu();
  }

  // ---------- input ----------
  function squareAt(event) {
    const rect = canvas.getBoundingClientRect(), scale = W / rect.width;
    let col = Math.floor(((event.clientX - rect.left) * scale) / CELL), row = Math.floor(((event.clientY - rect.top) * scale) / CELL);
    col = Math.max(0, Math.min(C.N - 1, col)); row = Math.max(0, Math.min(C.N - 1, row));
    return flipped() ? C.at(C.N - 1 - col, C.N - 1 - row) : C.at(col, row);
  }
  canvas.addEventListener('pointerup', (event) => { cursorShown = false; choose(squareAt(event)); });
  addEventListener('keydown', (event) => {
    if ($('#checkers-game').hidden || event.target.matches('input,textarea')) return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.code];
    if (moves) {
      event.preventDefault();
      const [dc, dr] = flipped() ? [-moves[0], -moves[1]] : moves;
      const col = Math.max(0, Math.min(C.N - 1, C.colOf(cursor) + (cursorShown ? dc : 0))), row = Math.max(0, Math.min(C.N - 1, C.rowOf(cursor) + (cursorShown ? dr : 0)));
      cursor = C.at(col, row); cursorShown = true; draw();
    }
    if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); if (cursorShown) choose(cursor); else { cursorShown = true; draw(); } }
    if (event.code === 'Escape' && selected) { selected = null; render(); }
  });

  $$('[data-ck-begin]').forEach((button) => button.addEventListener('click', () => begin(button.dataset.ckBegin)));
  $$('[data-ck-mode]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.ckMode !== mode || $('#ck-overlay').dataset.intro === 'true') begin(button.dataset.ckMode); }));
  $$('[data-ck-level]').forEach((button) => button.addEventListener('click', () => { level = button.dataset.ckLevel; store('neonCheckersCpu', level); track('difficulty_selected', {}); render(); }));
  $('#ck-again').addEventListener('click', nextGame);
  $('#ck-change-mode').addEventListener('click', () => { $('#ck-overlay').dataset.intro = 'true'; clearTimeout(cpuTimer); state = C.newGame(0); render(); });
  $('#ck-restart').addEventListener('click', () => { if (mode !== 'online') { clearTimeout(cpuTimer); anim = null; selected = null; state = C.newGame(state.starter ?? 0, state.match); render(); maybeCpu(); } });
  $('#ck-mute').addEventListener('click', () => { Sound?.setMuted(!Sound.muted); renderMute(); if (!Sound?.muted) Sound?.turn(); });
  function renderMute() { const button = $('#ck-mute'); button.textContent = Sound?.muted ? '🔇' : '🔊'; button.setAttribute('aria-label', Sound?.muted ? 'Turn sound on' : 'Turn sound off'); }
  $('#ck-help-button').addEventListener('click', () => { $('#ck-help').hidden = !$('#ck-help').hidden; });
  $('#ck-help-close').addEventListener('click', () => { $('#ck-help').hidden = true; });
  $('#ck-create').addEventListener('click', () => createRoom());
  $('#ck-join').addEventListener('click', () => joinRoom());
  $('#ck-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#ck-leave').addEventListener('click', () => { leaveRoom(true); mode = 'online'; state = C.newGame(0); selected = null; render(); $('#ck-notice').textContent = 'YOU LEFT THE ROOM. USE THE CODE TO REJOIN.'; });
  async function share() {
    const link = inviteLink(online.code);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'Checkers', text: `${online.invitee ? 'Rematch? ' : ''}Join my Checkers game (room ${online.code})`, url: link }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); $('#ck-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#ck-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  }
  $('#ck-copy').addEventListener('click', share); $('#ck-overlay-copy').addEventListener('click', share);
  $('#ck-alerts').addEventListener('click', async () => { if ('Notification' in window && Notification.permission === 'default') { await Notification.requestPermission(); render(); } });
  REACTIONS.forEach((text) => { const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', () => react(text)); $('#ck-reactions').append(button); });

  $('#ck-name').value = stored('neonPoolName', '');
  setConnection('OFFLINE', false); renderMute(); render();

  // Invite links (?checkers=CODE) open Checkers and join straight away.
  const invited = new URLSearchParams(location.search).get('checkers');
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="checkers"]')?.click();
    $('#ck-code').value = invited.toUpperCase(); $('#ck-overlay').dataset.intro = 'false'; mode = 'online'; render();
    const tryJoin = () => { if (rooms()) joinRoom(invited); };
    if (rooms()) tryJoin(); else { $('#ck-notice').textContent = 'CONNECTING TO YOUR INVITE…'; addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
