(() => {
  const games = {
    snake: { game: '#snake-game', panel: '#snake-leaderboard' },
    mines: { game: '#minesweeper-game', panel: '#mine-leaderboard' },
    breakout: { game: '#breakout-game', panel: '#breakout-leaderboard' },
    shooter: { game: '#shooter-game', panel: '#shooter-leaderboard' },
  };
  const gameSections = Object.values(games).map(({ game }) => document.querySelector(game));
  const panels = Object.values(games).map(({ panel }) => document.querySelector(panel));
  const arcade = document.querySelector('#arcade');
  document.querySelectorAll('.arcade-tab').forEach((tab) => tab.addEventListener('click', () => {
    const selected = games[tab.dataset.game];
    if (!selected) return;
    gameSections.forEach((section) => { section.hidden = section !== document.querySelector(selected.game); });
    panels.forEach((panel) => { panel.hidden = panel !== document.querySelector(selected.panel); });
    arcade.classList.toggle('mine-mode', tab.dataset.game === 'mines');
    document.querySelectorAll('.arcade-tab').forEach((item) => item.classList.toggle('active', item === tab));
  }));
})();
