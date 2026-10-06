// Computer opponent for Neon 8-Ball. It lines up pot attempts (ghost-ball aiming at every pocket), plays each one
// through the real physics, scores what happens, and then shoots its favourite with a level-dependent wobble.
globalThis.NeonPoolAI = (() => {
  const E = globalThis.NeonPoolEngine;
  const LEVELS = {
    easy: { aim: 1.6, power: .15, choices: 4 },
    medium: { aim: .6, power: .07, choices: 2 },
    hard: { aim: .1, power: .02, choices: 1 },
  };
  const POWERS = [.3, .48, .7];

  function gaussian(random) { let u = 0, v = 0; while (!u) u = random(); while (!v) v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function targetsFor(state, seat) {
    const live = state.balls.filter((b) => b.n && !b.in);
    if (E.onEight(state, seat)) return live.filter((b) => b.n === 8);
    if (state.groups) return live.filter((b) => E.inGroup(b.n, state.groups[seat]));
    return live.filter((b) => b.n !== 8);
  }

  // Where the cue ball must touch the object ball to send it at a pocket, and the cue position that makes it straight.
  function potLine(target, pocket) {
    const [px, py] = E.POCKETS[pocket], dx = px - target.x, dy = py - target.y, d = Math.hypot(dx, dy);
    return { ux: dx / d, uy: dy / d, gx: target.x - dx / d * E.BR * 2, gy: target.y - dy / d * E.BR * 2, distance: d };
  }

  function score(state, next, seat) {
    if (next.winner === seat) return 100000;
    if (next.winner !== null) return -100000;
    const mine = targetsFor(next, seat).length, before = targetsFor(state, seat).length;
    if (next.turn === seat) return 2000 + (before - mine) * 150 + positionBonus(next, seat);
    // Turn passes: a foul hands over ball in hand, which is the worst non-losing result.
    if (next.ballInHand) return -1500;
    return -100 - targetsFor(next, 1 - seat).length * -10;
  }
  // Prefer leaving the cue ball close to something it can pot next.
  function positionBonus(state, seat) {
    const cue = state.balls[0];
    let best = 0;
    for (const target of targetsFor(state, seat)) for (let pocket = 0; pocket < 6; pocket += 1) {
      const line = potLine(target, pocket), cx = line.gx - cue.x, cy = line.gy - cue.y, length = Math.hypot(cx, cy) || 1;
      const straightness = (cx * line.ux + cy * line.uy) / length;
      if (straightness > .3) best = Math.max(best, straightness * 300 - length * .2);
    }
    return best;
  }

  function candidates(state, seat) {
    const shots = [], targets = targetsFor(state, seat), cue = state.balls[0];
    const cueSpots = [];
    if (state.ballInHand) {
      // Try setting up straight-in shots, then fall back to wherever the cue ball is allowed.
      for (const target of targets) for (let pocket = 0; pocket < 6; pocket += 1) {
        const line = potLine(target, pocket);
        for (const back of [60, 120]) { const x = line.gx - line.ux * back, y = line.gy - line.uy * back; if (E.canPlaceCue(state, x, y)) cueSpots.push({ x, y }); }
      }
      if (!cue.in && E.canPlaceCue(state, cue.x, cue.y)) cueSpots.push({ x: cue.x, y: cue.y });
      for (let x = E.HEAD_X; x > E.L + 20 && cueSpots.length < 3; x -= 25) if (E.canPlaceCue(state, x, E.CY)) cueSpots.push({ x, y: E.CY });
    } else cueSpots.push({ x: cue.x, y: cue.y });

    for (const spot of cueSpots.slice(0, 24)) {
      for (const target of targets) {
        for (let pocket = 0; pocket < 6; pocket += 1) {
          const line = potLine(target, pocket), ax = line.gx - spot.x, ay = line.gy - spot.y, length = Math.hypot(ax, ay);
          if (length < 1) continue;
          // Skip cuts thinner than about 75°; they almost never drop.
          if ((ax * line.ux + ay * line.uy) / length < .26) continue;
          for (const power of POWERS) shots.push({ dir: Math.atan2(ay, ax), power, cue: spot, call: target.n === 8 ? pocket : null });
        }
        // A plain hit on the ball's centre at least makes legal contact when nothing pots.
        shots.push({ dir: Math.atan2(target.y - spot.y, target.x - spot.x), power: .4, cue: spot, call: null, safety: true });
      }
    }
    return shots;
  }

  function toShot(plan, angle = plan.dir, power = plan.power) {
    const speed = E.MAX_SPEED * Math.max(.08, Math.min(1, power));
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, cueX: plan.cue.x, cueY: plan.cue.y, spinX: 0, spinY: 0, call: plan.call };
  }

  // Returns the shot to play plus the plan (for animating the stick before it fires).
  function chooseShot(state, level = 'medium', random = Math.random) {
    const seat = state.turn, settings = LEVELS[level] || LEVELS.medium;
    if (state.isBreak) {
      const cue = { x: E.HEAD_X - 20, y: E.CY + (random() - .5) * 60 };
      const plan = { dir: Math.atan2(E.CY - cue.y, E.W * .72 - cue.x) + gaussian(random) * .004, power: 1, cue, call: null };
      return { shot: toShot(plan), plan };
    }
    const scored = [];
    for (const plan of candidates(state, seat)) {
      const shot = E.normalizeShot(state, toShot(plan));
      if (!shot) continue;
      const next = E.playShot(state, shot);
      scored.push({ plan, value: score(state, next, seat) + (plan.safety ? -50 : 0) + random() * 5 });
    }
    if (!scored.length) {
      const cue = state.balls[0], target = targetsFor(state, seat)[0] || state.balls.find((b) => b.n && !b.in);
      const plan = { dir: Math.atan2(target.y - cue.y, target.x - cue.x), power: .4, cue: { x: cue.x, y: cue.y }, call: null };
      return { shot: toShot(plan), plan };
    }
    scored.sort((a, b) => b.value - a.value);
    const pick = scored[Math.floor(random() * Math.min(settings.choices, scored.length))].plan;
    // Human-like error: a little off on aim and pace, more on easier levels.
    const angle = pick.dir + gaussian(random) * settings.aim * Math.PI / 180, power = pick.power * (1 + gaussian(random) * settings.power);
    return { shot: toShot(pick, angle, power), plan: { ...pick, dir: angle, power } };
  }

  return { chooseShot, LEVELS };
})();
