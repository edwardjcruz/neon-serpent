(() => {
  const track = (event, game, details = {}) => window.trackGameEvent?.(event, game, details);
  const games = { snake: 'snake', mines: 'minesweeper', breakout: 'breakout', shooter: 'bubble_shooter', flappy: 'flappy_serpent', stack: 'neon_stack', tower: 'neon_tower' };
  const started = new Set();
  document.querySelectorAll('.arcade-tab').forEach((tab) => tab.addEventListener('click', () => track('game_selected', games[tab.dataset.game])));
  function start(game, details = {}) { if (!started.has(game)) { started.add(game); track('game_started', game, details); } }
  function finish(game, outcome, details = {}) { if (!started.has(game)) return; started.delete(game); track('game_finished', game, { outcome, ...details }); }
  document.querySelector('#start')?.addEventListener('click', () => start('snake'));
  document.querySelector('#breakout-start')?.addEventListener('click', () => start('breakout'));
  document.querySelector('#shooter-start')?.addEventListener('click', () => start('bubble_shooter'));
  document.querySelector('#mine-board')?.addEventListener('click', () => start('minesweeper', { difficulty: document.querySelector('[data-difficulty].active')?.dataset.difficulty }));
  document.querySelector('#upload')?.addEventListener('click', () => track('score_submitted', 'snake', { score: Number(document.querySelector('#score')?.textContent) || 0 }));
  document.querySelector('#breakout-upload')?.addEventListener('click', () => track('score_submitted', 'breakout', { score: Number(document.querySelector('#breakout-score')?.textContent) || 0 }));
  const observe = (selector, game, check) => { const target = document.querySelector(selector); if (target) new MutationObserver(() => check(target.textContent)).observe(target, { childList: true, subtree: true, characterData: true }); };
  observe('#title', 'snake', (text) => { if (text.includes('RUN TERMINATED')) finish('snake', 'lost', { score: Number(document.querySelector('#score')?.textContent) || 0, overdrive: Number(document.querySelector('#level')?.textContent) || 1 }); });
  observe('#breakout-title', 'breakout', (text) => { if (text.includes('RUN TERMINATED')) finish('breakout', 'lost', { score: Number(document.querySelector('#breakout-score')?.textContent) || 0, wave: Number(document.querySelector('#breakout-wave')?.textContent) || 1 }); });
  observe('#mine-message', 'minesweeper', (text) => { if (text.includes('CLEARED')) finish('minesweeper', 'won', { difficulty: document.querySelector('[data-difficulty].active')?.dataset.difficulty }); if (text.includes('DETONATED')) finish('minesweeper', 'lost', { difficulty: document.querySelector('[data-difficulty].active')?.dataset.difficulty }); });
  observe('#shooter-title', 'bubble_shooter', (text) => { if (text.includes('BREACH')) finish('bubble_shooter', 'lost'); });
})();
