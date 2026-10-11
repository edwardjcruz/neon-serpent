// Neon Cue global ranking: reports finished racks to the rank-pool function and shows the board (a scrolling
// ticker over the table plus a top-10 list in the side panel). The server decides what counts:
//  - online racks count once both players' browsers report the same winner, and move an Elo rating;
//  - Medium/Hard racks against the computer nudge a small, capped bonus (they can't be checked);
//  - a player is listed after 3 ranked racks.
window.NeonPoolRanking = (() => {
  const $ = (selector) => document.querySelector(selector);
  const client = () => window.neonDataClient;
  const ready = () => Boolean(client()?.mutations?.reportPoolRack && client()?.models?.PoolRating);
  const me = (() => { try { return localStorage.neonPoolId ||= crypto.randomUUID(); } catch { return null; } })();
  const parse = (value) => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let board = [], mine = null, myPublicId = null, loading = null;

  // The board lists a hash of each player's private id; work out ours the same way the server does.
  async function publicId() {
    if (myPublicId || !me || !crypto.subtle) return myPublicId;
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`neon-pool:${me}`)));
    myPublicId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 20);
    return myPublicId;
  }

  async function call(name, args) {
    const { data, errors } = await client().mutations[name](args);
    if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
    return parse(data) || {};
  }

  // Tie this browser's player id to it straight away, before any opponent could see the id in a room.
  async function claim() {
    try { if (localStorage.neonPoolClaimed === me) return; } catch {}
    const { status } = await call('claimPoolPlayer', { playerId: me });
    if (status === 'ok') try { localStorage.neonPoolClaimed = me; } catch {}
  }

  // Both players report; the first report usually has to wait for the other one, so try a few times.
  async function reportRack({ code, rack, winner }) {
    if (!ready() || !me) return;
    for (const delay of [0, 2500, 6000, 12000]) {
      await wait(delay);
      try {
        const result = await call('reportPoolRack', { playerId: me, code, rack, winner });
        if (result.status !== 'waiting') { if (result.status === 'counted') announce(result.rating); return; }
      } catch { /* network blip: try again */ }
    }
  }
  async function reportCpu({ level, won, name }) {
    if (!ready() || !me || (level !== 'medium' && level !== 'hard')) return;
    try { const result = await call('reportPoolCpu', { playerId: me, level, won, name: name || null }); if (result.status === 'counted') announce(result.rating); } catch {}
  }
  function announce(rating) {
    if (Number.isFinite(rating)) { const notice = $('#pool-notice'); if (notice) notice.textContent = `GLOBAL RATING NOW ${rating}.`; }
    refresh();
  }

  // ---------- the board ----------
  async function refresh() {
    if (!ready()) return;
    loading ||= (async () => {
      try {
        const id = await publicId();
        const { data } = await client().models.PoolRating.listPoolRanking({ ranked: 'yes', sortDirection: 'DESC', limit: 50 });
        board = data || [];
        mine = board.find((player) => player.playerId === id) || (id ? (await client().models.PoolRating.get({ playerId: id })).data : null);
        render();
      } catch { /* keep showing the last board */ } finally { loading = null; }
    })();
    return loading;
  }

  function render() {
    const ticker = $('#pool-ticker'), track = $('#pool-ticker-track'), list = $('#pool-ranking'), you = $('#pool-ranking-you');
    if (!ticker || !list) return;
    $('#pool-ranking-box').hidden = false;
    const top = board.slice(0, 10);
    list.replaceChildren();
    if (!top.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'NO RANKED PLAYERS YET. WIN 3 RACKS TO BE FIRST.'; list.append(empty); }
    top.forEach((player, index) => {
      const item = document.createElement('li'), rank = document.createElement('i'), name = document.createElement('b'), record = document.createElement('small'), score = document.createElement('strong');
      rank.textContent = `#${index + 1}`; name.textContent = player.name; record.textContent = `${player.wins}W ${player.losses}L ONLINE`; score.textContent = player.score;
      item.classList.toggle('you', player.playerId === myPublicId);
      const who = document.createElement('span'); who.append(name, record); item.append(rank, who, score); list.append(item);
    });
    const position = board.findIndex((player) => player.playerId === myPublicId);
    you.textContent = !mine ? 'WIN AN ONLINE RACK, OR BEAT THE CPU ON MEDIUM/HARD, TO GET A RATING.'
      : mine.ranked !== 'yes' ? `YOUR RATING ${mine.score} · ${3 - mine.games} MORE RANKED RACK${3 - mine.games === 1 ? '' : 'S'} TO GET LISTED`
      : position >= 0 ? `YOU'RE #${position + 1} · RATING ${mine.score}` : `YOUR RATING ${mine.score} · OUTSIDE THE TOP 50`;
    // Ticker: the top 10 scrolling over the table, written twice so the loop is seamless.
    ticker.hidden = !top.length;
    const text = top.map((player, index) => `#${index + 1} ${player.name} ${player.score}`).join('   ·   ');
    track.replaceChildren(...[0, 1].map(() => { const span = document.createElement('span'); span.textContent = text; return span; }));
    track.style.animationDuration = `${Math.max(18, text.length * .28)}s`;
  }

  function start() {
    if (!ready()) return;
    claim().catch(() => {});
    refresh();
    setInterval(() => { if (!$('#pool-game')?.hidden && !document.hidden) refresh(); }, 60_000);
  }
  if (client()) start(); else addEventListener('neon-leaderboard-ready', start, { once: true });

  return { reportRack, reportCpu, refresh };
})();
