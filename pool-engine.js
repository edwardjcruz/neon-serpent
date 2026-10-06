// Neon 8-Ball rules and physics. Pure functions with a fixed timestep and only + − × ÷ √, so every
// browser that replays the same shot from the same table gets the same result — online play relies on it.
globalThis.NeonPoolEngine = (() => {
  const W = 800, H = 440, L = 40, R = 760, T = 40, B = 400, BR = 9;
  const MID = (L + R) / 2, HEAD_X = L + (R - L) * .25, FOOT_X = L + (R - L) * .75, CY = (T + B) / 2;
  const CORNER_MOUTH = 22, SIDE_MOUTH = 16, STEP = 1 / 240, MAX_STEPS = 240 * 40, MAX_SPEED = 1600;
  const RACK = [[1], [11, 3], [14, 8, 6], [2, 13, 15, 7], [9, 4, 12, 10, 5]];

  const isSolid = (n) => n >= 1 && n <= 7;
  const isStripe = (n) => n >= 9 && n <= 15;
  const inGroup = (n, group) => (group === 'solids' ? isSolid(n) : group === 'stripes' ? isStripe(n) : false);
  const clone = (state) => JSON.parse(JSON.stringify(state));

  function newRack(breaker = 0) {
    const balls = [{ n: 0, x: HEAD_X, y: CY, vx: 0, vy: 0, in: false }];
    const dx = BR * Math.sqrt(3) + .3;
    RACK.forEach((row, r) => row.forEach((n, i) => balls.push({ n, x: FOOT_X + r * dx, y: CY + (i - (row.length - 1) / 2) * (BR * 2 + .3), vx: 0, vy: 0, in: false })));
    return { balls, turn: breaker, groups: null, isBreak: true, ballInHand: true, kitchen: true, winner: null, message: 'BREAK SHOT — PLACE THE CUE BALL BEHIND THE LINE', shots: 0 };
  }

  const ball = (state, n) => state.balls.find((item) => item.n === n);
  const remaining = (state, group) => state.balls.filter((item) => !item.in && inGroup(item.n, group)).length;
  const groupOf = (state, seat) => (state.groups ? state.groups[seat] : null);
  const onEight = (state, seat) => Boolean(state.groups) && remaining(state, groupOf(state, seat)) === 0;

  function canPlaceCue(state, x, y) {
    if (x < L + BR || x > R - BR || y < T + BR || y > B - BR) return false;
    if (state.kitchen && x > HEAD_X) return false;
    return state.balls.every((item) => item.n === 0 || item.in || (item.x - x) ** 2 + (item.y - y) ** 2 >= (BR * 2 + .5) ** 2);
  }

  const inMouthX = (x) => x < L + CORNER_MOUTH || x > R - CORNER_MOUTH || Math.abs(x - MID) < SIDE_MOUTH;
  const inMouthY = (y) => y < T + CORNER_MOUTH || y > B - CORNER_MOUTH;

  // Advance one fixed step. `events` collects what the rules need: first contact and pocketed balls.
  function step(balls, events) {
    let moving = false;
    for (const b of balls) {
      if (b.in || (b.vx === 0 && b.vy === 0)) continue;
      b.x += b.vx * STEP; b.y += b.vy * STEP;
      if (b.y < T + BR && b.vy < 0 && !inMouthX(b.x)) { b.y = T + BR; b.vy = -b.vy * .78; b.vx *= .96; }
      if (b.y > B - BR && b.vy > 0 && !inMouthX(b.x)) { b.y = B - BR; b.vy = -b.vy * .78; b.vx *= .96; }
      if (b.x < L + BR && b.vx < 0 && !inMouthY(b.y)) { b.x = L + BR; b.vx = -b.vx * .78; b.vy *= .96; }
      if (b.x > R - BR && b.vx > 0 && !inMouthY(b.y)) { b.x = R - BR; b.vx = -b.vx * .78; b.vy *= .96; }
      // Rails bounce everywhere except at the pocket mouths, so a centre past the rail line has dropped.
      if (b.x < L || b.x > R || b.y < T || b.y > B) { b.in = true; b.vx = 0; b.vy = 0; events.pocketed.push(b.n); }
    }
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i]; if (a.in) continue;
      for (let j = i + 1; j < balls.length; j += 1) {
        const c = balls[j]; if (c.in) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * BR * BR || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (BR * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
        const approach = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (approach <= 0) continue;
        const impulse = approach * .98;
        a.vx -= impulse * nx; a.vy -= impulse * ny; c.vx += impulse * nx; c.vy += impulse * ny;
        if (events.firstHit === null && (a.n === 0 || c.n === 0)) events.firstHit = a.n === 0 ? c.n : a.n;
      }
    }
    for (const b of balls) {
      if (b.in || (b.vx === 0 && b.vy === 0)) continue;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy), next = speed - (115 + speed * .25) * STEP;
      if (next < 4) { b.vx = 0; b.vy = 0; } else { b.vx *= next / speed; b.vy *= next / speed; moving = true; }
    }
    return moving;
  }

  // Validate a shot from the shooter's browser; returns null when it cannot be played on this table.
  function normalizeShot(state, shot) {
    const vx = Number(shot?.vx), vy = Number(shot?.vy), cueX = Number(shot?.cueX), cueY = Number(shot?.cueY);
    if (![vx, vy].every(Number.isFinite) || vx * vx + vy * vy > MAX_SPEED * MAX_SPEED * 1.01 || vx * vx + vy * vy < 1) return null;
    const cue = ball(state, 0);
    if (state.ballInHand) { if (!Number.isFinite(cueX) || !Number.isFinite(cueY) || !canPlaceCue(state, cueX, cueY)) return null; return { vx, vy, cueX, cueY }; }
    return { vx, vy, cueX: cue.x, cueY: cue.y };
  }

  // A shot in progress, advanced a few steps per animation frame so both browsers draw the same motion.
  function beginShot(state, shot) {
    const sim = clone(state), cue = ball(sim, 0);
    cue.in = false; cue.x = shot.cueX; cue.y = shot.cueY; cue.vx = shot.vx; cue.vy = shot.vy;
    return { before: state, table: sim, events: { firstHit: null, pocketed: [] }, steps: 0, done: false };
  }
  function advance(run, steps) {
    for (let i = 0; i < steps && !run.done; i += 1) {
      run.steps += 1;
      if (!step(run.table.balls, run.events) || run.steps >= MAX_STEPS) run.done = true;
    }
    return run.done;
  }

  function respotEight(table) {
    const eight = ball(table, 8); eight.in = false; eight.vx = 0; eight.vy = 0;
    for (let x = FOOT_X; x < R - BR; x += 1) if (table.balls.every((b) => b.n === 8 || b.in || (b.x - x) ** 2 + (b.y - CY) ** 2 >= 4 * BR * BR)) { eight.x = x; eight.y = CY; return; }
    eight.x = FOOT_X; eight.y = CY;
  }

  // Apply 8-ball rules to the finished simulation and return the next table state.
  function resolve(run) {
    const before = run.before, next = run.table, { firstHit, pocketed } = run.events;
    const seat = before.turn, other = 1 - seat, wasOnEight = onEight(before, seat), wasBreak = before.isBreak;
    const scratch = pocketed.includes(0), objects = pocketed.filter((n) => n !== 0 && n !== 8);
    let foul = null;
    if (scratch) foul = 'SCRATCH';
    else if (firstHit === null) foul = 'NO BALL HIT';
    else if (!wasBreak && wasOnEight && firstHit !== 8) foul = 'HIT THE 8 FIRST';
    else if (!wasBreak && !wasOnEight && before.groups && !inGroup(firstHit, groupOf(before, seat))) foul = 'WRONG BALL FIRST';
    else if (!wasBreak && !before.groups && firstHit === 8) foul = 'HIT THE 8 FIRST';

    next.balls.forEach((b) => { b.vx = 0; b.vy = 0; });
    next.isBreak = false; next.kitchen = false; next.ballInHand = false; next.shots = before.shots + 1;
    const names = ['PLAYER 1', 'PLAYER 2'];

    if (pocketed.includes(8)) {
      if (wasBreak) respotEight(next);
      else {
        next.winner = wasOnEight && !foul ? seat : other;
        next.message = next.winner === seat ? 'SANK THE 8 — RACK WON' : foul ? `8 BALL DOWN ON A FOUL (${foul})` : '8 BALL DOWN EARLY';
        if (scratch) ball(next, 0).in = true;
        return next;
      }
    }
    if (!next.groups && !wasBreak && !foul && objects.length) {
      const mine = isSolid(objects[0]) ? 'solids' : 'stripes', theirs = mine === 'solids' ? 'stripes' : 'solids';
      next.groups = seat === 0 ? [mine, theirs] : [theirs, mine];
    }
    const keepsTurn = !foul && (next.groups && !wasBreak ? objects.some((n) => inGroup(n, next.groups[seat])) : objects.length > 0);
    if (foul) {
      next.turn = other; next.ballInHand = true;
      if (scratch) { const cue = ball(next, 0); cue.in = true; }
      next.message = `FOUL: ${foul} — ${names[other]} HAS BALL IN HAND`;
    } else if (keepsTurn) {
      next.message = objects.length > 1 ? `${objects.length} BALLS DOWN — SHOOT AGAIN` : 'BALL DOWN — SHOOT AGAIN';
      if (next.groups && !before.groups) next.message = `${names[seat]} TAKES ${next.groups[seat].toUpperCase()}`;
    } else {
      next.turn = other; next.message = `${names[other]} TO SHOOT`;
    }
    return next;
  }

  // Run a whole shot instantly (used by the shooter before broadcasting it).
  function playShot(state, shot) {
    const run = beginShot(state, shot);
    while (!advance(run, 1000));
    return resolve(run);
  }

  return { W, H, L, R, T, B, BR, MID, HEAD_X, CY, MAX_SPEED, isSolid, isStripe, inGroup, newRack, canPlaceCue, normalizeShot, beginShot, advance, resolve, playShot, remaining, onEight, clone };
})();
