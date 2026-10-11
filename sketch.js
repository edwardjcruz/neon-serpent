// Neon Sketch: draw-and-guess for up to 10 players. The sketch-game function runs the rooms (turns, the secret word,
// guesses, scores); this file draws, sends the drawer's pen strokes, and shows chat, players and the timer.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const canvas = $('#sk-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 800, H = 600, BG = '#0b1517';
  const COLORS = ['#f7faee', '#cffb4b', '#68d8ff', '#ff4f8c', '#ffd23f', '#ff8c42', '#2fd27a', '#a66bff', '#ff4d4d', '#8a6a4f', '#7b8986', '#142226'];
  const SIZES = [4, 10, 22];
  const Sound = window.NeonPoolSound;
  const client = () => window.neonDataClient;
  const ready = () => Boolean(client()?.mutations?.sketchCreate);
  const stored = (key, fallback) => { try { return localStorage[key] ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage[key] = value; } catch {} };
  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
  const parse = (value) => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
  const track = (event, details = {}) => window.trackGameEvent?.(event, 'neon_sketch', details);

  // game: { code, key, room, players: Map, chat: [], ops: [], subs: [], poll, word, options, guessed }
  let game = null, offset = 0, lastTick = 0, ticksDone = new Set();
  let pen = { color: COLORS[1], size: SIZES[1], erase: false }, drawing = null, outbox = [], flushTimer = 0, drawQueued = false;

  // ---------- server calls ----------
  async function call(op, args) {
    const { data, errors } = await client().mutations[op](args);
    if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
    const reply = parse(data) || {};
    if (reply.now) offset = reply.now - Date.now();
    return reply;
  }
  const serverNow = () => Date.now() + offset;
  const room = () => game?.room;
  const me = () => game?.players.get(game.key);
  const iDraw = () => room() && room().drawerKey === game.key;
  const guessedThisTurn = () => me()?.guessedTurn === room()?.turnId;
  const notice = (text) => { $('#sk-notice').textContent = text; };
  const ERRORS = { NAME: 'ENTER A CALLSIGN FIRST.', NO_ROOM: 'ROOM NOT FOUND OR EXPIRED.', FULL: 'THAT ROOM IS FULL (10 PLAYERS).', NOT_HOST: 'ONLY THE HOST CAN START.', NEED_PLAYERS: 'YOU NEED AT LEAST 2 PLAYERS.', SERVER: 'SOMETHING WENT WRONG. TRY AGAIN.' };

  // ---------- drawing ----------
  // Strokes arrive as batches: { t: 's', id, c, w, p: [x, y, x, y…] } plus { t: 'clear' } and { t: 'undo' }.
  function paint() {
    drawQueued = false;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const strokes = new Map(), order = [];
    for (const op of game?.ops || []) {
      if (op.t === 'clear') { strokes.clear(); order.length = 0; }
      else if (op.t === 'undo') { const last = order.pop(); if (last) strokes.delete(last); }
      else if (op.t === 's') { let stroke = strokes.get(op.id); if (!stroke) { stroke = { c: op.c, w: op.w, p: [] }; strokes.set(op.id, stroke); order.push(op.id); } stroke.p.push(...op.p); }
    }
    if (drawing) { if (!strokes.has(drawing.id)) { strokes.set(drawing.id, { c: drawing.c, w: drawing.w, p: [] }); order.push(drawing.id); } strokes.get(drawing.id).p.push(...drawing.pending); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const id of order) {
      const { c, w, p } = strokes.get(id);
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w;
      if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], w / 2, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
  }
  const repaint = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(paint); } };

  function addOp(sid, op) {
    if (!game || !op) return;
    if (game.ops.some((existing) => existing.sid === sid)) return;
    op.sid = sid; game.ops.push(op);
    // batches can arrive out of order; keep them sorted by their id so every screen draws the same picture
    if (game.ops.length > 1 && game.ops[game.ops.length - 2].sid > sid) game.ops.sort((a, b) => (a.sid < b.sid ? -1 : 1));
    repaint();
  }
  function onStroke(item) {
    if (!game || item.roomCode !== game.code || item.turnId !== room().turnId || item.by !== room().drawerKey || item.by === game.key) return;
    addOp(item.sid, parse(item.data));
  }

  // The drawer's own strokes are drawn at once and sent in small batches.
  function send(op) {
    const sid = `${room().turnId}:${String(serverNow()).padStart(14, '0')}-${Math.random().toString(36).slice(2, 6)}`;
    addOp(sid, op);
    client().models.SketchStroke.create({ roomCode: game.code, sid, turnId: room().turnId, by: game.key, data: JSON.stringify(op), expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600 }).catch(() => notice('A STROKE DID NOT SEND — CHECK YOUR CONNECTION.'));
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = 0;
    if (!drawing || !drawing.pending.length) return;
    send({ t: 's', id: drawing.id, c: drawing.c, w: drawing.w, p: drawing.pending });
    drawing.pending = drawing.pending.slice(-2); // the next batch starts where this one ended, so lines join up
  }
  const canDraw = () => iDraw() && room().status === 'drawing';
  function point(event) { const rect = canvas.getBoundingClientRect(); return [Math.round((event.clientX - rect.left) * W / rect.width), Math.round((event.clientY - rect.top) * H / rect.height)]; }
  canvas.addEventListener('pointerdown', (event) => {
    if (!canDraw()) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    drawing = { id: Math.random().toString(36).slice(2, 9), c: pen.erase ? BG : pen.color, w: pen.erase ? SIZES[2] + 10 : pen.size, pending: point(event) };
    repaint(); flushTimer = setTimeout(flush, 90);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const [x, y] = point(event), p = drawing.pending;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 2) return;
    p.push(x, y); repaint();
    if (!flushTimer) flushTimer = setTimeout(flush, 90);
  });
  const endStroke = () => { if (!drawing) return; flush(); drawing = null; repaint(); };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);

  // ---------- rendering the room ----------
  function render() {
    const r = room(), inRoom = Boolean(r);
    $('#sk-lobby').hidden = inRoom; $('#sk-room').hidden = !inRoom;
    $('#sk-tools').hidden = !(inRoom && canDraw());
    $('#sk-guess-form').hidden = !inRoom;
    canvas.classList.toggle('can-draw', Boolean(inRoom && canDraw()));
    renderBar(); renderPlayers(); renderOverlay();
    const input = $('#sk-guess');
    input.placeholder = !inRoom ? '' : r.status === 'drawing' && !iDraw() && !guessedThisTurn() ? 'TYPE YOUR GUESS…' : 'CHAT…';
  }
  function renderBar() {
    const r = room();
    $('#sk-round').textContent = r && r.round ? `ROUND ${r.round}/${r.rounds}` : 'LOBBY';
    const word = $('#sk-word');
    if (!r || !['choosing', 'drawing', 'reveal'].includes(r.status)) word.textContent = r ? 'WAITING' : 'NEON SKETCH';
    else if (r.status === 'choosing') word.textContent = iDraw() ? 'CHOOSE A WORD' : `${r.drawerName} IS CHOOSING`;
    else if (r.status === 'reveal') word.textContent = r.lastWord.toUpperCase();
    else if (iDraw() || guessedThisTurn()) word.textContent = (game.word || r.mask).toUpperCase();
    else word.textContent = r.mask.toUpperCase();
    word.classList.toggle('masked', r?.status === 'drawing' && !iDraw() && !guessedThisTurn());
    const letters = r?.mask ? r.mask.replace(/[^_a-z0-9]/gi, '').length : 0;
    $('#sk-letters').textContent = r?.status === 'drawing' ? `${letters} LETTERS` : '';
  }
  function renderTimer() {
    const r = room(), timer = $('#sk-timer');
    if (!r || !['choosing', 'drawing', 'reveal'].includes(r.status)) { timer.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((r.turnEndsAt - serverNow()) / 1000));
    timer.textContent = r.status === 'reveal' ? '' : `${left}s`;
    timer.classList.toggle('low', r.status === 'drawing' && left <= 10);
  }
  function renderPlayers() {
    const r = room(), list = $('#sk-players'); list.replaceChildren();
    if (!r) return;
    const sorted = [...game.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    sorted.forEach((player, index) => {
      const item = document.createElement('li'), rank = document.createElement('i'), who = document.createElement('span'), name = document.createElement('b'), tags = document.createElement('small'), score = document.createElement('strong');
      rank.textContent = `#${index + 1}`; name.textContent = player.name; score.textContent = player.score;
      tags.textContent = [player.playerKey === game.key ? 'YOU' : '', player.playerKey === r.hostKey ? 'HOST' : '', player.playerKey === r.drawerKey && ['choosing', 'drawing'].includes(r.status) ? '✏️ DRAWING' : '', player.guessedTurn === r.turnId && r.status === 'drawing' ? '✓ GUESSED' : ''].filter(Boolean).join(' · ');
      item.classList.toggle('drawer', player.playerKey === r.drawerKey && ['choosing', 'drawing'].includes(r.status));
      item.classList.toggle('guessed', player.guessedTurn === r.turnId && r.status === 'drawing');
      who.append(name, tags); item.append(rank, who, score); list.append(item);
    });
    $('#sk-room-code').textContent = game.code;
    $('#sk-count').textContent = `${game.players.size}/10 PLAYERS`;
    const host = r.hostKey === game.key, idle = ['lobby', 'over'].includes(r.status);
    $('#sk-host-controls').hidden = !(host && idle);
    $('#sk-start').disabled = game.players.size < 2;
    $('#sk-start').textContent = game.players.size < 2 ? 'WAITING FOR PLAYERS…' : r.status === 'over' ? 'PLAY AGAIN' : 'START GAME';
  }
  function renderOverlay() {
    const r = room(), overlay = $('#sk-overlay'), title = $('#sk-title'), message = $('#sk-message'), eyebrow = $('#sk-eyebrow'), choices = $('#sk-choices'), podium = $('#sk-podium');
    choices.replaceChildren(); podium.replaceChildren(); choices.hidden = true; podium.hidden = true; $('#sk-overlay-start').hidden = true; $('#sk-overlay-invite').hidden = true;
    overlay.hidden = false;
    if (!r) { eyebrow.textContent = 'DRAW · GUESS · UP TO 10 PLAYERS'; title.textContent = 'NEON SKETCH'; message.textContent = 'One player draws, everyone else races to guess the word. Faster guesses score more. Open a room and send the link to your friends.'; return; }
    if (r.status === 'lobby') {
      const host = r.hostKey === game.key;
      eyebrow.textContent = `ROOM ${game.code} · ${game.players.size}/10 PLAYERS`; title.textContent = 'WAITING ROOM';
      message.textContent = game.players.size < 2 ? 'Send the invite link — you need at least 2 players.' : host ? 'Everyone in? Start the game.' : 'Waiting for the host to start…';
      $('#sk-overlay-invite').hidden = false; $('#sk-overlay-start').hidden = !(host && game.players.size >= 2); return;
    }
    if (r.status === 'choosing') {
      eyebrow.textContent = `ROUND ${r.round}/${r.rounds}`;
      if (iDraw()) {
        title.textContent = 'YOUR TURN TO DRAW'; message.textContent = 'Pick a word:';
        choices.hidden = false;
        (game.options || []).forEach((word, index) => { const button = document.createElement('button'); button.textContent = word.toUpperCase(); button.addEventListener('click', () => chooseWord(index)); choices.append(button); });
        if (!game.options) message.textContent = 'Getting your words…';
      } else { title.textContent = `${r.drawerName} IS CHOOSING`; message.textContent = 'Get ready to guess!'; }
      return;
    }
    if (r.status === 'reveal') { eyebrow.textContent = 'TIME’S UP'; title.textContent = r.lastWord ? `IT WAS “${r.lastWord.toUpperCase()}”` : 'TURN SKIPPED'; message.textContent = 'Next drawer coming up…'; return; }
    if (r.status === 'over') {
      eyebrow.textContent = 'GAME OVER'; title.textContent = 'FINAL SCORES';
      const sorted = [...game.players.values()].sort((a, b) => b.score - a.score);
      message.textContent = sorted[0]?.playerKey === game.key ? 'You win! 🏆' : `${sorted[0]?.name || 'Nobody'} wins!`;
      podium.hidden = false;
      sorted.slice(0, 3).forEach((player, index) => { const item = document.createElement('li'); item.textContent = `${['🥇', '🥈', '🥉'][index]} ${player.name} · ${player.score}`; podium.append(item); });
      $('#sk-overlay-start').hidden = r.hostKey !== game.key; return;
    }
    overlay.hidden = true; // drawing
  }
  function renderChat() {
    const log = $('#sk-chat'), stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.replaceChildren();
    for (const line of game?.chat.slice(-80) || []) {
      // Messages from players who already guessed are for the drawer and other guessers only.
      if (line.kind === 'guessed' && !iDraw() && !guessedThisTurn()) continue;
      const item = document.createElement('li'); item.className = line.kind;
      if (line.name && line.kind !== 'system' && line.kind !== 'correct') { const name = document.createElement('b'); name.textContent = `${line.name}: `; item.append(name); }
      item.append(document.createTextNode(line.text)); log.append(item);
    }
    if (stick) log.scrollTop = log.scrollHeight;
  }
  const localLine = (text, kind = 'local') => { game?.chat.push({ cid: `~${Date.now()}`, text, kind }); renderChat(); };

  // ---------- turns ----------
  async function onRoom(next) {
    if (!game || !next || next.code !== game.code || next.seq < (game.room?.seq || 0)) return;
    const before = game.room; game.room = next;
    if (!before || before.turnId !== next.turnId) { game.ops = []; game.word = null; game.options = null; drawing = null; ticksDone = new Set(); repaint(); if (before) loadStrokes(); }
    if (before && before.status !== next.status) {
      if (next.status === 'choosing' && iDraw()) { Sound?.turn(); notify('Your turn to draw!'); }
      if (next.status === 'drawing' && !iDraw()) Sound?.click(600);
      if (next.status === 'over') { const top = [...game.players.values()].sort((a, b) => b.score - a.score)[0]; if (top?.playerKey === game.key) Sound?.win(); else Sound?.lose(); track('game_finished', { players: game.players.size }); }
    }
    if (iDraw() && next.status === 'choosing' && !game.options) fetchWord();
    if (iDraw() && next.status === 'drawing' && !game.word) fetchWord();
    render();
  }
  async function fetchWord() {
    if (game.fetching) return; game.fetching = true;
    try {
      for (let attempt = 0; attempt < 5 && game; attempt += 1) {
        const reply = await call('sketchWord', { code: game.code });
        if (reply.options) { game.options = reply.options; break; }
        if (reply.word) { game.word = reply.word; break; }
        if (reply.error) break;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    } catch {} finally { if (game) game.fetching = false; render(); }
  }
  async function chooseWord(index) {
    const reply = await call('sketchChoose', { code: game.code, choice: index }).catch(() => ({}));
    if (reply.word) game.word = reply.word;
    render();
  }

  // Deadlines (turn end, hints, word choice) are enforced by the server; any browser nudges it when one passes.
  function clockTick() {
    renderTimer();
    const r = room();
    if (!r || !['choosing', 'drawing', 'reveal'].includes(r.status)) return;
    const now = serverNow(), total = r.turnEndsAt - r.turnStartedAt, elapsed = now - r.turnStartedAt;
    const due = now >= r.turnEndsAt + 300 ? `end:${r.seq}` : r.status === 'drawing' && elapsed >= total * .75 ? 'hint2' : r.status === 'drawing' && elapsed >= total * .5 ? 'hint1' : null;
    if (!due || Date.now() - lastTick < 1500 || (ticksDone.has(due) && !due.startsWith('end'))) return;
    lastTick = Date.now(); ticksDone.add(due);
    call('sketchTick', { code: game.code }).catch(() => {});
  }
  setInterval(clockTick, 250);

  // ---------- joining ----------
  const subscribe = (model, kind, handler) => client().models[model][kind]({ filter: { [model === 'SketchRoom' ? 'code' : 'roomCode']: { eq: game.code } } }).subscribe({ next: handler, error: () => setConnection('RECONNECTING', false) });
  function setConnection(text, live) { const badge = $('#sk-connection'); badge.textContent = `● ${text}`; badge.classList.toggle('offline', !live); }
  async function listAll(model, args) {
    const items = []; let nextToken = null;
    do { const page = await client().models[model].list({ ...args, nextToken }); items.push(...(page.data || [])); nextToken = page.nextToken; } while (nextToken && items.length < 2000);
    return items;
  }
  async function loadStrokes() {
    const r = room(); if (!r) return;
    const items = await listAll('SketchStroke', { roomCode: game.code, sid: { beginsWith: `${r.turnId}:` } }).catch(() => []);
    for (const item of items) if (item.by === r.drawerKey) addOp(item.sid, parse(item.data));
  }

  async function enter(code, key) {
    leave(false);
    game = { code, key, room: null, players: new Map(), chat: [], ops: [], subs: [], poll: 0, word: null, options: null };
    const url = new URL(location.href); url.search = `?sketch=${code}`; url.hash = ''; history.replaceState(null, '', url);
    try {
      game.subs = [
        subscribe('SketchRoom', 'onUpdate', onRoom),
        subscribe('SketchPlayer', 'onCreate', (player) => { game?.players.set(player.playerKey, player); render(); }),
        subscribe('SketchPlayer', 'onUpdate', (player) => { const was = game?.players.get(player.playerKey); game?.players.set(player.playerKey, player); if (player.playerKey === game?.key && was?.guessedTurn !== player.guessedTurn) renderChat(); render(); }),
        subscribe('SketchPlayer', 'onDelete', (player) => { game?.players.delete(player.playerKey); render(); }),
        subscribe('SketchStroke', 'onCreate', onStroke),
        subscribe('SketchChat', 'onCreate', (line) => { if (!game || line.roomCode !== game.code || game.chat.some((seen) => seen.cid === line.cid)) return; game.chat.push(line); if (line.kind === 'correct') Sound?.click(900); renderChat(); }),
      ];
      setConnection('LIVE', true);
    } catch { setConnection('POLLING', false); }
    const [{ data: first }, players, chat] = await Promise.all([client().models.SketchRoom.get({ code }), listAll('SketchPlayer', { roomCode: code }), client().models.SketchChat.list({ roomCode: code, sortDirection: 'DESC', limit: 60 })]);
    players.forEach((player) => game.players.set(player.playerKey, player));
    // Messages that arrived on the live feed while the history loaded are kept, without duplicates.
    const past = (chat.data || []).reverse(), seen = new Set(past.map((line) => line.cid));
    game.chat = [...past, ...game.chat.filter((line) => !seen.has(line.cid))];
    await onRoom(first); await loadStrokes(); renderChat();
    // Subscriptions can drop on flaky networks; a slow poll keeps the room and players fresh regardless.
    game.poll = setInterval(async () => {
      if (!game || document.hidden) return;
      try {
        const [{ data: latest }, list] = await Promise.all([client().models.SketchRoom.get({ code: game.code }), listAll('SketchPlayer', { roomCode: game.code })]);
        game.players = new Map(list.map((player) => [player.playerKey, player])); await onRoom(latest); setConnection('LIVE', true);
      } catch { setConnection('RECONNECTING', false); }
    }, 5000);
    render();
  }
  function leave(tellServer = true) {
    if (!game) return;
    if (tellServer) call('sketchLeave', { code: game.code }).catch(() => {});
    game.subs.forEach((sub) => sub?.unsubscribe?.()); clearInterval(game.poll);
    game = null; drawing = null; setConnection('OFFLINE', false);
    const url = new URL(location.href); url.searchParams.delete('sketch'); history.replaceState(null, '', url);
    repaint(); render(); renderChat();
  }
  function callsign() { const name = clean($('#sk-name').value); if (name) store('neonPoolName', name); return name; }
  function needsClient() { if (ready()) return false; notice(client() ? 'NEON SKETCH IS STILL BEING SET UP. TRY AGAIN SOON.' : 'CONNECTING… TRY AGAIN IN A MOMENT.'); return true; }

  async function createRoom() {
    const name = callsign(); if (!name) { notice(ERRORS.NAME); $('#sk-name').focus(); return; }
    if (needsClient()) return;
    notice('OPENING A ROOM…');
    try {
      const reply = await call('sketchCreate', { name, rounds: Number($('#sk-rounds').value), drawSeconds: Number($('#sk-time').value) });
      if (reply.error) { notice(ERRORS[reply.error] || ERRORS.SERVER); return; }
      notice('ROOM READY. SEND THE INVITE LINK.'); await enter(reply.code, reply.key); track('room_created', {});
    } catch { notice('COULD NOT OPEN A ROOM. CHECK YOUR CONNECTION.'); }
  }
  async function joinRoom(raw = $('#sk-code').value) {
    const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length !== 5) { notice('ROOM CODES ARE 5 CHARACTERS.'); return; }
    const name = callsign(); if (!name) { notice('ENTER A CALLSIGN, THEN JOIN.'); $('#sk-name').focus(); return; }
    if (needsClient()) return;
    notice(`JOINING ${code}…`);
    try {
      const reply = await call('sketchJoin', { code, name });
      if (reply.error) { notice(ERRORS[reply.error] || ERRORS.SERVER); return; }
      notice(`JOINED ROOM ${code}.`); await enter(code, reply.key); track('room_joined', {});
    } catch { notice('COULD NOT REACH THE ROOM. TRY AGAIN.'); }
  }
  async function startGame() {
    try { const reply = await call('sketchStart', { code: game.code, rounds: Number($('#sk-rounds-room').value), drawSeconds: Number($('#sk-time-room').value) }); if (reply.error) notice(ERRORS[reply.error] || ERRORS.SERVER); else track('game_started', { players: game.players.size }); } catch { notice(ERRORS.SERVER); }
  }
  async function guess(event) {
    event.preventDefault();
    const input = $('#sk-guess'), text = input.value.trim();
    if (!text || !game) return;
    input.value = '';
    try {
      const reply = await call('sketchGuess', { code: game.code, text });
      if (reply.result === 'correct') { game.word = reply.word; Sound?.win(); localLine(`YOU GOT IT! +${reply.points}`, 'mine'); render(); }
      else if (reply.result === 'close') localLine(`“${text}” IS CLOSE!`, 'close');
      else if (reply.result === 'hidden') localLine('THAT WOULD GIVE THE WORD AWAY — NOT SENT.', 'local');
      else if (reply.error) localLine(ERRORS[reply.error] || 'NOT SENT.', 'local');
    } catch { localLine('NOT SENT — CHECK YOUR CONNECTION.', 'local'); }
  }

  // ---------- alerts while the tab is in the background ----------
  const baseTitle = document.title; let titleTimer = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(titleTimer); document.title = baseTitle; } });
  function notify(body) { if (!document.hidden) return; clearInterval(titleTimer); let on = false; titleTimer = setInterval(() => { on = !on; document.title = on ? `🎨 ${body}` : baseTitle; }, 900); }

  // ---------- controls ----------
  const tools = $('#sk-colors');
  COLORS.forEach((color) => { const button = document.createElement('button'); button.style.background = color; button.setAttribute('aria-label', `Colour ${color}`); button.addEventListener('click', () => { pen.color = color; pen.erase = false; renderTools(); }); tools.append(button); });
  $$('[data-sk-size]').forEach((button) => button.addEventListener('click', () => { pen.size = SIZES[Number(button.dataset.skSize)]; pen.erase = false; renderTools(); }));
  $('#sk-eraser').addEventListener('click', () => { pen.erase = !pen.erase; renderTools(); });
  $('#sk-undo').addEventListener('click', () => { if (canDraw()) send({ t: 'undo' }); });
  $('#sk-clear').addEventListener('click', () => { if (canDraw()) send({ t: 'clear' }); });
  function renderTools() {
    [...tools.children].forEach((button, index) => button.classList.toggle('active', !pen.erase && COLORS[index] === pen.color));
    $$('[data-sk-size]').forEach((button) => button.classList.toggle('active', !pen.erase && SIZES[Number(button.dataset.skSize)] === pen.size));
    $('#sk-eraser').classList.toggle('active', pen.erase);
  }
  $('#sk-guess-form').addEventListener('submit', guess);
  $('#sk-create').addEventListener('click', createRoom);
  $('#sk-join').addEventListener('click', () => joinRoom());
  $('#sk-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  $('#sk-leave').addEventListener('click', () => { leave(true); notice('YOU LEFT THE ROOM.'); });
  $('#sk-start').addEventListener('click', startGame); $('#sk-overlay-start').addEventListener('click', startGame);
  async function share() {
    const url = new URL(location.href); url.search = `?sketch=${game.code}`; url.hash = ''; const link = url.toString();
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'Neon Sketch', text: `Draw and guess with me — room ${game.code}`, url: link }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); $('#sk-copy').textContent = 'LINK COPIED'; } catch { prompt('Copy this invite link:', link); }
    setTimeout(() => { $('#sk-copy').textContent = 'COPY INVITE LINK'; }, 1800);
  }
  $('#sk-copy').addEventListener('click', share); $('#sk-overlay-invite').addEventListener('click', share);
  $('#sk-help-button').addEventListener('click', () => { $('#sk-help').hidden = !$('#sk-help').hidden; });
  $('#sk-help-close').addEventListener('click', () => { $('#sk-help').hidden = true; });
  addEventListener('pagehide', () => { /* keep the seat: a refresh rejoins via the ?sketch= link */ });

  $('#sk-name').value = stored('neonPoolName', '');
  setConnection('OFFLINE', false); renderTools(); paint(); render();

  // Invite links (?sketch=CODE) open Neon Sketch and join straight away.
  const invited = new URLSearchParams(location.search).get('sketch');
  if (invited) (document.readyState === 'loading' ? (fn) => addEventListener('DOMContentLoaded', fn, { once: true }) : (fn) => fn())(() => {
    document.querySelector('.arcade-tab[data-game="sketch"]')?.click();
    $('#sk-code').value = invited.toUpperCase();
    const tryJoin = () => { if (!clean($('#sk-name').value)) { notice('ENTER A CALLSIGN, THEN TAP JOIN.'); $('#sk-name').focus(); return; } joinRoom(invited); };
    if (client()) tryJoin(); else { notice('CONNECTING TO YOUR INVITE…'); addEventListener('neon-leaderboard-ready', tryJoin, { once: true }); }
  });
})();
