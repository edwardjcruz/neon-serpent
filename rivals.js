// Head-to-head records against online opponents, kept in this browser. Opponents are identified by the random
// player id their browser uses for rooms (so a new device or cleared data shows up as a new rival); the callsign
// shown is whatever they last played under. Shared by the arcade's online games, keyed by game.
window.NeonRivals = (() => {
  const KEY = 'neonRivals';
  const load = () => { try { return JSON.parse(localStorage[KEY] || '{}') || {}; } catch { return {}; } };
  const save = (all) => { try { localStorage[KEY] = JSON.stringify(all); } catch {} };
  const clean = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'OPPONENT';

  function record(game, { id, name, won }) {
    if (!id) return null;
    const all = load(), rivals = all[game] ||= {}, rival = rivals[id] ||= { name: clean(name), w: 0, l: 0, last: 0 };
    rival.name = clean(name); rival[won ? 'w' : 'l'] += 1; rival.last = Date.now();
    save(all);
    return rival;
  }
  const get = (game, id) => (id ? load()[game]?.[id] || null : null);
  const list = (game) => Object.entries(load()[game] || {}).map(([id, rival]) => ({ id, ...rival })).sort((a, b) => b.last - a.last);

  // "You lead Rival 7–4", "Rival leads 5–3", "Tied with Rival 2–2", or a first-meeting line.
  function summary(game, id, name) {
    const rival = get(game, id), who = clean(rival?.name || name);
    if (!rival) return `FIRST GAME VS ${who}`;
    if (rival.w === rival.l) return `TIED WITH ${who} ${rival.w}–${rival.l}`;
    return rival.w > rival.l ? `YOU LEAD ${who} ${rival.w}–${rival.l}` : `${who} LEADS ${rival.l}–${rival.w}`;
  }
  function ago(time) {
    const days = Math.floor((Date.now() - time) / 86400000);
    return days < 1 ? 'TODAY' : days === 1 ? 'YESTERDAY' : days < 7 ? `${days} DAYS AGO` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  }

  // Fills a <ul> with the most recent rivals; `onRematch(rival)` wires each row's rematch button.
  function render(game, listElement, onRematch) {
    listElement.replaceChildren();
    const rivals = list(game).slice(0, 8);
    if (!rivals.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'PLAY SOMEONE ONLINE AND THEY’LL SHOW UP HERE.'; listElement.append(empty); return; }
    for (const rival of rivals) {
      const item = document.createElement('li'), who = document.createElement('span'), name = document.createElement('b'), when = document.createElement('small'), score = document.createElement('strong'), button = document.createElement('button');
      name.textContent = rival.name; when.textContent = ago(rival.last); who.append(name, when);
      score.textContent = `${rival.w}W – ${rival.l}L`; score.className = rival.w > rival.l ? 'ahead' : rival.w < rival.l ? 'behind' : '';
      button.textContent = 'REMATCH'; button.addEventListener('click', () => onRematch(rival));
      item.append(who, score, button); listElement.append(item);
    }
  }

  return { record, get, list, summary, render };
})();
