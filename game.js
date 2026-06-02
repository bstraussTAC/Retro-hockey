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

const GOAL_WIDTH = 88;
const GOAL_DEPTH = 18;
const GOAL_MOUTH_TOP = RINK_CENTER_Y - GOAL_WIDTH / 2;
const GOAL_MOUTH_BOTTOM = RINK_CENTER_Y + GOAL_WIDTH / 2;
const LEFT_GOAL_LINE_X = RINK_LEFT + 4;
const RIGHT_GOAL_LINE_X = RINK_RIGHT - 4;

const PLAYER_R = 13;
const PUCK_R = 5;

const PLAYER_SPEED = 2.5;              // slowed for a more deliberate, controllable pace
const AI_SPEED = 2.2;
const PUCK_FRICTION = 0.985;
const PUCK_BOUNCE = 0.55;
const SHOT_SPEED = 9;
const PASS_SPEED = 5.5;
const PICKUP_COOLDOWN_FRAMES = 10;

// Goalies: reaction + a paddle-style save area. Tuned to stop most shots but
// stay beatable to the corners (so games aren't 0-0 walls).
const GOALIE_REACT_X = 0.18;
const GOALIE_REACT_Y = 0.08;           // lateral tracking lag: low react => hard/angled shots beat it
const GOALIE_REACH_X = 9;              // shallow save plane (near the line)
const GOALIE_REACH_Y = 12;             // half-height of save coverage (~matches the drawn body)

// Body check: a deliberate hit (SHOOT button with no puck) that can strip the carrier.
const CHECK_RANGE = PLAYER_R * 2 + 12;
const CHECK_COOLDOWN = 32;             // frames between checks from the same skater
const CHECK_KNOCKBACK = 4.2;
const CHECK_STUN = 16;                 // frames a hit skater is knocked off balance
const AI_CHECK_CHANCE = 0.05;          // per-frame chance an AI presser throws a check when in range

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
  puck: { x: RINK_CENTER_X, y: RINK_CENTER_Y, vx: 0, vy: 0, ownerId: null, pickupCD: 0, trail: [], prevX: RINK_CENTER_X, prevY: RINK_CENTER_Y },
  homeScore: 0,
  awayScore: 0,
  period: 1,
  clock: PERIOD_SECONDS,
  faceoffTimer: 0,
  pendingFaceoff: null,        // { x, y } where to drop puck after timer
  message: '',
  messageTimer: 0,
  goalFlash: 0,                // frames remaining on the goal-celebration flash
  goalFlashTeam: null,
  shake: 0,                    // screen-shake frames (goals / big hits)
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
  bindButton(shootBtn, onShoot);
  bindButton(passBtn, onPass);

  // --- Keyboard ---
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.key === 'Enter') { onShoot(); e.preventDefault(); }
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

  // Shared per-player fields used by movement, facing, checks and stuns.
  for (const p of players) {
    p.facing = p.team === 'home' ? 0 : Math.PI;
    p.checkCD = 0;
    p.stun = 0;
  }

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
    if (p.checkCD > 0) p.checkCD--;
    if (p.isGoalie) { updateGoalie(p); continue; }

    if (p.stun > 0) {
      // Knocked off balance by a check — coast and decelerate, no control.
      p.stun--;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.86; p.vy *= 0.86;
    } else if (p.id === controlledId) {
      // Human controlled
      const mv = moveVector();
      p.vx = mv.x * PLAYER_SPEED;
      p.vy = mv.y * PLAYER_SPEED;
      p.x += p.vx; p.y += p.vy;
    } else {
      computeAIVelocity(p, owner);
      p.x += p.vx; p.y += p.vy;
    }

    // Face the way you're moving; a still puck-carrier faces up-ice.
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.25) p.facing = Math.atan2(p.vy, p.vx);
    else if (puck.ownerId === p.id) p.facing = p.team === 'home' ? 0 : Math.PI;

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
    // I have the puck — drive toward the slot in front of the opponent's net.
    const attackGoalX = p.team === 'home' ? RIGHT_GOAL_LINE_X : LEFT_GOAL_LINE_X;
    tx = attackGoalX + (p.team === 'home' ? -55 : 55);
    ty = RINK_CENTER_Y + (p.hy - RINK_CENTER_Y) * 0.3;

    // Shoot more from in tight, rarely from distance (distance shots get eaten).
    const dGoal = Math.abs(attackGoalX - p.x);
    if (dGoal < 150) {
      const shootP = dGoal < 75 ? 0.11 : 0.03;
      if (Math.random() < shootP) aiShoot(p);
    }
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
      // Press the puck carrier, and throw a check if right on top of them.
      tx = owner.x;
      ty = owner.y;
      if (dist(p, owner) < CHECK_RANGE && Math.random() < AI_CHECK_CHANCE) doBodyCheck(p);
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
  const lineX = homeSide ? LEFT_GOAL_LINE_X : RIGHT_GOAL_LINE_X;
  const restX = homeSide ? lineX + 16 : lineX - 16;

  let targetX = restX;
  let targetY = clamp(puck.y, GOAL_MOUTH_TOP + 2, GOAL_MOUTH_BOTTOM - 2);

  if (puck.ownerId) {
    // Square up to the puck carrier.
    const carrier = getPlayer(puck.ownerId);
    if (carrier) targetY = clamp(carrier.y, GOAL_MOUTH_TOP + 2, GOAL_MOUTH_BOTTOM - 2);
  }

  // Track the puck with lag (low react). A hard or angled shot moves across the
  // net faster than the goalie can recover, opening the far side.
  g.vx = (targetX - g.x) * GOALIE_REACT_X;
  g.vy = (targetY - g.y) * GOALIE_REACT_Y;
  g.x += g.vx;
  g.y += g.vy;

  // Keep goalie in/around the crease.
  if (homeSide) g.x = clamp(g.x, lineX + 6, lineX + 54);
  else g.x = clamp(g.x, lineX - 54, lineX - 6);
  g.y = clamp(g.y, GOAL_MOUTH_TOP - 4, GOAL_MOUTH_BOTTOM + 4);

  if (Math.hypot(g.vx, g.vy) > 0.25) g.facing = Math.atan2(g.vy, g.vx);
  else g.facing = homeSide ? 0 : Math.PI;
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
      // Carry the puck just ahead of the skater (movement / facing direction).
      const moving = Math.hypot(owner.vx, owner.vy);
      let dirX, dirY;
      if (moving > 0.2) {
        dirX = owner.vx / moving;
        dirY = owner.vy / moving;
      } else {
        dirX = owner.team === 'home' ? 1 : -1;
        dirY = 0;
      }
      const off = PLAYER_R + 4;
      puck.x = owner.x + dirX * off;
      puck.y = owner.y + dirY * off;
      puck.vx = 0; puck.vy = 0;
      pushTrail(puck);
      return;
    }
  }

  // Free puck
  puck.prevX = puck.x;
  puck.prevY = puck.y;
  puck.x += puck.vx;
  puck.y += puck.vy;
  puck.vx *= PUCK_FRICTION;
  puck.vy *= PUCK_FRICTION;
  pushTrail(puck);

  // Side board bounces, except inside goal mouth (let puck cross to score).
  const inMouth = puck.y > GOAL_MOUTH_TOP && puck.y < GOAL_MOUTH_BOTTOM;
  if (puck.x < RINK_LEFT + PUCK_R && !inMouth) { puck.x = RINK_LEFT + PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  if (puck.x > RINK_RIGHT - PUCK_R && !inMouth) { puck.x = RINK_RIGHT - PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  if (puck.y < RINK_TOP + PUCK_R) { puck.y = RINK_TOP + PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }
  if (puck.y > RINK_BOTTOM - PUCK_R) { puck.y = RINK_BOTTOM - PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }

  // Goalie save — runs before goal detection so a stopped puck never counts.
  if (puck.pickupCD === 0 && tryGoalieSave()) return;

  // Goal detection — puck crossed goal line within mouth.
  if (puck.x < LEFT_GOAL_LINE_X - 2 && inMouth) { state.awayScore++; triggerGoal('away'); return; }
  if (puck.x > RIGHT_GOAL_LINE_X + 2 && inMouth) { state.homeScore++; triggerGoal('home'); return; }

  // Skater pickup.
  if (puck.pickupCD > 0) return;
  for (const p of state.players) {
    if (p.isGoalie) continue;
    if (dist(p, puck) < PLAYER_R + PUCK_R) { puck.ownerId = p.id; break; }
  }
}

function pushTrail(puck) {
  puck.trail.push({ x: puck.x, y: puck.y });
  if (puck.trail.length > 7) puck.trail.shift();
}

// Goalie save: test where a shot crosses the goalie's plane (so the puck has
// fully diverged toward its corner by then), plus a smother for slow pucks in
// the crease. The goalie's capped slide speed is what lets corner shots beat it.
function tryGoalieSave() {
  const puck = state.puck;
  const speed = Math.hypot(puck.vx, puck.vy);
  for (const g of state.players) {
    if (!g.isGoalie) continue;
    const homeSide = g.team === 'home';
    const lineX = homeSide ? LEFT_GOAL_LINE_X : RIGHT_GOAL_LINE_X;
    // Where the shot crosses the goal LINE this frame (divergence fully realized).
    const dx = puck.x - puck.prevX;
    const crossedLine = homeSide ? (puck.prevX >= lineX && puck.x <= lineX)
                                 : (puck.prevX <= lineX && puck.x >= lineX);
    if (crossedLine && Math.abs(dx) > 0.001) {
      const frac = (lineX - puck.prevX) / dx;
      const yCross = puck.prevY + frac * (puck.y - puck.prevY);
      // A save only if the shot was on net and the goalie covers that height.
      if (yCross > GOAL_MOUTH_TOP && yCross < GOAL_MOUTH_BOTTOM &&
          Math.abs(yCross - g.y) < GOALIE_REACH_Y + PUCK_R) return goalieSave(g, false);
    }
    // Smother a slow puck sitting in the crease (rebounds, dump-ins).
    if (speed < 3.2 &&
        Math.abs(puck.x - g.x) < GOALIE_REACH_X + PUCK_R &&
        Math.abs(puck.y - g.y) < GOALIE_REACH_Y + PUCK_R) return goalieSave(g, true);
  }
  return false;
}

function goalieSave(g, cover) {
  const puck = state.puck;
  const outX = g.team === 'home' ? 1 : -1;
  if (cover) {
    // Freeze it — whistle, faceoff in the zone.
    puck.vx = 0; puck.vy = 0; puck.ownerId = null; puck.pickupCD = 30;
    scheduleFaceoff(g.team === 'home' ? leftFaceoff(puck.y) : rightFaceoff(puck.y), 'WHISTLE');
  } else {
    // Kick out a rebound from the save plane.
    puck.x = g.x + outX * (GOALIE_REACH_X + PUCK_R + 2);
    puck.vx = outX * (3.2 + Math.random() * 1.8);
    puck.vy = (Math.random() - 0.5) * 4.5;
    puck.pickupCD = 10;
  }
  return true;
}

function leftFaceoff(y) {
  return { x: RINK_LEFT + 110, y: y < RINK_CENTER_Y ? RINK_CENTER_Y - 90 : RINK_CENTER_Y + 90 };
}
function rightFaceoff(y) {
  return { x: RINK_RIGHT - 110, y: y < RINK_CENTER_Y ? RINK_CENTER_Y - 90 : RINK_CENTER_Y + 90 };
}

// --- Actions ---
// SHOOT button / Space: shoot when carrying, otherwise throw a body check.
function onShoot() {
  if (!state.started || state.gameOver || state.faceoffTimer > 0) return;
  const c = getPlayer(controlledId);
  if (!c) return;
  if (state.puck.ownerId === c.id) tryShoot();
  else doBodyCheck(c);
}

function tryShoot() {
  if (!state.started || state.gameOver || state.faceoffTimer > 0) return;
  const active = getPlayer(controlledId);
  if (!active) return;
  if (state.puck.ownerId !== active.id) return;
  // Aim for the open half of the net, away from the goalie.
  const goalie = getPlayer('aG');
  const high = goalie ? goalie.y > RINK_CENTER_Y : Math.random() < 0.5;
  const targetY = high
    ? GOAL_MOUTH_TOP + 8 + Math.random() * 10
    : GOAL_MOUTH_BOTTOM - 8 - Math.random() * 10;
  shootPuck(RIGHT_GOAL_LINE_X + 10, targetY, SHOT_SPEED);
}

// A body check: hit the nearest opponent in range, knock them off balance, and
// strip the puck if they had it. Used by the human (SHOOT, no puck) and the AI.
function doBodyCheck(checker) {
  if (!checker || checker.isGoalie || checker.stun > 0 || checker.checkCD > 0) return false;
  checker.checkCD = CHECK_COOLDOWN;

  let target = null, bestD = CHECK_RANGE;
  for (const o of state.players) {
    if (o.isGoalie || o.team === checker.team) continue;
    const d = dist(o, checker);
    if (d < bestD) { bestD = d; target = o; }
  }
  if (!target) return false;

  const ang = Math.atan2(target.y - checker.y, target.x - checker.x);
  target.vx = Math.cos(ang) * CHECK_KNOCKBACK;
  target.vy = Math.sin(ang) * CHECK_KNOCKBACK;
  target.x += Math.cos(ang) * 3;
  target.y += Math.sin(ang) * 3;
  target.stun = CHECK_STUN;

  if (state.puck.ownerId === target.id) {
    // Strip the puck loose, away from the carrier.
    state.puck.ownerId = null;
    state.puck.x = target.x;
    state.puck.y = target.y;
    state.puck.vx = Math.cos(ang) * 3 + (Math.random() - 0.5) * 2;
    state.puck.vy = Math.sin(ang) * 3 + (Math.random() - 0.5) * 2;
    state.puck.pickupCD = 10;
  }
  // Shake the screen only for hits the human is involved in.
  if (checker.id === controlledId || target.id === controlledId) {
    state.shake = Math.max(state.shake, 6);
  }
  return true;
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
  const goalie = getPlayer(p.team === 'home' ? 'aG' : 'hG');
  let targetY;
  if (goalie && Math.random() < 0.6) {
    // Pick the open side away from the goalie.
    targetY = goalie.y > RINK_CENTER_Y ? GOAL_MOUTH_TOP + 10 : GOAL_MOUTH_BOTTOM - 10;
  } else {
    targetY = RINK_CENTER_Y + (Math.random() - 0.5) * GOAL_WIDTH * 0.7;
  }
  shootPuck(targetX, targetY, SHOT_SPEED - 1);
}

// --- Game flow ---
function triggerGoal(team) {
  state.message = 'GOAL!';
  state.messageTimer = FACEOFF_FRAMES;
  state.faceoffTimer = FACEOFF_FRAMES;
  state.pendingFaceoff = { x: RINK_CENTER_X, y: RINK_CENTER_Y };
  state.goalFlash = 45;
  state.goalFlashTeam = team;
  state.shake = 12;
  state.puck.ownerId = null;
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
    p.stun = 0;
  }
  state.puck.trail.length = 0;
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
  // Screen shake offset (goals / big hits).
  let sx = 0, sy = 0;
  if (state.shake > 0) {
    const m = state.shake * 0.6;
    sx = (Math.random() - 0.5) * m;
    sy = (Math.random() - 0.5) * m;
  }
  ctx.save();
  ctx.translate(sx, sy);

  // Dark arena background.
  ctx.fillStyle = '#070b16';
  ctx.fillRect(-12, -12, RINK_W + 24, RINK_H + 24);

  // Ice with a soft cool gradient.
  const ice = ctx.createLinearGradient(0, RINK_TOP, 0, RINK_BOTTOM);
  ice.addColorStop(0, '#f5faff');
  ice.addColorStop(1, '#d9e8fb');
  ctx.fillStyle = ice;
  roundRect(ctx, RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 36, true, false);

  // Clip rink markings to the ice surface.
  ctx.save();
  roundRect(ctx, RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 36, false, false);
  ctx.clip();
  // Subtle ice sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  for (let y = RINK_TOP + 16; y < RINK_BOTTOM; y += 54) {
    ctx.fillRect(RINK_LEFT, y, RINK_RIGHT - RINK_LEFT, 2);
  }
  drawRinkLines();
  drawCreases();
  ctx.restore();

  // Nets (light up for the scoring team during a goal).
  drawNet(LEFT_GOAL_LINE_X, true, state.goalFlash > 0 && state.goalFlashTeam === 'away');
  drawNet(RIGHT_GOAL_LINE_X, false, state.goalFlash > 0 && state.goalFlashTeam === 'home');

  // Boards.
  ctx.strokeStyle = '#10243b';
  ctx.lineWidth = 5;
  roundRect(ctx, RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 36, false, true);

  // Depth shadows, puck trail, then players (controlled one on top), then puck.
  for (const p of state.players) drawShadow(p);
  drawPuckTrail();
  for (const p of state.players) if (p.id !== controlledId) drawPlayer(p);
  const ctl = getPlayer(controlledId);
  if (ctl) drawPlayer(ctl);
  drawPuck();

  // Goal flash.
  if (state.goalFlash > 0) {
    const a = (state.goalFlash / 45) * 0.32;
    const col = state.goalFlashTeam === 'home' ? '230,57,70' : '69,123,157';
    ctx.fillStyle = `rgba(${col},${a})`;
    ctx.fillRect(0, 0, RINK_W, RINK_H);
  }

  drawVignette();

  // Centered message overlay.
  if (state.message && state.messageTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, RINK_CENTER_Y - 46, RINK_W, 92);
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 54px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.message, RINK_CENTER_X, RINK_CENTER_Y);
  }

  ctx.restore();
  updateHUD();
}

function drawRinkLines() {
  // Center red line.
  ctx.fillStyle = '#d23';
  ctx.fillRect(RINK_CENTER_X - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);
  // Blue lines.
  ctx.fillStyle = '#2a72d6';
  const blueLeft = RINK_LEFT + (RINK_RIGHT - RINK_LEFT) * 0.34;
  const blueRight = RINK_LEFT + (RINK_RIGHT - RINK_LEFT) * 0.66;
  ctx.fillRect(blueLeft - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);
  ctx.fillRect(blueRight - 3, RINK_TOP, 6, RINK_BOTTOM - RINK_TOP);
  // Goal lines.
  ctx.fillStyle = 'rgba(210,40,50,0.8)';
  ctx.fillRect(LEFT_GOAL_LINE_X, RINK_TOP, 2, RINK_BOTTOM - RINK_TOP);
  ctx.fillRect(RIGHT_GOAL_LINE_X, RINK_TOP, 2, RINK_BOTTOM - RINK_TOP);
  // Center circle + dot.
  ctx.strokeStyle = '#2a72d6';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 52, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#2a72d6';
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 4, 0, Math.PI * 2); ctx.fill();
  // Zone faceoff circles + dots.
  ctx.strokeStyle = '#d23';
  ctx.fillStyle = '#d23';
  const dots = [
    [RINK_LEFT + 110, RINK_CENTER_Y - 90], [RINK_LEFT + 110, RINK_CENTER_Y + 90],
    [RINK_RIGHT - 110, RINK_CENTER_Y - 90], [RINK_RIGHT - 110, RINK_CENTER_Y + 90],
  ];
  for (const [x, y] of dots) {
    ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const [x, y] of [
    [RINK_CENTER_X - 60, RINK_CENTER_Y - 90], [RINK_CENTER_X - 60, RINK_CENTER_Y + 90],
    [RINK_CENTER_X + 60, RINK_CENTER_Y - 90], [RINK_CENTER_X + 60, RINK_CENTER_Y + 90],
  ]) {
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawCreases() {
  ctx.fillStyle = 'rgba(42,114,214,0.30)';
  ctx.beginPath(); ctx.arc(LEFT_GOAL_LINE_X, RINK_CENTER_Y, 34, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.beginPath(); ctx.arc(RIGHT_GOAL_LINE_X, RINK_CENTER_Y, 34, Math.PI / 2, 3 * Math.PI / 2); ctx.fill();
}

function drawShadow(p) {
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + PLAYER_R - 2, PLAYER_R, PLAYER_R * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPuckTrail() {
  if (state.puck.ownerId) return;
  const t = state.puck.trail;
  for (let i = 0; i < t.length; i++) {
    const a = (i + 1) / t.length;
    ctx.fillStyle = `rgba(15,15,25,${a * 0.32})`;
    ctx.beginPath();
    ctx.arc(t[i].x, t[i].y, PUCK_R * (0.4 + a * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPuck() {
  const puck = state.puck;
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.stroke();
}

function drawVignette() {
  const g = ctx.createRadialGradient(
    RINK_CENTER_X, RINK_CENTER_Y, RINK_H * 0.34,
    RINK_CENTER_X, RINK_CENTER_Y, RINK_W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, RINK_W, RINK_H);
}

function drawNet(goalX, isLeft, lit) {
  const dir = isLeft ? -1 : 1;
  const back = goalX + dir * GOAL_DEPTH;
  const x0 = Math.min(goalX, back);
  // Net body (glows when scored on).
  ctx.fillStyle = lit ? 'rgba(255,90,90,0.6)' : 'rgba(244,248,255,0.92)';
  ctx.fillRect(x0, GOAL_MOUTH_TOP, GOAL_DEPTH, GOAL_WIDTH);
  // Mesh.
  ctx.strokeStyle = lit ? 'rgba(255,190,190,0.85)' : 'rgba(120,130,150,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const xx = x0 + (i / 4) * GOAL_DEPTH;
    ctx.beginPath(); ctx.moveTo(xx, GOAL_MOUTH_TOP); ctx.lineTo(xx, GOAL_MOUTH_BOTTOM); ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const yy = GOAL_MOUTH_TOP + (i / 5) * GOAL_WIDTH;
    ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + GOAL_DEPTH, yy); ctx.stroke();
  }
  // Posts.
  ctx.strokeStyle = '#e23';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(goalX, GOAL_MOUTH_TOP); ctx.lineTo(goalX, GOAL_MOUTH_BOTTOM); ctx.stroke();
}

function drawPlayer(p) {
  const team = p.team === 'home' ? HOME : AWAY;
  const isActive = p.id === controlledId;
  const body = p.isGoalie ? team.goalie : team.color;
  const dark = p.isGoalie ? team.goalieDark : team.dark;
  const r = PLAYER_R;

  // Active glow.
  if (isActive) {
    ctx.fillStyle = 'rgba(255,225,77,0.4)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2); ctx.fill();
  }

  // Stick (skaters only), pointing where they face.
  if (!p.isGoalie) {
    const fx = Math.cos(p.facing), fy = Math.sin(p.facing);
    ctx.strokeStyle = '#caa46a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x + fx * (r - 3), p.y + fy * (r - 3));
    ctx.lineTo(p.x + fx * (r + 11), p.y + fy * (r + 11));
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Dark rim.
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  // Body.
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(p.x, p.y, r - 2, 0, Math.PI * 2); ctx.fill();
  // Top highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(p.x - 3, p.y - 4, r * 0.5, 0, Math.PI * 2); ctx.fill();

  // Active ring.
  if (isActive) {
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2); ctx.stroke();
  }

  // Number.
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
  if (state.goalFlash > 0) state.goalFlash--;
  if (state.shake > 0) state.shake--;

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
