// === RETRO HOCKEY ===

// --- Constants ---
const RINK_W = 800;
const RINK_H = 500;
const BOARD_PAD = 40;                  // distance from canvas edge to ice surface
const RINK_LEFT = BOARD_PAD;
const RINK_RIGHT = RINK_W - BOARD_PAD;
const RINK_TOP = BOARD_PAD;
const RINK_BOTTOM = RINK_H - BOARD_PAD;
const RINK_CENTER_X = RINK_W / 2;
const RINK_CENTER_Y = RINK_H / 2;

const GOAL_WIDTH = 70;
const GOAL_DEPTH = 18;
const GOAL_MOUTH_TOP = RINK_CENTER_Y - GOAL_WIDTH / 2;
const GOAL_MOUTH_BOTTOM = RINK_CENTER_Y + GOAL_WIDTH / 2;
const LEFT_GOAL_LINE_X = RINK_LEFT + 4;
const RIGHT_GOAL_LINE_X = RINK_RIGHT - 4;

const PLAYER_R = 13;
const PUCK_R = 5;

const PLAYER_SPEED = 3.6;
const AI_SPEED = 3.15;
const GOALIE_REACT = 0.14;
const PUCK_FRICTION = 0.987;
const PUCK_BOUNCE = 0.55;
const SHOT_SPEED = 12;
const PASS_SPEED = 8;
const PICKUP_COOLDOWN_FRAMES = 10;
const STEAL_CHANCE = 0.03;             // per-frame chance to strip the puck while pressed against the carrier

const PERIOD_SECONDS = 180;
const PERIODS = 3;
const FACEOFF_FRAMES = 80;

const HOME = { name: 'HOME', color: '#e63946', dark: '#7a1318', goalie: '#ffb703', goalieDark: '#aa6a00' };
const AWAY = { name: 'AWAY', color: '#457b9d', dark: '#1d3557', goalie: '#06d6a0', goalieDark: '#04795b' };

// --- DOM ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// --- State ---
const state = {
  players: [],
  puck: { x: RINK_CENTER_X, y: RINK_CENTER_Y, vx: 0, vy: 0, ownerId: null, pickupCD: 0 },
  homeScore: 0,
  awayScore: 0,
  period: 1,
  clock: PERIOD_SECONDS,
  faceoffTimer: 0,
  pendingFaceoff: null,        // { x, y } where to drop puck after timer
  message: '',
  messageTimer: 0,
  gameOver: false,
  started: false,
};

let controlledId = null;
let possState = 'loose';            // who holds the puck: 'home' | 'away' | 'loose'

// --- Input ---
// Three independent movement sources, merged each frame with priority
// touch > mouse > keyboard. Keeping them separate stops one source from
// zeroing out another (the old bug: the keyboard poll wiped the joystick /
// mouse vector to 0 every frame, so only the keyboard ever worked).
const input = {
  touchX: 0, touchY: 0, touchId: null,
  mouseX: 0, mouseY: 0, mouseDown: false,
  keyX: 0, keyY: 0,
};
const keys = {};

// Direction the controlled skater should move this frame.
function moveVector() {
  if (input.touchId !== null) return { x: input.touchX, y: input.touchY };
  if (input.mouseDown) return { x: input.mouseX, y: input.mouseY };
  return { x: input.keyX, y: input.keyY };
}

function setupInput() {
  const joyEl = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  const shootBtn = document.getElementById('shoot-btn');
  const passBtn = document.getElementById('pass-btn');

  let joyRect = null;
  function refreshRect() { joyRect = joyEl.getBoundingClientRect(); }

  // Pointer position -> normalized [-1,1] vector, and move the knob to match.
  function joyVector(clientX, clientY) {
    if (!joyRect) refreshRect();
    const cx = joyRect.left + joyRect.width / 2;
    const cy = joyRect.top + joyRect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const max = joyRect.width / 2 - 8;
    const r = Math.min(max, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    knob.style.transform =
      `translate(calc(-50% + ${Math.cos(angle) * r}px), calc(-50% + ${Math.sin(angle) * r}px))`;
    return { x: Math.cos(angle) * (r / max), y: Math.sin(angle) * (r / max) };
  }

  function resetKnob() {
    knob.style.transform = 'translate(-50%, -50%)';
  }

  // --- Touch joystick ---
  joyEl.addEventListener('touchstart', e => {
    refreshRect();
    const t = e.changedTouches[0];
    input.touchId = t.identifier;
    const v = joyVector(t.clientX, t.clientY);
    input.touchX = v.x; input.touchY = v.y;
    e.preventDefault();
  }, { passive: false });

  joyEl.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === input.touchId) {
        const v = joyVector(t.clientX, t.clientY);
        input.touchX = v.x; input.touchY = v.y;
        break;
      }
    }
    e.preventDefault();
  }, { passive: false });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === input.touchId) {
        input.touchId = null;
        input.touchX = 0; input.touchY = 0;
        resetKnob();
      }
    }
  }
  joyEl.addEventListener('touchend', endTouch);
  joyEl.addEventListener('touchcancel', endTouch);

  // --- Mouse joystick (desktop) ---
  joyEl.addEventListener('mousedown', e => {
    refreshRect();
    input.mouseDown = true;
    const v = joyVector(e.clientX, e.clientY);
    input.mouseX = v.x; input.mouseY = v.y;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!input.mouseDown) return;
    const v = joyVector(e.clientX, e.clientY);
    input.mouseX = v.x; input.mouseY = v.y;
  });
  window.addEventListener('mouseup', () => {
    if (!input.mouseDown) return;
    input.mouseDown = false;
    input.mouseX = 0; input.mouseY = 0;
    resetKnob();
  });

  // --- Action buttons ---
  function bindButton(el, handler) {
    el.addEventListener('touchstart', e => { e.preventDefault(); handler(); }, { passive: false });
    el.addEventListener('mousedown', e => { e.preventDefault(); handler(); });
  }
  bindButton(shootBtn, tryShoot);
  bindButton(passBtn, onPass);

  // --- Keyboard ---
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.key === 'Enter') { tryShoot(); e.preventDefault(); }
    else if (e.key === 'Shift') { onPass(); e.preventDefault(); }
    else if (e.key === 'Tab' || e.key.toLowerCase() === 'q') { switchPlayer(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  window.addEventListener('resize', refreshRect);
}

// Build the keyboard movement vector. Writes ONLY input.key* — never the
// touch/mouse fields — so holding no keys can't wipe an active drag.
function computeKeyVector() {
  let dx = 0, dy = 0;
  if (keys['arrowleft'] || keys['a']) dx -= 1;
  if (keys['arrowright'] || keys['d']) dx += 1;
  if (keys['arrowup'] || keys['w']) dy -= 1;
  if (keys['arrowdown'] || keys['s']) dy += 1;
  const len = Math.hypot(dx, dy);
  if (len > 0) { input.keyX = dx / len; input.keyY = dy / len; }
  else { input.keyX = 0; input.keyY = 0; }
}

// --- Helpers ---
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPlayer(id) {
  return state.players.find(p => p.id === id);
}

function homeSkaters() {
  return state.players.filter(p => p.team === 'home' && !p.isGoalie);
}
function awaySkaters() {
  return state.players.filter(p => p.team === 'away' && !p.isGoalie);
}
function teammates(p) {
  return state.players.filter(q => q.team === p.team && q.id !== p.id && !q.isGoalie);
}

function nearestTo(point, pool) {
  let best = null, bestD = Infinity;
  for (const p of pool) {
    const d = dist(p, point);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// --- Player setup ---
function homeFormation() {
  return [
    { role: 'C',  hx: RINK_CENTER_X - 80, hy: RINK_CENTER_Y },
    { role: 'LW', hx: RINK_CENTER_X - 70, hy: RINK_CENTER_Y - 90 },
    { role: 'RW', hx: RINK_CENTER_X - 70, hy: RINK_CENTER_Y + 90 },
    { role: 'LD', hx: RINK_CENTER_X - 180, hy: RINK_CENTER_Y - 60 },
    { role: 'RD', hx: RINK_CENTER_X - 180, hy: RINK_CENTER_Y + 60 },
  ];
}
function awayFormation() {
  return [
    { role: 'C',  hx: RINK_CENTER_X + 80, hy: RINK_CENTER_Y },
    { role: 'LW', hx: RINK_CENTER_X + 70, hy: RINK_CENTER_Y + 90 },
    { role: 'RW', hx: RINK_CENTER_X + 70, hy: RINK_CENTER_Y - 90 },
    { role: 'LD', hx: RINK_CENTER_X + 180, hy: RINK_CENTER_Y + 60 },
    { role: 'RD', hx: RINK_CENTER_X + 180, hy: RINK_CENTER_Y - 60 },
  ];
}

function makePlayers() {
  const players = [];
  const homeNumbers = [91, 19, 27, 44, 8];
  const awayNumbers = [87, 13, 71, 4, 22];

  homeFormation().forEach((p, i) => {
    players.push({
      id: 'h' + i, team: 'home', role: p.role, isGoalie: false,
      x: p.hx, y: p.hy, vx: 0, vy: 0,
      hx: p.hx, hy: p.hy,
      number: homeNumbers[i],
    });
  });
  players.push({
    id: 'hG', team: 'home', role: 'G', isGoalie: true,
    x: RINK_LEFT + 28, y: RINK_CENTER_Y, vx: 0, vy: 0,
    hx: RINK_LEFT + 28, hy: RINK_CENTER_Y,
    number: 31,
  });

  awayFormation().forEach((p, i) => {
    players.push({
      id: 'a' + i, team: 'away', role: p.role, isGoalie: false,
      x: p.hx, y: p.hy, vx: 0, vy: 0,
      hx: p.hx, hy: p.hy,
      number: awayNumbers[i],
    });
  });
  players.push({
    id: 'aG', team: 'away', role: 'G', isGoalie: true,
    x: RINK_RIGHT - 28, y: RINK_CENTER_Y, vx: 0, vy: 0,
    hx: RINK_RIGHT - 28, hy: RINK_CENTER_Y,
    number: 30,
  });

  state.players = players;
}

// --- Controlled player selection (sticky) ---
function nearestHomeSkaterToPuck() {
  const n = nearestTo(state.puck, homeSkaters());
  return n ? n.id : null;
}

// Decide which home skater the human drives this frame. The key property is
// that it does NOT thrash: control only moves on meaningful events, never just
// because some other skater drifted closer to the puck.
function updateControlledPlayer() {
  const owner = state.puck.ownerId ? getPlayer(state.puck.ownerId) : null;
  const newPoss = owner ? owner.team : 'loose';
  const turnover = newPoss !== possState;     // possession changed hands this frame
  possState = newPoss;

  // Offense: you always control the home skater carrying the puck.
  if (owner && owner.team === 'home' && !owner.isGoalie) {
    controlledId = owner.id;
    return;
  }

  // Defense / loose puck: stay on the same skater so movement is predictable.
  // Re-target the skater nearest the puck only when possession just changed
  // (so you grab a sensible defender right when you lose the puck) or if the
  // current pick became invalid. Otherwise the player switches on demand.
  const cur = controlledId ? getPlayer(controlledId) : null;
  const validCur = cur && cur.team === 'home' && !cur.isGoalie;
  if (turnover || !validCur) {
    controlledId = nearestHomeSkaterToPuck();
  }
}

// Manual switch (PASS with no puck, or Q / Tab): jump to the home skater
// nearest the puck, skipping the one already controlled.
function switchPlayer() {
  if (!state.started || state.gameOver) return;
  const others = homeSkaters().filter(p => p.id !== controlledId);
  const target = nearestTo(state.puck, others.length ? others : homeSkaters());
  if (target) controlledId = target.id;
}

// --- Player movement / AI ---
function updatePlayers() {
  updateControlledPlayer();
  const puck = state.puck;
  const ownerId = puck.ownerId;
  const owner = ownerId ? getPlayer(ownerId) : null;

  for (const p of state.players) {
    if (p.isGoalie) { updateGoalie(p); continue; }

    if (p.id === controlledId) {
      // Human controlled
      const mv = moveVector();
      p.vx = mv.x * PLAYER_SPEED;
      p.vy = mv.y * PLAYER_SPEED;
    } else {
      computeAIVelocity(p, owner);
    }

    p.x += p.vx;
    p.y += p.vy;

    // Keep skaters on the ice (skaters can't go behind the goal line into the net mouth).
    p.x = Math.max(RINK_LEFT + PLAYER_R, Math.min(RINK_RIGHT - PLAYER_R, p.x));
    p.y = Math.max(RINK_TOP + PLAYER_R, Math.min(RINK_BOTTOM - PLAYER_R, p.y));
  }

  resolvePlayerCollisions();
}

function computeAIVelocity(p, owner) {
  const puck = state.puck;
  let tx, ty;

  if (owner && owner.id === p.id) {
    // I have the puck — head toward opponent's goal.
    if (p.team === 'home') { tx = RIGHT_GOAL_LINE_X - 60; ty = RINK_CENTER_Y; }
    else { tx = LEFT_GOAL_LINE_X + 60; ty = RINK_CENTER_Y; }

    // Take a shot sometimes if in attacking zone.
    if (p.team === 'home' && p.x > RIGHT_GOAL_LINE_X - 140 && Math.random() < 0.04) aiShoot(p);
    if (p.team === 'away' && p.x < LEFT_GOAL_LINE_X + 140 && Math.random() < 0.04) aiShoot(p);
  } else if (owner && owner.team === p.team) {
    // Teammate has puck — support upfield.
    const dir = p.team === 'home' ? 1 : -1;
    const isDef = p.role === 'LD' || p.role === 'RD';
    const lead = isDef ? -60 : 80;
    tx = clamp(owner.x + dir * lead, RINK_LEFT + 50, RINK_RIGHT - 50);
    ty = p.hy + (owner.y - RINK_CENTER_Y) * 0.4;
  } else if (owner) {
    // Opponent has puck — defend.
    const myGoalX = p.team === 'home' ? LEFT_GOAL_LINE_X : RIGHT_GOAL_LINE_X;
    const myTeam = p.team === 'home' ? homeSkaters() : awaySkaters();
    const closest = nearestTo(owner, myTeam);
    if (closest && closest.id === p.id) {
      // Press the puck carrier.
      tx = owner.x;
      ty = owner.y;
    } else {
      // Drop between carrier and own net.
      tx = (owner.x * 0.4 + myGoalX * 0.6);
      ty = (owner.y * 0.4 + p.hy * 0.6);
    }
  } else {
    // Loose puck — closest player chases, others hold.
    const myTeam = p.team === 'home' ? homeSkaters() : awaySkaters();
    const closest = nearestTo(puck, myTeam);
    if (closest && closest.id === p.id) {
      tx = puck.x; ty = puck.y;
    } else {
      tx = p.hx; ty = p.hy;
    }
  }

  // Slightly randomized to avoid identical paths.
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d > 2) {
    p.vx = (dx / d) * AI_SPEED;
    p.vy = (dy / d) * AI_SPEED;
  } else {
    p.vx *= 0.4; p.vy *= 0.4;
  }
}

function updateGoalie(g) {
  const puck = state.puck;
  const homeSide = g.team === 'home';
  const goalX = homeSide ? RINK_LEFT + 24 : RINK_RIGHT - 24;

  // Track puck Y, clamped within goal mouth area + a bit of slide.
  const trackY = clamp(puck.y, GOAL_MOUTH_TOP + 4, GOAL_MOUTH_BOTTOM - 4);
  const challenge = puckIsApproaching(g) ? 10 : 0;
  const targetX = homeSide ? goalX + challenge : goalX - challenge;

  g.vx = (targetX - g.x) * GOALIE_REACT;
  g.vy = (trackY - g.y) * GOALIE_REACT;
  g.x += g.vx;
  g.y += g.vy;

  // Keep goalie roughly in crease.
  if (homeSide) g.x = clamp(g.x, RINK_LEFT + 12, RINK_LEFT + 60);
  else g.x = clamp(g.x, RINK_RIGHT - 60, RINK_RIGHT - 12);
  g.y = clamp(g.y, GOAL_MOUTH_TOP - 8, GOAL_MOUTH_BOTTOM + 8);
}

function puckIsApproaching(g) {
  const puck = state.puck;
  if (!puck.ownerId) {
    if (g.team === 'home') return puck.vx < -2;
    return puck.vx > 2;
  }
  return false;
}

function resolvePlayerCollisions() {
  const ps = state.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = PLAYER_R * 2;
      if (d > 0 && d < minD) {
        const overlap = (minD - d) / 2;
        const nx = dx / d, ny = dy / d;
        if (!a.isGoalie) { a.x -= nx * overlap; a.y -= ny * overlap; }
        if (!b.isGoalie) { b.x += nx * overlap; b.y += ny * overlap; }
      }
    }
  }
}

// --- Puck physics ---
function updatePuck() {
  const puck = state.puck;
  if (puck.pickupCD > 0) puck.pickupCD--;

  if (puck.ownerId) {
    const owner = getPlayer(puck.ownerId);
    if (!owner) {
      puck.ownerId = null;
    } else {
      // Body-check steal: an opposing skater pressed against the carrier can
      // knock the puck loose, so you can actually win it back on defense.
      if (puck.pickupCD === 0) {
        for (const p of state.players) {
          if (p.isGoalie || p.team === owner.team) continue;
          if (dist(p, owner) < PLAYER_R * 2 + 2 && Math.random() < STEAL_CHANCE) {
            const ang = Math.atan2(owner.y - p.y, owner.x - p.x);
            puck.ownerId = null;
            puck.x = owner.x; puck.y = owner.y;
            puck.vx = Math.cos(ang) * 3.2 + (Math.random() - 0.5) * 2;
            puck.vy = Math.sin(ang) * 3.2 + (Math.random() - 0.5) * 2;
            puck.pickupCD = 8;   // brief window so it doesn't instantly re-stick
            break;
          }
        }
      }
      if (puck.ownerId) {
        // Carry puck just in front of player, based on velocity direction or facing.
        const moving = Math.hypot(owner.vx, owner.vy);
        let dirX, dirY;
        if (moving > 0.2) {
          dirX = owner.vx / moving;
          dirY = owner.vy / moving;
        } else {
          // Face toward opposing net if idle.
          dirX = owner.team === 'home' ? 1 : -1;
          dirY = 0;
        }
        const off = PLAYER_R + 4;
        puck.x = owner.x + dirX * off;
        puck.y = owner.y + dirY * off;
        puck.vx = 0; puck.vy = 0;
        return;
      }
      // else: stolen this frame — fall through to loose-puck physics below.
    }
  }

  // Free puck
  puck.x += puck.vx;
  puck.y += puck.vy;
  puck.vx *= PUCK_FRICTION;
  puck.vy *= PUCK_FRICTION;

  // Side board bounces, except inside goal mouth (let puck cross to score).
  const inMouth = puck.y > GOAL_MOUTH_TOP && puck.y < GOAL_MOUTH_BOTTOM;
  if (puck.x < RINK_LEFT + PUCK_R) {
    if (!inMouth) { puck.x = RINK_LEFT + PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  }
  if (puck.x > RINK_RIGHT - PUCK_R) {
    if (!inMouth) { puck.x = RINK_RIGHT - PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  }
  if (puck.y < RINK_TOP + PUCK_R) { puck.y = RINK_TOP + PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }
  if (puck.y > RINK_BOTTOM - PUCK_R) { puck.y = RINK_BOTTOM - PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }

  // Goal detection — puck crossed goal line within mouth, going outward.
  if (puck.x < LEFT_GOAL_LINE_X - 2 && inMouth) {
    state.awayScore++;
    triggerGoal('away');
    return;
  }
  if (puck.x > RIGHT_GOAL_LINE_X + 2 && inMouth) {
    state.homeScore++;
    triggerGoal('home');
    return;
  }

  // Player pickup / collision
  if (puck.pickupCD > 0) return;
  for (const p of state.players) {
    const d = dist(p, puck);
    const pr = p.isGoalie ? PLAYER_R + 1 : PLAYER_R;
    if (d < pr + PUCK_R) {
      if (p.isGoalie) {
        const speed = Math.hypot(puck.vx, puck.vy);
        if (speed < 3.5) {
          // Freeze the puck — goalie covers it, faceoff.
          puck.vx = 0; puck.vy = 0;
          puck.ownerId = null;
          puck.pickupCD = 30;
          scheduleFaceoff(p.team === 'home' ? leftFaceoff(puck.y) : rightFaceoff(puck.y), 'COVERED');
        } else {
          // Save — kick the puck back out.
          const nx = (puck.x - p.x) / (d || 1);
          const ny = (puck.y - p.y) / (d || 1);
          puck.vx = nx * 6 + (Math.random() - 0.5) * 2;
          puck.vy = ny * 6 + (Math.random() - 0.5) * 2;
          puck.x = p.x + nx * (pr + PUCK_R + 1);
          puck.y = p.y + ny * (pr + PUCK_R + 1);
          puck.pickupCD = 12;
        }
      } else {
        puck.ownerId = p.id;
      }
      break;
    }
  }
}

function leftFaceoff(y) {
  return { x: RINK_LEFT + 110, y: y < RINK_CENTER_Y ? RINK_CENTER_Y - 90 : RINK_CENTER_Y + 90 };
}
function rightFaceoff(y) {
  return { x: RINK_RIGHT - 110, y: y < RINK_CENTER_Y ? RINK_CENTER_Y - 90 : RINK_CENTER_Y + 90 };
}

// --- Actions ---
function tryShoot() {
  if (!state.started || state.gameOver || state.faceoffTimer > 0) return;
  const active = getPlayer(controlledId);
  if (!active) return;
  if (state.puck.ownerId !== active.id) return;
  const targetX = RIGHT_GOAL_LINE_X + 10;
  const targetY = RINK_CENTER_Y + (Math.random() - 0.5) * GOAL_WIDTH * 0.7;
  shootPuck(targetX, targetY, SHOT_SPEED);
}

// PASS button / Shift: pass when carrying, otherwise switch controlled skater.
function onPass() {
  const c = getPlayer(controlledId);
  if (c && state.puck.ownerId === c.id) tryPass();
  else switchPlayer();
}

function tryPass() {
  if (!state.started || state.gameOver || state.faceoffTimer > 0) return;
  const active = getPlayer(controlledId);
  if (!active) return;
  if (state.puck.ownerId !== active.id) return;
  // Pick best forward teammate; fall back to nearest.
  const mates = teammates(active);
  let best = null, bestScore = -Infinity;
  for (const m of mates) {
    const forward = (m.x - active.x);  // home attacks right
    const d = dist(m, active);
    if (d < 50) continue;
    const score = forward * 1.2 - d * 0.6;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (!best) best = nearestTo(active, mates);
  if (!best) return;
  shootPuck(best.x, best.y, PASS_SPEED);
  // Control follows the pass to the receiver; pin possession state so
  // updateControlledPlayer doesn't immediately re-target on this turnover.
  controlledId = best.id;
  possState = 'loose';
}

function shootPuck(tx, ty, speed) {
  const puck = state.puck;
  const dx = tx - puck.x, dy = ty - puck.y;
  const len = Math.hypot(dx, dy) || 1;
  puck.vx = (dx / len) * speed;
  puck.vy = (dy / len) * speed;
  puck.ownerId = null;
  puck.pickupCD = PICKUP_COOLDOWN_FRAMES;
}

function aiShoot(p) {
  const targetX = p.team === 'home' ? RIGHT_GOAL_LINE_X + 10 : LEFT_GOAL_LINE_X - 10;
  const targetY = RINK_CENTER_Y + (Math.random() - 0.5) * GOAL_WIDTH * 0.7;
  shootPuck(targetX, targetY, SHOT_SPEED - 1);
}

// --- Game flow ---
function triggerGoal(team) {
  state.message = 'GOAL!';
  state.messageTimer = FACEOFF_FRAMES;
  state.faceoffTimer = FACEOFF_FRAMES;
  state.pendingFaceoff = { x: RINK_CENTER_X, y: RINK_CENTER_Y };
}

function scheduleFaceoff(point, label) {
  if (state.faceoffTimer > 0) return;
  state.message = label;
  state.messageTimer = 60;
  state.faceoffTimer = 60;
  state.pendingFaceoff = point;
}

function runFaceoff() {
  const fo = state.pendingFaceoff || { x: RINK_CENTER_X, y: RINK_CENTER_Y };
  state.puck.x = fo.x;
  state.puck.y = fo.y;
  state.puck.vx = 0; state.puck.vy = 0;
  state.puck.ownerId = null;
  state.puck.pickupCD = 0;

  // Reset positions to home spots, shifted relative to faceoff point.
  const dx = fo.x - RINK_CENTER_X;
  const dy = fo.y - RINK_CENTER_Y;
  for (const p of state.players) {
    if (p.isGoalie) continue;
    p.x = p.hx + dx * 0.3;
    p.y = p.hy + dy * 0.3;
    p.vx = 0; p.vy = 0;
  }
  state.pendingFaceoff = null;
}

function updateClock() {
  if (state.gameOver) return;
  state.clock -= 1 / 60;
  if (state.clock <= 0) {
    state.clock = 0;
    if (state.period < PERIODS) {
      state.period++;
      state.clock = PERIOD_SECONDS;
      state.message = 'PERIOD ' + state.period;
      state.messageTimer = 90;
      state.faceoffTimer = 90;
      state.pendingFaceoff = { x: RINK_CENTER_X, y: RINK_CENTER_Y };
    } else {
      state.gameOver = true;
      const result = state.homeScore > state.awayScore ? 'HOME WINS' :
        state.homeScore < state.awayScore ? 'AWAY WINS' : 'TIE GAME';
      state.message = result;
      state.messageTimer = 99999;
    }
  }
}

// --- Rendering ---
function render() {
  // Background
  ctx.fillStyle = '#040810';
  ctx.fillRect(0, 0, RINK_W, RINK_H);

  // Ice
  ctx.fillStyle = '#e9f3ff';
  roundRect(ctx, RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 36, true, false);

  // Ice shading (subtle stripes)
  ctx.fillStyle = 'rgba(180, 210, 240, 0.4)';
  for (let y = RINK_TOP + 20; y < RINK_BOTTOM; y += 60) {
    ctx.fillRect(RINK_LEFT + 4, y, RINK_RIGHT - RINK_LEFT - 8, 2);
  }

  // Center red line
  ctx.fillStyle = '#d63031';
  ctx.fillRect(RINK_CENTER_X - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);

  // Blue lines
  ctx.fillStyle = '#1f7ad6';
  const blueLeft = RINK_LEFT + (RINK_RIGHT - RINK_LEFT) * 0.32;
  const blueRight = RINK_LEFT + (RINK_RIGHT - RINK_LEFT) * 0.68;
  ctx.fillRect(blueLeft - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);
  ctx.fillRect(blueRight - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);

  // Goal lines (thin red)
  ctx.fillStyle = '#d63031';
  ctx.fillRect(LEFT_GOAL_LINE_X, RINK_TOP, 2, RINK_BOTTOM - RINK_TOP);
  ctx.fillRect(RIGHT_GOAL_LINE_X, RINK_TOP, 2, RINK_BOTTOM - RINK_TOP);

  // Center circle
  ctx.strokeStyle = '#1f7ad6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 50, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1f7ad6';
  ctx.beginPath();
  ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Zone faceoff dots and circles
  const dots = [
    [RINK_LEFT + 110, RINK_CENTER_Y - 90],
    [RINK_LEFT + 110, RINK_CENTER_Y + 90],
    [RINK_RIGHT - 110, RINK_CENTER_Y - 90],
    [RINK_RIGHT - 110, RINK_CENTER_Y + 90],
  ];
  ctx.strokeStyle = '#d63031';
  ctx.fillStyle = '#d63031';
  for (const [x, y] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Neutral zone dots
  ctx.beginPath(); ctx.arc(RINK_CENTER_X - 60, RINK_CENTER_Y - 90, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(RINK_CENTER_X - 60, RINK_CENTER_Y + 90, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(RINK_CENTER_X + 60, RINK_CENTER_Y - 90, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(RINK_CENTER_X + 60, RINK_CENTER_Y + 90, 3, 0, Math.PI * 2); ctx.fill();

  // Creases
  ctx.fillStyle = 'rgba(30, 122, 214, 0.28)';
  ctx.beginPath();
  ctx.arc(LEFT_GOAL_LINE_X, RINK_CENTER_Y, 32, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(RIGHT_GOAL_LINE_X, RINK_CENTER_Y, 32, Math.PI / 2, 3 * Math.PI / 2);
  ctx.fill();

  // Nets (drawn outside goal line into board)
  drawNet(LEFT_GOAL_LINE_X, true);
  drawNet(RIGHT_GOAL_LINE_X, false);

  // Boards (rounded outline)
  ctx.strokeStyle = '#0a1a2a';
  ctx.lineWidth = 5;
  roundRect(ctx, RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 36, false, true);

  // Players
  for (const p of state.players) drawPlayer(p);

  // Puck
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(state.puck.x, state.puck.y, PUCK_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Centered message overlay
  if (state.message && state.messageTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(0, RINK_CENTER_Y - 50, RINK_W, 100);
    ctx.fillStyle = '#ffeb3b';
    ctx.font = 'bold 56px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.message, RINK_CENTER_X, RINK_CENTER_Y);
  }

  updateHUD();
}

function drawNet(goalX, isLeft) {
  const dir = isLeft ? -1 : 1;
  const back = goalX + dir * GOAL_DEPTH;
  // Net body
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(Math.min(goalX, back), GOAL_MOUTH_TOP, GOAL_DEPTH, GOAL_WIDTH);
  // Mesh
  ctx.strokeStyle = 'rgba(120,120,120,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const xx = Math.min(goalX, back) + (i / 4) * GOAL_DEPTH;
    ctx.beginPath();
    ctx.moveTo(xx, GOAL_MOUTH_TOP);
    ctx.lineTo(xx, GOAL_MOUTH_BOTTOM);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const yy = GOAL_MOUTH_TOP + (i / 5) * GOAL_WIDTH;
    ctx.beginPath();
    ctx.moveTo(Math.min(goalX, back), yy);
    ctx.lineTo(Math.min(goalX, back) + GOAL_DEPTH, yy);
    ctx.stroke();
  }
  // Posts (red)
  ctx.strokeStyle = '#d63031';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(goalX, GOAL_MOUTH_TOP);
  ctx.lineTo(goalX, GOAL_MOUTH_BOTTOM);
  ctx.stroke();
}

function drawPlayer(p) {
  const team = p.team === 'home' ? HOME : AWAY;
  const isActive = p.id === controlledId;
  const body = p.isGoalie ? team.goalie : team.color;
  const dark = p.isGoalie ? team.goalieDark : team.dark;

  // Active glow
  if (isActive) {
    ctx.fillStyle = 'rgba(255, 235, 59, 0.45)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outline / shadow
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_R + 1, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_R - 1, 0, Math.PI * 2);
  ctx.fill();

  // Active ring
  if (isActive) {
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Number
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(p.number), p.x, p.y + 1);
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function updateHUD() {
  document.getElementById('home-score').textContent = state.homeScore;
  document.getElementById('away-score').textContent = state.awayScore;
  document.getElementById('period').textContent = 'P' + state.period;
  const total = Math.max(0, state.clock);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  document.getElementById('clock').textContent = m + ':' + (s < 10 ? '0' + s : s);
}

// --- Main loop ---
function tick() {
  computeKeyVector();

  if (state.started && !state.gameOver) {
    if (state.faceoffTimer > 0) {
      state.faceoffTimer--;
      if (state.faceoffTimer === 0) runFaceoff();
    } else {
      updatePlayers();
      updatePuck();
      updateClock();
    }
  }
  if (state.messageTimer > 0) state.messageTimer--;

  render();
  requestAnimationFrame(tick);
}

// --- Utils ---
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- Boot ---
function start() {
  makePlayers();
  state.started = true;
  document.getElementById('splash').classList.add('hidden');
}

makePlayers();
setupInput();
document.getElementById('start-btn').addEventListener('click', start);
document.getElementById('start-btn').addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });

render();
requestAnimationFrame(tick);
