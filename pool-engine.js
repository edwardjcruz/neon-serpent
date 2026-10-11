// Neon Cue rules and physics. Pure functions with a fixed timestep and only + − × ÷ √, so every
// browser that replays the same shot from the same table gets the same result — online play relies on it.
globalThis.NeonPoolEngine = (() => {
  const W = 800, H = 440, L = 40, R = 760, T = 40, B = 400, BR = 9;
  const MID = (L + R) / 2, HEAD_X = L + (R - L) * .25, FOOT_X = L + (R - L) * .75, CY = (T + B) / 2;
  const CORNER_MOUTH = 22, SIDE_MOUTH = 16, STEP = 1 / 240, MAX_STEPS = 240 * 40, MAX_SPEED = 1600;
  // Spin: follow/draw is stored as speed the cue ball gains (or loses) along its path after its first hit and
  // fades while it slides; side spin (english) kicks the cue ball sideways as it comes off a rail.
  const FOLLOW = .75, FOLLOW_FADE = 1.6, ENGLISH = .22;
  // Pocket centres, numbered for calling the black: 0–2 along the top rail left to right, 3–5 along the bottom.
  const POCKETS = [[L, T], [MID, T], [R, T], [L, B], [MID, B], [R, B]];
  const ROWS = [1, 2, 3, 4, 5]; // rack rows from the apex back

  const isSolid = (n) => n >= 1 && n <= 7;
  const isStripe = (n) => n >= 9 && n <= 15;
  const inGroup = (n, group) => (group === 'solids' ? isSolid(n) : group === 'stripes' ? isStripe(n) : false);
  const clone = (state) => JSON.parse(JSON.stringify(state));

  // `match` carries the running score of racks won ([seat 0, seat 1]) from one rack to the next.
  // A fresh rack is shuffled like a real one: the black in the middle of the third row, one solid and one stripe
  // in the back corners, everything else anywhere, packed tight with tiny uneven gaps so no two breaks play out
  // the same. (Randomness only happens here; the rack is then shared as data.)
  function newRack(breaker = 0, match = [0, 0], random = Math.random) {
    const shuffle = (list) => { for (let i = list.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
    const solids = shuffle([1, 2, 3, 4, 5, 6, 7]), stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
    const corners = random() < .5 ? [solids.pop(), stripes.pop()] : [stripes.pop(), solids.pop()];
    const rest = shuffle([...solids, ...stripes]), slots = [];
    ROWS.forEach((size, row) => { for (let i = 0; i < size; i += 1) slots.push({ row, i, size }); });
    const order = slots.map((slot, index) => (index === 4 ? 8 : index === 10 ? corners[0] : index === 14 ? corners[1] : rest.pop()));
    const balls = [{ n: 0, x: HEAD_X, y: CY, vx: 0, vy: 0, in: false }];
    const gap = .02, dx = BR * Math.sqrt(3) + gap, jitter = () => (random() - .5) * .3;
    slots.forEach(({ row, i, size }, index) => balls.push({ n: order[index], x: FOOT_X + row * dx + jitter(), y: CY + (i - (size - 1) / 2) * (BR * 2 + gap) + jitter(), vx: 0, vy: 0, in: false }));
    return { balls, turn: breaker, groups: null, isBreak: true, ballInHand: true, kitchen: true, winner: null, message: 'BREAK SHOT — PLACE THE CUE BALL BEHIND THE LINE', shots: 0, match: [...match] };
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
  function pocketOf(x, y) {
    let best = 0, distance = Infinity;
    POCKETS.forEach(([px, py], index) => { const d = (px - x) ** 2 + (py - y) ** 2; if (d < distance) { distance = d; best = index; } });
    return best;
  }
  // Sound cues for the animation only (rules never read them): [step, kind, strength].
  const sound = (events, kind, strength) => { if (events.sfx && events.sfx.length < 400) events.sfx.push([events.now, kind, strength]); };

  // Advance one fixed step. `events` collects what the rules need: first contact and pocketed balls.
  function step(balls, events) {
    let moving = false;
    for (const b of balls) {
      if (b.in || (b.vx === 0 && b.vy === 0)) continue;
      b.x += b.vx * STEP; b.y += b.vy * STEP;
      if (b.y < T + BR && b.vy < 0 && !inMouthX(b.x)) { b.y = T + BR; english(b, -b.vy, true); sound(events, 'rail', -b.vy); b.vy = -b.vy * .78; b.vx *= .96; }
      if (b.y > B - BR && b.vy > 0 && !inMouthX(b.x)) { b.y = B - BR; english(b, b.vy, true); sound(events, 'rail', b.vy); b.vy = -b.vy * .78; b.vx *= .96; }
      if (b.x < L + BR && b.vx < 0 && !inMouthY(b.y)) { b.x = L + BR; english(b, -b.vx, false); sound(events, 'rail', -b.vx); b.vx = -b.vx * .78; b.vy *= .96; }
      if (b.x > R - BR && b.vx > 0 && !inMouthY(b.y)) { b.x = R - BR; english(b, b.vx, false); sound(events, 'rail', b.vx); b.vx = -b.vx * .78; b.vy *= .96; }
      // Rails bounce everywhere except at the pocket mouths, so a centre past the rail line has dropped.
      if (b.x < L || b.x > R || b.y < T || b.y > B) { b.in = true; b.vx = 0; b.vy = 0; events.pocketed.push(b.n); events.into[b.n] = pocketOf(b.x, b.y); sound(events, 'pocket', b.n); }
    }
    // Contacts are found first and resolved together from the same velocities, repeated a few times per step so a hit
    // still travels through a packed rack. Resolving pairs one at a time in list order favoured one side of the rack
    // and sent the break into the same corner every time.
    for (let pass = 0; pass < 8; pass += 1) {
      const contacts = [];
      for (let i = 0; i < balls.length; i += 1) {
        const a = balls[i]; if (a.in) continue;
        for (let j = i + 1; j < balls.length; j += 1) {
          const c = balls[j]; if (c.in) continue;
          const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * BR * BR || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          contacts.push({ a, c, nx, ny, push: (BR * 2 - d) / 2, approach: (a.vx - c.vx) * nx + (a.vy - c.vy) * ny });
        }
      }
      if (!contacts.length) break;
      for (const { a, c, nx, ny, push, approach } of contacts) {
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
        if (approach <= 0) continue;
        const cue = a.n === 0 ? a : c.n === 0 ? c : null, cueSpeed = cue && cue.top ? Math.sqrt(cue.vx * cue.vx + cue.vy * cue.vy) : 0;
        const pathX = cueSpeed ? cue.vx / cueSpeed : 0, pathY = cueSpeed ? cue.vy / cueSpeed : 0;
        const impulse = approach * .98;
        sound(events, 'click', approach);
        a.vx -= impulse * nx; a.vy -= impulse * ny; c.vx += impulse * nx; c.vy += impulse * ny;
        // Follow carries the cue ball on through the object ball; draw (negative) pulls it back.
        if (cueSpeed) { cue.vx += pathX * cue.top; cue.vy += pathY * cue.top; cue.top = 0; }
        if (events.firstHit === null && (a.n === 0 || c.n === 0)) events.firstHit = a.n === 0 ? c.n : a.n;
      }
    }
    for (const b of balls) {
      if (b.in || (b.vx === 0 && b.vy === 0)) continue;
      if (b.top) b.top *= 1 - FOLLOW_FADE * STEP;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy), next = speed - (115 + speed * .25) * STEP;
      if (next < 4) { b.vx = 0; b.vy = 0; } else { b.vx *= next / speed; b.vy *= next / speed; moving = true; }
    }
    return moving;
  }

  // Side spin pushes the cue ball along the rail toward its own right (positive) or left as it rebounds, then
  // half of it wears off. `alongX` is true for the top and bottom rails. Called before the bounce flips velocity.
  function english(b, into, alongX) {
    if (!b.side) return;
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy), kick = b.side * ENGLISH * into;
    if (!speed) return;
    if (alongX) b.vx += kick * b.vy / speed; else b.vy -= kick * b.vx / speed;
    b.side *= .5;
  }

  // Validate a shot from the shooter's browser; returns null when it cannot be played on this table.
  function normalizeShot(state, shot) {
    const vx = Number(shot?.vx), vy = Number(shot?.vy), cueX = Number(shot?.cueX), cueY = Number(shot?.cueY);
    const clamp = (value) => (Number.isFinite(Number(value)) ? Math.max(-1, Math.min(1, Number(value))) : 0);
    const spinX = clamp(shot?.spinX), spinY = clamp(shot?.spinY);
    // The pocket called for the black (0–5). Only checked when the shooter is on the black.
    const call = Number.isInteger(shot?.call) && shot.call >= 0 && shot.call < POCKETS.length ? shot.call : null;
    if (![vx, vy].every(Number.isFinite) || vx * vx + vy * vy > MAX_SPEED * MAX_SPEED * 1.01 || vx * vx + vy * vy < 1) return null;
    const cue = ball(state, 0);
    if (state.ballInHand) { if (!Number.isFinite(cueX) || !Number.isFinite(cueY) || !canPlaceCue(state, cueX, cueY)) return null; return { vx, vy, cueX, cueY, spinX, spinY, call }; }
    return { vx, vy, cueX: cue.x, cueY: cue.y, spinX, spinY, call };
  }

  // A shot in progress, advanced a few steps per animation frame so both browsers draw the same motion.
  function beginShot(state, shot, { sounds = false } = {}) {
    const sim = clone(state), cue = ball(sim, 0);
    cue.in = false; cue.x = shot.cueX; cue.y = shot.cueY; cue.vx = shot.vx; cue.vy = shot.vy;
    cue.top = (shot.spinY || 0) * Math.sqrt(shot.vx * shot.vx + shot.vy * shot.vy) * FOLLOW; cue.side = shot.spinX || 0;
    const events = { firstHit: null, pocketed: [], into: {}, now: 0, sfx: sounds ? [] : null };
    return { before: state, shot, table: sim, events, steps: 0, done: false };
  }
  function advance(run, steps) {
    for (let i = 0; i < steps && !run.done; i += 1) {
      run.steps += 1; run.events.now = run.steps;
      if (!step(run.table.balls, run.events) || run.steps >= MAX_STEPS) run.done = true;
    }
    return run.done;
  }

  function respotEight(table) {
    const eight = ball(table, 8); eight.in = false; eight.vx = 0; eight.vy = 0;
    for (let x = FOOT_X; x < R - BR; x += 1) if (table.balls.every((b) => b.n === 8 || b.in || (b.x - x) ** 2 + (b.y - CY) ** 2 >= 4 * BR * BR)) { eight.x = x; eight.y = CY; return; }
    eight.x = FOOT_X; eight.y = CY;
  }

  // Apply the rules to the finished simulation and return the next table state.
  function resolve(run) {
    const before = run.before, next = run.table, { firstHit, pocketed, into } = run.events, call = run.shot?.call ?? null;
    const seat = before.turn, other = 1 - seat, wasOnEight = onEight(before, seat), wasBreak = before.isBreak;
    const scratch = pocketed.includes(0), objects = pocketed.filter((n) => n !== 0 && n !== 8);
    let foul = null;
    if (scratch) foul = 'SCRATCH';
    else if (firstHit === null) foul = 'NO BALL HIT';
    else if (!wasBreak && wasOnEight && firstHit !== 8) foul = 'HIT THE BLACK FIRST';
    else if (!wasBreak && !wasOnEight && before.groups && !inGroup(firstHit, groupOf(before, seat))) foul = 'WRONG BALL FIRST';
    else if (!wasBreak && !before.groups && firstHit === 8) foul = 'HIT THE BLACK FIRST';

    next.balls.forEach((b) => { b.vx = 0; b.vy = 0; delete b.top; delete b.side; });
    next.isBreak = false; next.kitchen = false; next.ballInHand = false; next.shots = before.shots + 1;
    const match = before.match || [0, 0];
    const names = ['PLAYER 1', 'PLAYER 2'];

    if (pocketed.includes(8)) {
      if (wasBreak) respotEight(next);
      else {
        const wrongPocket = wasOnEight && !foul && call !== null && into[8] !== call;
        next.winner = wasOnEight && !foul && !wrongPocket ? seat : other;
        next.message = next.winner === seat ? 'SANK THE BLACK — RACK WON' : wrongPocket ? 'BLACK IN THE WRONG POCKET' : foul ? `BLACK DOWN ON A FOUL (${foul})` : 'BLACK DOWN EARLY';
        next.match = next.winner === 0 ? [match[0] + 1, match[1]] : [match[0], match[1] + 1];
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

  return { W, H, L, R, T, B, BR, MID, HEAD_X, CY, MAX_SPEED, FOLLOW, FOLLOW_FADE, POCKETS, STEP, pocketOf, isSolid, isStripe, inGroup, newRack, canPlaceCue, normalizeShot, beginShot, advance, resolve, playShot, remaining, onEight, clone };
})();
