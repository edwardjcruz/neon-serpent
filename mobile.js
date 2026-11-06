// The phone shell: a home screen of games, a back button, and rooms in a slide-up sheet. Games are still opened by
// clicking their arcade tab, so everything that listens for the tabs (analytics, Cue's full-screen view) keeps working.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement, query = matchMedia(window.neonPhoneQuery);
  const TILES = [
    ['PLAY A FRIEND', [['pool', 'NEON CUE', '◎', 'Pool, online or vs CPU', '#3fd8d0'], ['checkers', 'CHECKERS', '♛', 'Jump, crown, capture', '#ffcf33'], ['lineup', 'LINE UP', '◉', 'Four in a row', '#ff5a4d'], ['gomoku', 'GOMOKU', '●', 'Five in a row', '#a78bff']]],
    ['ARCADE', [['snake', 'NEON SERPENT', '⌁', 'Grow, don’t crash', '#ffcf33'], ['pong', 'NEON RALLY', '●', 'Beat the CPU', '#3fd8d0'], ['storm', 'NEON STORM', 'ϟ', 'Dodge everything', '#a78bff'], ['flappy', 'SKY SERPENT', '〰', 'One-tap flight', '#ffcf33'], ['stack', 'NEON DROP', '▦', 'Falling blocks', '#ff5a4d'], ['tower', 'NEON TOWER', '▥', 'Stack it high', '#3fd8d0'], ['mines', 'NEON MINES', '✦', 'Clear the field', '#a78bff'], ['breakout', 'NEON SMASH', '▰', 'Smash the bricks', '#ff5a4d'], ['shooter', 'NEON POP', '◉', 'Match and pop', '#3fd8d0']]],
  ];
  const ROOMS = (key, prefix) => ({ panel: 'ROOMS', online: `[data-${key}-mode="online"],[data-${key}-begin="online"]`, room: `#${prefix}-room`, notice: `#${prefix}-notice` });
  // Every game's screen. `arena` is sized to fit above its controls; `submit` is the score form that appears at game over.
  const PLAY_VIEWS = {
    checkers: { section: '#checkers-game', arena: '.ck-arena', ...ROOMS('ck', 'ck') },
    gomoku: { section: '#gomoku-game', arena: '.gm-arena', ...ROOMS('gm', 'gm') },
    lineup: { section: '#lineup-game', arena: '.lu-arena', ...ROOMS('lu', 'lu') },
    pool: { section: '#pool-game', arena: '.pool-arena', ...ROOMS('pool', 'pool') },
    snake: { section: '#snake-game', arena: '.arena', panel: 'SCORES', submit: '#submit', pause: '#pause' },
    pong: { section: '#pong-game', arena: '.pong-arena', panel: 'SCORES', submit: '#pong-submit', pause: '#pong-pause' },
    storm: { section: '#storm-game', arena: '.storm-arena', panel: 'SCORES', submit: '#storm-submit', pause: '#storm-pause' },
    flappy: { section: '#flappy-game', arena: '.flappy-arena', panel: 'SCORES', submit: '#flappy-submit' },
    stack: { section: '#stack-game', arena: '.stack-arena', panel: 'SCORES', submit: '#stack-submit', pause: '#stack-pause' },
    tower: { section: '#tower-game', arena: '.tower-arena', panel: 'SCORES', submit: '#tower-submit' },
    mines: { section: '#minesweeper-game', panel: 'SCORES', submit: '#mine-submit' },
    breakout: { section: '#breakout-game', arena: '.breakout-arena', panel: 'SCORES', submit: '#breakout-submit', pause: '#breakout-pause' },
    shooter: { section: '#shooter-game', arena: '.shooter-arena', panel: 'SCORES', submit: '#shooter-submit' },
  };
  const offline = root.classList.contains('no-online');
  const names = Object.fromEntries(TILES.flatMap(([, tiles]) => tiles.map(([game, name]) => [game, name])));

  let current = null, pushed = false; // pushed: the open game has a browser history entry that Back can undo

  const home = $('#home-tiles'), leaveOut = window.neonLeaveOut || [];
  $('.home-brand small').textContent = `${TILES.flatMap(([, tiles]) => tiles).filter(([game]) => !leaveOut.includes(game)).length} GAMES · NO SIGN-UP`;
  TILES.forEach(([group, tiles]) => {
    const heading = document.createElement('h2'), grid = document.createElement('div');
    heading.className = 'home-group'; heading.textContent = group; grid.className = 'home-grid';
    tiles.forEach(([game, name, icon, tag, color]) => {
      if (leaveOut.includes(game)) return;
      const tile = document.createElement('button'), mark = document.createElement('b'), title = document.createElement('strong'), line = document.createElement('span');
      tile.className = 'home-tile'; tile.style.setProperty('--tile', color); mark.textContent = icon; mark.setAttribute('aria-hidden', 'true'); title.textContent = name; line.textContent = tag;
      tile.append(mark, title, line);
      tile.addEventListener('click', () => $(`.arcade-tab[data-game="${game}"]`)?.click());
      grid.append(tile);
    });
    home.append(heading, grid);
  });

  const setSheet = (open) => root.classList.toggle('sheet-open', open);
  // Fit the board between the bar and the controls: whatever height the rest of the screen doesn't need.
  function fitArena() {
    const view = query.matches ? PLAY_VIEWS[current] : null, section = view && $(view.section);
    if (!section) return;
    const header = section.querySelector(':scope > header');
    if (header) root.style.setProperty('--bar-right', `${header.offsetWidth + 6}px`);
    const arena = view.arena && section.querySelector(view.arena);
    if (!arena || !arena.offsetHeight) return;
    arena.classList.add('play-arena');
    const others = [...section.children].filter((child) => child !== arena && child !== header && child.offsetHeight);
    const style = getComputedStyle(section), used = others.reduce((sum, child) => sum + child.offsetHeight + 8, 0) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const room = innerHeight - $('.app-bar').offsetHeight - used - 8;
    section.style.setProperty('--arena-w', `${Math.floor(Math.max(240, Math.min(section.clientWidth, room * (arena.offsetWidth / arena.offsetHeight))))}px`);
  }
  const resizes = new ResizeObserver(() => fitArena());
  Object.values(PLAY_VIEWS).forEach(({ section }) => resizes.observe($(section)));
  addEventListener('resize', fitArena);

  function applyView() {
    const view = query.matches ? PLAY_VIEWS[current] : null;
    root.classList.toggle('phone', query.matches);
    root.classList.toggle('phone-play', Boolean(view));
    Object.values(PLAY_VIEWS).forEach(({ section }) => $(section).classList.toggle('play-view', Boolean(view) && view.section === section));
    $('#app-title').textContent = names[current] || '';
    const panel = view && offline ? (view.room ? 'RECORD' : '') : view?.panel || '';
    $('#app-panel').hidden = !panel; $('#app-panel').textContent = panel;
    if (!view) setSheet(false);
    fitArena();
  }
  // Fast games would carry on unseen, so freeze the run when you leave it. Pause buttons toggle; Ⅱ means it's running.
  function pauseCurrent() {
    const button = PLAY_VIEWS[current]?.pause && $(PLAY_VIEWS[current].pause);
    if (button && button.textContent.trim() === 'Ⅱ') button.click();
    window.neonHold?.[current]?.();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && query.matches) pauseCurrent(); });
  function showHome() {
    pauseCurrent();
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
  Object.entries(PLAY_VIEWS).forEach(([game, { online, room, notice, submit }]) => {
    const isOpen = () => query.matches && current === game;
    if (submit && $(submit)) new MutationObserver(() => { if (isOpen() && !$(submit).hidden && !offline) setTimeout(() => setSheet(true), 900); }).observe($(submit), { attributes: true, attributeFilter: ['hidden'] });
    if (!room) return;
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
