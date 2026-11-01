// The phone shell: a home screen of games, a back button, and rooms in a slide-up sheet. Games are still opened by
// clicking their arcade tab, so everything that listens for the tabs (analytics, Cue's full-screen view) keeps working.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement, query = matchMedia(window.neonPhoneQuery);
  const TILES = [
    ['PLAY A FRIEND', [['pool', 'NEON CUE', '◎', 'Pool, online or vs CPU', '#3fd8d0'], ['checkers', 'CHECKERS', '♛', 'Jump, crown, capture', '#ffcf33'], ['lineup', 'LINE UP', '◉', 'Four in a row', '#ff5a4d'], ['gomoku', 'GOMOKU', '●', 'Five in a row', '#a78bff']]],
    ['ARCADE', [['snake', 'NEON SERPENT', '⌁', 'Grow, don’t crash', '#ffcf33'], ['pong', 'NEON PONG', '●', 'Beat the CPU', '#3fd8d0'], ['storm', 'NEON STORM', 'ϟ', 'Dodge everything', '#a78bff'], ['flappy', 'FLAPPY SERPENT', '〰', 'One-tap flight', '#ffcf33'], ['stack', 'NEON STACK', '▦', 'Falling blocks', '#ff5a4d'], ['tower', 'NEON TOWER', '▥', 'Stack it high', '#3fd8d0'], ['mines', 'NEON MINES', '✦', 'Clear the field', '#a78bff'], ['breakout', 'NEON BREAKOUT', '▰', 'Smash the bricks', '#ff5a4d'], ['shooter', 'BUBBLE SHOOTER', '◉', 'Match and pop', '#3fd8d0']]],
  ];
  // Games moved to the full-screen play view, with the elements that decide when their sheet opens and closes.
  const PLAY_VIEWS = { checkers: { section: '#checkers-game', panel: 'ROOMS', online: '[data-ck-mode="online"],[data-ck-begin="online"]', room: '#ck-room', notice: '#ck-notice' } };
  const names = Object.fromEntries(TILES.flatMap(([, tiles]) => tiles.map(([game, name]) => [game, name])));

  let current = null, pushed = false; // pushed: the open game has a browser history entry that Back can undo

  const home = $('#home-tiles');
  TILES.forEach(([group, tiles]) => {
    const heading = document.createElement('h2'), grid = document.createElement('div');
    heading.className = 'home-group'; heading.textContent = group; grid.className = 'home-grid';
    tiles.forEach(([game, name, icon, tag, color]) => {
      const tile = document.createElement('button'), mark = document.createElement('b'), title = document.createElement('strong'), line = document.createElement('span');
      tile.className = 'home-tile'; tile.style.setProperty('--tile', color); mark.textContent = icon; mark.setAttribute('aria-hidden', 'true'); title.textContent = name; line.textContent = tag;
      tile.append(mark, title, line);
      tile.addEventListener('click', () => $(`.arcade-tab[data-game="${game}"]`)?.click());
      grid.append(tile);
    });
    home.append(heading, grid);
  });

  const setSheet = (open) => root.classList.toggle('sheet-open', open);
  function applyView() {
    const view = query.matches ? PLAY_VIEWS[current] : null;
    root.classList.toggle('phone', query.matches);
    root.classList.toggle('phone-play', Boolean(view));
    Object.values(PLAY_VIEWS).forEach(({ section }) => $(section).classList.toggle('play-view', Boolean(view) && view.section === section));
    $('#app-title').textContent = names[current] || '';
    $('#app-panel').hidden = !view; $('#app-panel').textContent = view?.panel || '';
    if (!view) setSheet(false);
  }
  function showHome() {
    if (document.body.classList.contains('pool-focus')) $('#pool-focus-toggle')?.click();
    setSheet(false); current = null; pushed = false;
    root.classList.add('at-home'); applyView(); scrollTo(0, 0);
  }

  document.querySelectorAll('.arcade-tab').forEach((tab) => tab.addEventListener('click', () => {
    if (!query.matches) { current = tab.dataset.game; return; }
    // Only a game opened from the home screen gets a history entry; an invite link opens straight into its game.
    if (root.classList.contains('at-home') && !pushed) { history.pushState(null, ''); pushed = true; }
    current = tab.dataset.game; root.classList.remove('at-home'); applyView(); scrollTo(0, 0);
  }));
  addEventListener('popstate', () => { if (query.matches && !root.classList.contains('at-home')) showHome(); });
  $('#app-back').addEventListener('click', () => { if (pushed) history.back(); else showHome(); });

  $('#app-panel').addEventListener('click', () => setSheet(!root.classList.contains('sheet-open')));
  $('#app-sheet-close').addEventListener('click', () => setSheet(false));
  $('#app-scrim').addEventListener('click', () => setSheet(false));
  Object.entries(PLAY_VIEWS).forEach(([game, { online, room, notice }]) => {
    const isOpen = () => query.matches && current === game;
    document.querySelectorAll(online).forEach((button) => button.addEventListener('click', () => { if (isOpen() && $(room).hidden) setSheet(true); }));
    // Once in a room the invite is on the board, so get out of the way; until then, messages need to be seen.
    new MutationObserver(() => { if (isOpen() && !$(room).hidden) setSheet(false); }).observe($(room), { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(() => { if (isOpen() && $(room).hidden && $(notice).textContent) setSheet(true); }).observe($(notice), { childList: true, characterData: true, subtree: true });
  });

  query.addEventListener('change', () => {
    if (query.matches) { current = null; root.classList.add('at-home'); pushed = false; } else { root.classList.remove('at-home'); current = $('.arcade-tab.active')?.dataset.game; }
    applyView();
  });
  if (query.matches && !root.classList.contains('at-home')) current = $('.arcade-tab.active')?.dataset.game;
  applyView();
})();
