// === RETRO HOCKEY === (north-south / portrait orientation)

// --- Rink geometry (vertical: you attack UP, defend the BOTTOM net) ---
const RINK_W = 540;
const RINK_H = 900;
const BOARD_PAD = 36;
const RINK_LEFT = BOARD_PAD;
const RINK_RIGHT = RINK_W - BOARD_PAD;
const RINK_TOP = BOARD_PAD;
const RINK_BOTTOM = RINK_H - BOARD_PAD;
const RINK_CENTER_X = RINK_W / 2;
const RINK_CENTER_Y = RINK_H / 2;

const GOAL_WIDTH = 92;                  // mouth width (along X)
const GOAL_DEPTH = 20;                  // net depth (along Y, into the boards)
const GOAL_MOUTH_LEFT = RINK_CENTER_X - GOAL_WIDTH / 2;
const GOAL_MOUTH_RIGHT = RINK_CENTER_X + GOAL_WIDTH / 2;
const TOP_GOAL_LINE_Y = RINK_TOP + 6;       // away's net (you attack here)
const BOTTOM_GOAL_LINE_Y = RINK_BOTTOM - 6; // your net (you defend here)

const PLAYER_R = 13;
const PUCK_R = 5;

const PLAYER_SPEED = 2.5;
const AI_SPEED = 2.2;
const PUCK_FRICTION = 0.985;
const PUCK_BOUNCE = 0.55;
const SHOT_SPEED = 9;
const PASS_SPEED = 5.5;
const PICKUP_COOLDOWN_FRAMES = 10;

// Goalies track the puck laterally (along X) with reaction lag, and are judged
// where a shot crosses the goal line. Low track-react => beatable to the corners.
const GOALIE_TRACK_REACT = 0.08;
const GOALIE_DEPTH_REACT = 0.18;
const GOALIE_COVER = 12;                // half-width of save coverage (along X, ~ body)
const GOALIE_DEPTH = 9;                  // smother depth (along Y)

// Body check: a deliberate hit (SHOOT with no puck). Knocks the target down.
const CHECK_RANGE = PLAYER_R * 2 + 12;
const CHECK_COOLDOWN = 32;
const CHECK_KNOCKBACK = 4.4;
const CHECK_STUN = 42;                   // ~0.7s knocked down (can't move or touch the puck)
const AI_CHECK_CHANCE = 0.05;

const PERIOD_SECONDS = 180;
const PERIODS = 3;
const GOAL_CELEBRATE_FRAMES = 80;

// Faceoff timing meter
const FACEOFF_MARKER_SPEED = 0.024;      // marker sweep per frame (ping-pong 0..1)
const FACEOFF_GREEN = 0.12;              // half-width of the win zone (around 0.5)
const FACEOFF_YELLOW = 0.24;             // half-width of the scramble zone
const FACEOFF_IDLE = 260;                // frames before auto-resolve if you don't tap
const FACEOFF_RESULT_FRAMES = 40;        // how long the result shows before play

const HOME = { name: 'HOME', color: '#e63946', dark: '#7a1318', goalie: '#ffb703', goalieDark: '#aa6a00' };
const AWAY = { name: 'AWAY', color: '#457b9d', dark: '#1d3557', goalie: '#06d6a0', goalieDark: '#04795b' };

// --- DOM ---
const canvas = document.getElementById('game');
canvas.width = RINK_W;
canvas.height = RINK_H;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// --- State ---
const state = {
  phase: 'splash',                       // splash | faceoff | play | goal | over
  players: [],
  puck: { x: RINK_CENTER_X, y: RINK_CENTER_Y, vx: 0, vy: 0, ownerId: null, pickupCD: 0,
          trail: [], prevX: RINK_CENTER_X, prevY: RINK_CENTER_Y },
  homeScore: 0,
  awayScore: 0,
  period: 1,
  clock: PERIOD_SECONDS,
  message: '',
  messageTimer: 0,
  goalTimer: 0,
  goalFlash: 0,
  goalFlashTeam: null,
  shake: 0,
  faceoff: null,                         // { dot, t, dir, locked, result, resultTimer, idle }
};

let controlledId = null;
let possState = 'loose';                 // 'home' | 'away' | 'loose'

// --- Input (independent touch / mouse / keyboard, merged) ---
const input = {
  touchX: 0, touchY: 0, touchId: null,
  mouseX: 0, mouseY: 0, mouseDown: false,
  keyX: 0, keyY: 0,
};
const keys = {};

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

  function joyVector(clientX, clientY) {
    if (!joyRect) refreshRect();
    const cx = joyRect.left + joyRect.width / 2;
    const cy = joyRect.top + joyRect.height / 2;
    const dx = clientX - cx, dy = clientY - cy;
    const max = joyRect.width / 2 - 8;
    const r = Math.min(max, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    knob.style.transform =
      `translate(calc(-50% + ${Math.cos(angle) * r}px), calc(-50% + ${Math.sin(angle) * r}px))`;
    return { x: Math.cos(angle) * (r / max), y: Math.sin(angle) * (r / max) };
  }
  function resetKnob() { knob.style.transform = 'translate(-50%, -50%)'; }

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
        input.touchX = v.x; input.touchY = v.y; break;
      }
    }
    e.preventDefault();
  }, { passive: false });
  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === input.touchId) {
        input.touchId = null; input.touchX = 0; input.touchY = 0; resetKnob();
      }
    }
  }
  joyEl.addEventListener('touchend', endTouch);
  joyEl.addEventListener('touchcancel', endTouch);

  joyEl.addEventListener('mousedown', e => {
    refreshRect(); input.mouseDown = true;
    const v = joyVector(e.clientX, e.clientY);
    input.mouseX = v.x; input.mouseY = v.y; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!input.mouseDown) return;
    const v = joyVector(e.clientX, e.clientY);
    input.mouseX = v.x; input.mouseY = v.y;
  });
  window.addEventListener('mouseup', () => {
    if (!input.mouseDown) return;
    input.mouseDown = false; input.mouseX = 0; input.mouseY = 0; resetKnob();
  });

  function bindButton(el, handler) {
    el.addEventListener('touchstart', e => { e.preventDefault(); handler(); }, { passive: false });
    el.addEventListener('mousedown', e => { e.preventDefault(); handler(); });
  }
  bindButton(shootBtn, onShoot);
  bindButton(passBtn, onPass);

  // Tap the ice during a faceoff to take the draw; tap after the game to replay.
  function canvasTap(e) {
    if (state.phase === 'faceoff') { e.preventDefault(); lockFaceoff(false); }
    else if (state.phase === 'over') { e.preventDefault(); start(); }
  }
  canvas.addEventListener('touchstart', canvasTap, { passive: false });
  canvas.addEventListener('mousedown', canvasTap);

  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.key === 'Enter') { onShoot(); e.preventDefault(); }
    else if (e.key === 'Shift') { onPass(); e.preventDefault(); }
    else if (e.key === 'Tab' || e.key.toLowerCase() === 'q') { switchPlayer(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('resize', refreshRect);
}

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
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function getPlayer(id) { return state.players.find(p => p.id === id); }
function homeSkaters() { return state.players.filter(p => p.team === 'home' && !p.isGoalie); }
function awaySkaters() { return state.players.filter(p => p.team === 'away' && !p.isGoalie); }
function teammates(p) { return state.players.filter(q => q.team === p.team && q.id !== p.id && !q.isGoalie); }
function attackDirY(team) { return team === 'home' ? -1 : 1; }   // home attacks up
function idleFacing(team) { return team === 'home' ? -Math.PI / 2 : Math.PI / 2; }
function nearestTo(point, pool) {
  let best = null, bestD = Infinity;
  for (const p of pool) { const d = dist(p, point); if (d < bestD) { bestD = d; best = p; } }
  return best;
}

// --- Sprites (procedural 8-bit) ---
const sprites = {};
function makeSprite(rows, pal, cell) {
  const w = rows[0].length, h = rows.length;
  const cv = document.createElement('canvas');
  cv.width = w * cell; cv.height = h * cell;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = pal[rows[y][x]];
    if (!col) continue;
    c.fillStyle = col;
    c.fillRect(x * cell, y * cell, cell, cell);
  }
  return cv;
}
// Skater & goalie bitmaps, pointing "up" (north). 'o' outline, 'j' jersey,
// 's' skin, 'b' skate/boot, 'g' goalie pad.
const SKATER = [
  '..ooo..',
  '.ososo.',
  '.ossso.',
  'ojjjjjo',
  'ojjjjjo',
  'ojjjjjo',
  '.ojjjo.',
  '.b...b.',
  '.b...b.',
];
const GOALIE = [
  '..ooo..',
  '.ossso.',
  '.ossso.',
  'gjjjjjg',
  'gjjjjjg',
  'gjjjjjg',
  'gjjjjjg',
  'gg...gg',
  'gb...bg',
];
function buildSprites() {
  const cell = 3, skin = '#f1c27d', boot = '#15151c';
  sprites.homeSkater = makeSprite(SKATER, { o: HOME.dark, j: HOME.color, s: skin, b: boot }, cell);
  sprites.awaySkater = makeSprite(SKATER, { o: AWAY.dark, j: AWAY.color, s: skin, b: boot }, cell);
  sprites.homeGoalie = makeSprite(GOALIE, { o: HOME.goalieDark, j: HOME.goalie, s: skin, b: boot, g: '#e6ecf5' }, cell);
  sprites.awayGoalie = makeSprite(GOALIE, { o: AWAY.goalieDark, j: AWAY.goalie, s: skin, b: boot, g: '#e6ecf5' }, cell);
}

// --- Player setup ---
function homeFormation() {
  return [
    { role: 'C',  hx: RINK_CENTER_X,      hy: RINK_CENTER_Y + 90 },
    { role: 'LW', hx: RINK_CENTER_X - 90, hy: RINK_CENTER_Y + 150 },
    { role: 'RW', hx: RINK_CENTER_X + 90, hy: RINK_CENTER_Y + 150 },
    { role: 'LD', hx: RINK_CENTER_X - 60, hy: RINK_CENTER_Y + 250 },
    { role: 'RD', hx: RINK_CENTER_X + 60, hy: RINK_CENTER_Y + 250 },
  ];
}
function awayFormation() {
  return [
    { role: 'C',  hx: RINK_CENTER_X,      hy: RINK_CENTER_Y - 90 },
    { role: 'LW', hx: RINK_CENTER_X + 90, hy: RINK_CENTER_Y - 150 },
    { role: 'RW', hx: RINK_CENTER_X - 90, hy: RINK_CENTER_Y - 150 },
    { role: 'LD', hx: RINK_CENTER_X + 60, hy: RINK_CENTER_Y - 250 },
    { role: 'RD', hx: RINK_CENTER_X - 60, hy: RINK_CENTER_Y - 250 },
  ];
}
function makePlayers() {
  const players = [];
  const homeNumbers = [91, 19, 27, 44, 8];
  const awayNumbers = [87, 13, 71, 4, 22];
  homeFormation().forEach((p, i) => players.push({
    id: 'h' + i, team: 'home', role: p.role, isGoalie: false,
    x: p.hx, y: p.hy, vx: 0, vy: 0, hx: p.hx, hy: p.hy, number: homeNumbers[i],
  }));
  players.push({ id: 'hG', team: 'home', role: 'G', isGoalie: true,
    x: RINK_CENTER_X, y: BOTTOM_GOAL_LINE_Y - 18, vx: 0, vy: 0,
    hx: RINK_CENTER_X, hy: BOTTOM_GOAL_LINE_Y - 18, number: 31 });
  awayFormation().forEach((p, i) => players.push({
    id: 'a' + i, team: 'away', role: p.role, isGoalie: false,
    x: p.hx, y: p.hy, vx: 0, vy: 0, hx: p.hx, hy: p.hy, number: awayNumbers[i],
  }));
  players.push({ id: 'aG', team: 'away', role: 'G', isGoalie: true,
    x: RINK_CENTER_X, y: TOP_GOAL_LINE_Y + 18, vx: 0, vy: 0,
    hx: RINK_CENTER_X, hy: TOP_GOAL_LINE_Y + 18, number: 30 });

  for (const p of players) { p.facing = idleFacing(p.team); p.checkCD = 0; p.stun = 0; }
  state.players = players;
}

// --- Controlled player selection (sticky) ---
function nearestHomeSkaterToPuck() {
  const pool = homeSkaters().filter(p => p.stun <= 0);
  const n = nearestTo(state.puck, pool.length ? pool : homeSkaters());
  return n ? n.id : null;
}
function updateControlledPlayer() {
  const owner = state.puck.ownerId ? getPlayer(state.puck.ownerId) : null;
  const newPoss = owner ? owner.team : 'loose';
  const turnover = newPoss !== possState;
  possState = newPoss;

  if (owner && owner.team === 'home' && !owner.isGoalie) { controlledId = owner.id; return; }

  const cur = controlledId ? getPlayer(controlledId) : null;
  const validCur = cur && cur.team === 'home' && !cur.isGoalie && cur.stun <= 0;
  if (turnover || !validCur) controlledId = nearestHomeSkaterToPuck();
}
function switchPlayer() {
  if (state.phase !== 'play') return;
  const others = homeSkaters().filter(p => p.id !== controlledId && p.stun <= 0);
  const target = nearestTo(state.puck, others.length ? others : homeSkaters());
  if (target) controlledId = target.id;
}

// --- Movement / AI ---
function updatePlayers() {
  updateControlledPlayer();
  const puck = state.puck;
  const owner = puck.ownerId ? getPlayer(puck.ownerId) : null;

  for (const p of state.players) {
    if (p.checkCD > 0) p.checkCD--;
    if (p.isGoalie) { updateGoalie(p); continue; }

    if (p.stun > 0) {
      p.stun--;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.86; p.vy *= 0.86;
    } else if (p.id === controlledId) {
      const mv = moveVector();
      p.vx = mv.x * PLAYER_SPEED; p.vy = mv.y * PLAYER_SPEED;
      p.x += p.vx; p.y += p.vy;
    } else {
      computeAIVelocity(p, owner);
      p.x += p.vx; p.y += p.vy;
    }

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.25) p.facing = Math.atan2(p.vy, p.vx);
    else if (puck.ownerId === p.id) p.facing = idleFacing(p.team);

    p.x = clamp(p.x, RINK_LEFT + PLAYER_R, RINK_RIGHT - PLAYER_R);
    p.y = clamp(p.y, RINK_TOP + PLAYER_R, RINK_BOTTOM - PLAYER_R);
  }
  resolvePlayerCollisions();
}

function computeAIVelocity(p, owner) {
  const puck = state.puck;
  let tx, ty;

  if (owner && owner.id === p.id) {
    // Drive toward the slot in front of the opponent's net.
    const goalY = p.team === 'home' ? TOP_GOAL_LINE_Y : BOTTOM_GOAL_LINE_Y;
    ty = goalY - attackDirY(p.team) * 55;
    tx = RINK_CENTER_X + (p.hx - RINK_CENTER_X) * 0.3;
    const dGoal = Math.abs(goalY - p.y);
    if (dGoal < 150) { if (Math.random() < (dGoal < 75 ? 0.11 : 0.03)) aiShoot(p); }
  } else if (owner && owner.team === p.team) {
    // Support up-ice.
    const isDef = p.role === 'LD' || p.role === 'RD';
    const lead = isDef ? -60 : 80;
    ty = clamp(owner.y + attackDirY(p.team) * lead, RINK_TOP + 50, RINK_BOTTOM - 50);
    tx = p.hx + (owner.x - RINK_CENTER_X) * 0.4;
  } else if (owner) {
    // Defend.
    const myGoalY = p.team === 'home' ? BOTTOM_GOAL_LINE_Y : TOP_GOAL_LINE_Y;
    const closest = nearestTo(owner, (p.team === 'home' ? homeSkaters() : awaySkaters()));
    if (closest && closest.id === p.id) {
      tx = owner.x; ty = owner.y;
      if (dist(p, owner) < CHECK_RANGE && Math.random() < AI_CHECK_CHANCE) doBodyCheck(p);
    } else {
      tx = owner.x * 0.4 + p.hx * 0.6;
      ty = owner.y * 0.4 + myGoalY * 0.2 + p.hy * 0.4;
    }
  } else {
    const closest = nearestTo(puck, (p.team === 'home' ? homeSkaters() : awaySkaters()));
    if (closest && closest.id === p.id) { tx = puck.x; ty = puck.y; }
    else { tx = p.hx; ty = p.hy; }
  }

  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d > 2) { p.vx = (dx / d) * AI_SPEED; p.vy = (dy / d) * AI_SPEED; }
  else { p.vx *= 0.4; p.vy *= 0.4; }
}

function updateGoalie(g) {
  const puck = state.puck;
  const homeSide = g.team === 'home';
  const lineY = homeSide ? BOTTOM_GOAL_LINE_Y : TOP_GOAL_LINE_Y;
  const restYFixed = homeSide ? lineY - 16 : lineY + 16;

  // Track the puck (or carrier) laterally with lag.
  let targetX = clamp(puck.ownerId ? (getPlayer(puck.ownerId) || puck).x : puck.x,
                      GOAL_MOUTH_LEFT + 2, GOAL_MOUTH_RIGHT - 2);
  g.vx = (targetX - g.x) * GOALIE_TRACK_REACT;
  g.vy = (restYFixed - g.y) * GOALIE_DEPTH_REACT;
  g.x += g.vx; g.y += g.vy;

  g.x = clamp(g.x, GOAL_MOUTH_LEFT - 8, GOAL_MOUTH_RIGHT + 8);
  if (homeSide) g.y = clamp(g.y, lineY - 44, lineY - 6);
  else g.y = clamp(g.y, lineY + 6, lineY + 44);
  g.facing = idleFacing(g.team);
}

function resolvePlayerCollisions() {
  const ps = state.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), minD = PLAYER_R * 2;
    if (d > 0 && d < minD) {
      const overlap = (minD - d) / 2, nx = dx / d, ny = dy / d;
      if (!a.isGoalie) { a.x -= nx * overlap; a.y -= ny * overlap; }
      if (!b.isGoalie) { b.x += nx * overlap; b.y += ny * overlap; }
    }
  }
}

// --- Puck physics ---
function updatePuck() {
  const puck = state.puck;
  if (puck.pickupCD > 0) puck.pickupCD--;

  if (puck.ownerId) {
    const owner = getPlayer(puck.ownerId);
    if (!owner || owner.stun > 0) { puck.ownerId = null; }
    else {
      const moving = Math.hypot(owner.vx, owner.vy);
      let dx, dy;
      if (moving > 0.2) { dx = owner.vx / moving; dy = owner.vy / moving; }
      else { dx = 0; dy = attackDirY(owner.team); }
      const off = PLAYER_R + 4;
      puck.x = owner.x + dx * off; puck.y = owner.y + dy * off;
      puck.vx = 0; puck.vy = 0; pushTrail(puck);
      return;
    }
  }

  // Free puck
  puck.prevX = puck.x; puck.prevY = puck.y;
  puck.x += puck.vx; puck.y += puck.vy;
  puck.vx *= PUCK_FRICTION; puck.vy *= PUCK_FRICTION;
  pushTrail(puck);

  const inMouthX = puck.x > GOAL_MOUTH_LEFT && puck.x < GOAL_MOUTH_RIGHT;
  if (puck.x < RINK_LEFT + PUCK_R) { puck.x = RINK_LEFT + PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  if (puck.x > RINK_RIGHT - PUCK_R) { puck.x = RINK_RIGHT - PUCK_R; puck.vx = -puck.vx * PUCK_BOUNCE; }
  if (puck.y < RINK_TOP + PUCK_R && !inMouthX) { puck.y = RINK_TOP + PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }
  if (puck.y > RINK_BOTTOM - PUCK_R && !inMouthX) { puck.y = RINK_BOTTOM - PUCK_R; puck.vy = -puck.vy * PUCK_BOUNCE; }

  if (puck.pickupCD === 0 && tryGoalieSave()) return;

  // Goal detection
  if (puck.y < TOP_GOAL_LINE_Y - 2 && inMouthX) { state.homeScore++; triggerGoal('home'); return; }
  if (puck.y > BOTTOM_GOAL_LINE_Y + 2 && inMouthX) { state.awayScore++; triggerGoal('away'); return; }

  // Skater pickup (no goalies, no downed players)
  if (puck.pickupCD > 0) return;
  for (const p of state.players) {
    if (p.isGoalie || p.stun > 0) continue;
    if (dist(p, puck) < PLAYER_R + PUCK_R) { puck.ownerId = p.id; break; }
  }
}

function pushTrail(puck) {
  puck.trail.push({ x: puck.x, y: puck.y });
  if (puck.trail.length > 7) puck.trail.shift();
}

// Save evaluated where the shot crosses the goal LINE (Y), coverage along X.
function tryGoalieSave() {
  const puck = state.puck;
  const speed = Math.hypot(puck.vx, puck.vy);
  for (const g of state.players) {
    if (!g.isGoalie) continue;
    const homeSide = g.team === 'home';
    const lineY = homeSide ? BOTTOM_GOAL_LINE_Y : TOP_GOAL_LINE_Y;
    const dy = puck.y - puck.prevY;
    const crossed = homeSide ? (puck.prevY <= lineY && puck.y >= lineY)
                             : (puck.prevY >= lineY && puck.y <= lineY);
    if (crossed && Math.abs(dy) > 0.001) {
      const frac = (lineY - puck.prevY) / dy;
      const xCross = puck.prevX + frac * (puck.x - puck.prevX);
      if (xCross > GOAL_MOUTH_LEFT && xCross < GOAL_MOUTH_RIGHT &&
          Math.abs(xCross - g.x) < GOALIE_COVER + PUCK_R) return goalieSave(g, false);
    }
    if (speed < 2.2 &&
        Math.abs(puck.x - g.x) < GOALIE_COVER + PUCK_R &&
        Math.abs(puck.y - g.y) < GOALIE_DEPTH + PUCK_R) return goalieSave(g, true);
  }
  return false;
}
function goalieSave(g, cover) {
  const puck = state.puck;
  const outY = g.team === 'home' ? -1 : 1;   // kick toward center ice
  if (cover) {
    puck.vx = 0; puck.vy = 0; puck.ownerId = null; puck.pickupCD = 30;
    startFaceoff(nearestZoneDot(puck), 'WHISTLE');
  } else {
    puck.y = g.y + outY * (GOALIE_DEPTH + PUCK_R + 2);
    puck.vy = outY * (3.2 + Math.random() * 1.8);
    puck.vx = (Math.random() - 0.5) * 4.5;
    puck.pickupCD = 10;
  }
  return true;
}

// --- Actions ---
function onShoot() {
  if (state.phase === 'faceoff') { lockFaceoff(false); return; }
  if (state.phase !== 'play') return;
  if (state.phase === 'over') { start(); return; }
  const c = getPlayer(controlledId);
  if (!c) return;
  if (state.puck.ownerId === c.id) tryShoot();
  else doBodyCheck(c);
}
function onPass() {
  if (state.phase === 'faceoff') { lockFaceoff(false); return; }
  if (state.phase !== 'play') return;
  const c = getPlayer(controlledId);
  if (c && state.puck.ownerId === c.id) tryPass();
  else switchPlayer();
}

function tryShoot() {
  const active = getPlayer(controlledId);
  if (!active || state.puck.ownerId !== active.id) return;
  const goalie = getPlayer('aG');                       // away goalie (top net)
  const left = goalie ? goalie.x > RINK_CENTER_X : Math.random() < 0.5;
  const targetX = left ? GOAL_MOUTH_LEFT + 8 + Math.random() * 10
                       : GOAL_MOUTH_RIGHT - 8 - Math.random() * 10;
  shootPuck(targetX, TOP_GOAL_LINE_Y - 10, SHOT_SPEED);
}
function tryPass() {
  const active = getPlayer(controlledId);
  if (!active || state.puck.ownerId !== active.id) return;
  const mates = teammates(active);
  let best = null, bestScore = -Infinity;
  for (const m of mates) {
    const forward = (active.y - m.y) * (active.team === 'home' ? 1 : -1);
    const d = dist(m, active);
    if (d < 50) continue;
    const score = forward * 1.2 - d * 0.6;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (!best) best = nearestTo(active, mates);
  if (!best) return;
  shootPuck(best.x, best.y, PASS_SPEED);
  controlledId = best.id; possState = 'loose';
}
function shootPuck(tx, ty, speed) {
  const puck = state.puck;
  const dx = tx - puck.x, dy = ty - puck.y, len = Math.hypot(dx, dy) || 1;
  puck.vx = (dx / len) * speed; puck.vy = (dy / len) * speed;
  puck.ownerId = null; puck.pickupCD = PICKUP_COOLDOWN_FRAMES;
}
function aiShoot(p) {
  const goalY = p.team === 'home' ? TOP_GOAL_LINE_Y : BOTTOM_GOAL_LINE_Y;
  const goalie = getPlayer(p.team === 'home' ? 'aG' : 'hG');
  let targetX;
  if (goalie && Math.random() < 0.6) {
    targetX = goalie.x > RINK_CENTER_X ? GOAL_MOUTH_LEFT + 10 : GOAL_MOUTH_RIGHT - 10;
  } else {
    targetX = RINK_CENTER_X + (Math.random() - 0.5) * GOAL_WIDTH * 0.7;
  }
  shootPuck(targetX, goalY - attackDirY(p.team) * 10, SHOT_SPEED - 1);
}

// A body check: hit the nearest opponent in range, knock them down, strip puck.
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
  target.x += Math.cos(ang) * 3; target.y += Math.sin(ang) * 3;
  target.stun = CHECK_STUN;
  if (state.puck.ownerId === target.id) {
    state.puck.ownerId = null;
    state.puck.x = target.x; state.puck.y = target.y;
    state.puck.vx = Math.cos(ang) * 3 + (Math.random() - 0.5) * 2;
    state.puck.vy = Math.sin(ang) * 3 + (Math.random() - 0.5) * 2;
    state.puck.pickupCD = 12;
  }
  if (checker.id === controlledId || target.id === controlledId) state.shake = Math.max(state.shake, 6);
  return true;
}

// --- Faceoffs ---
const ZONE_DOTS = [
  { x: RINK_CENTER_X - 80, y: TOP_GOAL_LINE_Y + 150 },
  { x: RINK_CENTER_X + 80, y: TOP_GOAL_LINE_Y + 150 },
  { x: RINK_CENTER_X - 80, y: BOTTOM_GOAL_LINE_Y - 150 },
  { x: RINK_CENTER_X + 80, y: BOTTOM_GOAL_LINE_Y - 150 },
];
function centerDot() { return { x: RINK_CENTER_X, y: RINK_CENTER_Y }; }
function nearestZoneDot(pt) { return nearestTo(pt, ZONE_DOTS.map(d => ({ ...d }))); }

function positionForFaceoff(dot) {
  const offX = dot.x - RINK_CENTER_X, offY = dot.y - RINK_CENTER_Y;
  for (const p of state.players) {
    p.vx = 0; p.vy = 0; p.stun = 0; p.checkCD = 0; p.facing = idleFacing(p.team);
    if (p.isGoalie) continue;
    if (p.role === 'C') {
      p.x = dot.x; p.y = dot.y - attackDirY(p.team) * 20;          // centers flank the dot
    } else {
      p.x = clamp(p.hx + offX * 0.25, RINK_LEFT + PLAYER_R, RINK_RIGHT - PLAYER_R);
      p.y = clamp(p.hy + offY * 0.25, RINK_TOP + PLAYER_R, RINK_BOTTOM - PLAYER_R);
    }
  }
}
function startFaceoff(dot, msg) {
  state.phase = 'faceoff';
  state.faceoff = { dot, t: 0, dir: 1, locked: false, result: null, resultTimer: 0, idle: FACEOFF_IDLE };
  positionForFaceoff(dot);
  const puck = state.puck;
  puck.x = dot.x; puck.y = dot.y; puck.vx = 0; puck.vy = 0;
  puck.ownerId = null; puck.pickupCD = 0; puck.trail.length = 0; puck.prevX = dot.x; puck.prevY = dot.y;
  controlledId = getPlayer('h0') ? 'h0' : controlledId;
  if (msg) { state.message = msg; state.messageTimer = 70; }
}
function lockFaceoff(force) {
  const f = state.faceoff;
  if (!f || f.locked) return;
  f.locked = true; f.resultTimer = FACEOFF_RESULT_FRAMES;
  const d = Math.abs(f.t - 0.5);
  if (force) { f.result = 'LOSS'; state.message = 'SCRAMBLE'; }
  else if (d <= FACEOFF_GREEN) { f.result = 'WIN'; state.message = 'WON DRAW!'; }
  else if (d <= FACEOFF_YELLOW) { f.result = 'SCRAMBLE'; state.message = 'SCRAMBLE'; }
  else { f.result = 'LOSS'; state.message = 'LOST DRAW'; }
  state.messageTimer = FACEOFF_RESULT_FRAMES;
}
function updateFaceoff() {
  const f = state.faceoff;
  if (!f) { state.phase = 'play'; return; }
  if (f.locked) { if (--f.resultTimer <= 0) finishFaceoff(); return; }
  f.t += f.dir * FACEOFF_MARKER_SPEED;
  if (f.t >= 1) { f.t = 1; f.dir = -1; }
  if (f.t <= 0) { f.t = 0; f.dir = 1; }
  if (--f.idle <= 0) lockFaceoff(true);
}
function finishFaceoff() {
  const f = state.faceoff, puck = state.puck;
  if (f.result === 'WIN') { puck.ownerId = 'h0'; controlledId = 'h0'; possState = 'home'; }
  else if (f.result === 'LOSS') { puck.ownerId = 'a0'; possState = 'away'; }
  else {
    puck.ownerId = null; possState = 'loose';
    puck.vx = (Math.random() - 0.5) * 2.4; puck.vy = (Math.random() - 0.5) * 2.4;
  }
  state.faceoff = null;
  state.phase = 'play';
}

// --- Game flow ---
function triggerGoal(team) {
  state.message = 'GOAL!';
  state.messageTimer = GOAL_CELEBRATE_FRAMES;
  state.goalTimer = GOAL_CELEBRATE_FRAMES;
  state.goalFlash = 45; state.goalFlashTeam = team; state.shake = 12;
  state.puck.ownerId = null;
  state.phase = 'goal';
}
function updateGoalPhase() {
  if (--state.goalTimer <= 0) {
    if (advancePeriodIfNeeded()) return;
    startFaceoff(centerDot());
  }
}
function updateClock() {
  state.clock -= 1 / 60;
  if (state.clock <= 0) { state.clock = 0; advancePeriodIfNeeded(); }
}
function advancePeriodIfNeeded() {
  if (state.clock > 0) return false;
  if (state.period < PERIODS) {
    state.period++; state.clock = PERIOD_SECONDS;
    startFaceoff(centerDot(), 'PERIOD ' + state.period);
    return true;
  }
  state.phase = 'over';
  state.message = state.homeScore > state.awayScore ? 'HOME WINS'
                : state.homeScore < state.awayScore ? 'AWAY WINS' : 'TIE GAME';
  state.messageTimer = 99999;
  return true;
}

// --- Rendering ---
function render() {
  let sx = 0, sy = 0;
  if (state.shake > 0) { const m = state.shake * 0.6; sx = (Math.random() - 0.5) * m; sy = (Math.random() - 0.5) * m; }
  ctx.save();
  ctx.translate(sx, sy);

  ctx.fillStyle = '#070b16';
  ctx.fillRect(-12, -12, RINK_W + 24, RINK_H + 24);

  const ice = ctx.createLinearGradient(0, RINK_TOP, 0, RINK_BOTTOM);
  ice.addColorStop(0, '#dfe9fb'); ice.addColorStop(0.5, '#f5faff'); ice.addColorStop(1, '#dfe9fb');
  ctx.fillStyle = ice;
  roundRect(RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 30, true, false);

  ctx.save();
  roundRect(RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 30, false, false);
  ctx.clip();
  drawRinkLines();
  drawCreases();
  ctx.restore();

  drawNet(TOP_GOAL_LINE_Y, true, state.goalFlash > 0 && state.goalFlashTeam === 'home');
  drawNet(BOTTOM_GOAL_LINE_Y, false, state.goalFlash > 0 && state.goalFlashTeam === 'away');

  ctx.strokeStyle = '#10243b'; ctx.lineWidth = 5;
  roundRect(RINK_LEFT, RINK_TOP, RINK_RIGHT - RINK_LEFT, RINK_BOTTOM - RINK_TOP, 30, false, true);

  for (const p of state.players) drawShadow(p);
  drawPuckTrail();
  for (const p of state.players) if (p.id !== controlledId) drawPlayer(p);
  const ctl = getPlayer(controlledId);
  if (ctl) drawPlayer(ctl);
  drawPuck();

  if (state.goalFlash > 0) {
    const a = (state.goalFlash / 45) * 0.32;
    ctx.fillStyle = `rgba(${state.goalFlashTeam === 'home' ? '230,57,70' : '69,123,157'},${a})`;
    ctx.fillRect(0, 0, RINK_W, RINK_H);
  }
  drawVignette();
  if (state.phase === 'faceoff') drawFaceoffMeter();

  if (state.message && state.messageTimer > 0 && state.phase !== 'faceoff') {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, RINK_CENTER_Y - 44, RINK_W, 88);
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 46px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(state.message, RINK_CENTER_X, RINK_CENTER_Y);
    if (state.phase === 'over') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('TAP TO PLAY AGAIN', RINK_CENTER_X, RINK_CENTER_Y + 34);
    }
  }
  ctx.restore();
  updateHUD();
}

function drawRinkLines() {
  ctx.fillStyle = '#d23';
  ctx.fillRect(RINK_LEFT, RINK_CENTER_Y - 3, RINK_RIGHT - RINK_LEFT, 6);          // center line
  ctx.fillStyle = '#2a72d6';
  const b1 = RINK_TOP + (RINK_BOTTOM - RINK_TOP) * 0.34;
  const b2 = RINK_TOP + (RINK_BOTTOM - RINK_TOP) * 0.66;
  ctx.fillRect(RINK_LEFT, b1 - 3, RINK_RIGHT - RINK_LEFT, 6);                      // blue lines
  ctx.fillRect(RINK_LEFT, b2 - 3, RINK_RIGHT - RINK_LEFT, 6);
  ctx.fillStyle = 'rgba(210,40,50,0.8)';
  ctx.fillRect(RINK_LEFT, TOP_GOAL_LINE_Y, RINK_RIGHT - RINK_LEFT, 2);             // goal lines
  ctx.fillRect(RINK_LEFT, BOTTOM_GOAL_LINE_Y, RINK_RIGHT - RINK_LEFT, 2);

  ctx.strokeStyle = '#2a72d6'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#2a72d6';
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, RINK_CENTER_Y, 4, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#d23'; ctx.fillStyle = '#d23';
  for (const d of ZONE_DOTS) {
    ctx.beginPath(); ctx.arc(d.x, d.y, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const d of [{ x: RINK_CENTER_X - 80, y: RINK_CENTER_Y - 60 }, { x: RINK_CENTER_X + 80, y: RINK_CENTER_Y - 60 },
                   { x: RINK_CENTER_X - 80, y: RINK_CENTER_Y + 60 }, { x: RINK_CENTER_X + 80, y: RINK_CENTER_Y + 60 }]) {
    ctx.beginPath(); ctx.arc(d.x, d.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}
function drawCreases() {
  ctx.fillStyle = 'rgba(42,114,214,0.30)';
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, TOP_GOAL_LINE_Y, 36, 0, Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(RINK_CENTER_X, BOTTOM_GOAL_LINE_Y, 36, Math.PI, Math.PI * 2); ctx.fill();
}
function drawNet(lineY, isTop, lit) {
  const dir = isTop ? -1 : 1;
  const y0 = Math.min(lineY, lineY + dir * GOAL_DEPTH);
  ctx.fillStyle = lit ? 'rgba(255,90,90,0.6)' : 'rgba(244,248,255,0.92)';
  ctx.fillRect(GOAL_MOUTH_LEFT, y0, GOAL_WIDTH, GOAL_DEPTH);
  ctx.strokeStyle = lit ? 'rgba(255,190,190,0.85)' : 'rgba(120,130,150,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const xx = GOAL_MOUTH_LEFT + (i / 5) * GOAL_WIDTH;
    ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y0 + GOAL_DEPTH); ctx.stroke();
  }
  for (let i = 0; i <= 3; i++) {
    const yy = y0 + (i / 3) * GOAL_DEPTH;
    ctx.beginPath(); ctx.moveTo(GOAL_MOUTH_LEFT, yy); ctx.lineTo(GOAL_MOUTH_RIGHT, yy); ctx.stroke();
  }
  ctx.strokeStyle = '#e23'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(GOAL_MOUTH_LEFT, lineY); ctx.lineTo(GOAL_MOUTH_RIGHT, lineY); ctx.stroke();
}
function drawShadow(p) {
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + PLAYER_R - 2, PLAYER_R, PLAYER_R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
}
function drawPlayer(p) {
  const isCtl = p.id === controlledId;
  if (isCtl) {
    ctx.fillStyle = 'rgba(255,225,77,0.4)';
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 8, 0, Math.PI * 2); ctx.fill();
  }
  const sprite = p.isGoalie ? (p.team === 'home' ? sprites.homeGoalie : sprites.awayGoalie)
                            : (p.team === 'home' ? sprites.homeSkater : sprites.awaySkater);
  ctx.save();
  ctx.translate(p.x, p.y);
  let rot = p.facing + Math.PI / 2;
  if (p.stun > 0) rot += 1.2;            // tip over when knocked down
  ctx.rotate(rot);
  ctx.globalAlpha = p.stun > 0 ? 0.7 : 1;
  if (sprite) ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  if (!p.isGoalie && p.stun <= 0) {       // stick
    ctx.strokeStyle = '#caa46a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(8, -13); ctx.stroke(); ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(p.number), p.x, p.y);

  if (isCtl) {
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (p.stun > 0) {                       // little stars
    ctx.fillStyle = '#ffe14d';
    for (let i = 0; i < 3; i++) {
      const a = (Date.now() / 200) + i * 2.1;
      ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 10, p.y - PLAYER_R - 4 + Math.sin(a) * 3, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawPuckTrail() {
  if (state.puck.ownerId) return;
  const t = state.puck.trail;
  for (let i = 0; i < t.length; i++) {
    const a = (i + 1) / t.length;
    ctx.fillStyle = `rgba(15,15,25,${a * 0.32})`;
    ctx.beginPath(); ctx.arc(t[i].x, t[i].y, PUCK_R * (0.4 + a * 0.5), 0, Math.PI * 2); ctx.fill();
  }
}
function drawPuck() {
  const puck = state.puck;
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.stroke();
}
function drawVignette() {
  const g = ctx.createRadialGradient(RINK_CENTER_X, RINK_CENTER_Y, RINK_H * 0.30,
                                     RINK_CENTER_X, RINK_CENTER_Y, RINK_H * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, RINK_W, RINK_H);
}
function drawFaceoffMeter() {
  const f = state.faceoff;
  const bw = RINK_W * 0.66, bx = (RINK_W - bw) / 2, by = RINK_CENTER_Y - 8, bh = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, by - 46, RINK_W, 104);
  ctx.fillStyle = '#ffe14d';
  ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(f.locked ? state.message : 'FACE-OFF — TAP!', RINK_CENTER_X, by - 22);

  ctx.fillStyle = '#1b1b22'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(255,200,40,0.45)';
  ctx.fillRect(bx + bw * (0.5 - FACEOFF_YELLOW), by, bw * FACEOFF_YELLOW * 2, bh);
  ctx.fillStyle = 'rgba(60,220,90,0.85)';
  ctx.fillRect(bx + bw * (0.5 - FACEOFF_GREEN), by, bw * FACEOFF_GREEN * 2, bh);
  const mx = bx + bw * f.t;
  ctx.fillStyle = '#fff'; ctx.fillRect(mx - 2, by - 5, 4, bh + 10);
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function updateHUD() {
  document.getElementById('home-score').textContent = state.homeScore;
  document.getElementById('away-score').textContent = state.awayScore;
  document.getElementById('period').textContent = 'P' + state.period;
  const total = Math.max(0, state.clock);
  const m = Math.floor(total / 60), s = Math.floor(total % 60);
  document.getElementById('clock').textContent = m + ':' + (s < 10 ? '0' + s : s);
}

// --- Main loop ---
function tick() {
  computeKeyVector();
  if (state.phase === 'play') { updatePlayers(); updatePuck(); updateClock(); }
  else if (state.phase === 'faceoff') updateFaceoff();
  else if (state.phase === 'goal') updateGoalPhase();

  if (state.messageTimer > 0) state.messageTimer--;
  if (state.goalFlash > 0) state.goalFlash--;
  if (state.shake > 0) state.shake--;
  render();
  requestAnimationFrame(tick);
}

// --- Boot ---
function start() {
  makePlayers();
  state.homeScore = 0; state.awayScore = 0; state.period = 1; state.clock = PERIOD_SECONDS;
  document.getElementById('splash').classList.add('hidden');
  startFaceoff(centerDot(), 'FACE-OFF');
}

buildSprites();
makePlayers();
setupInput();
document.getElementById('start-btn').addEventListener('click', start);
document.getElementById('start-btn').addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
render();
requestAnimationFrame(tick);
