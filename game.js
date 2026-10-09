'use strict';

// ===== 기본 설정 =====
const W = 960;
const H = 540;
const GROUND_Y = 440;        // 바닥 윗면 y
const PLAYER_X = 200;        // 플레이어는 x 고정, 월드가 왼쪽으로 흐른다
const GRAVITY = 2600;
const JUMP_V = 860;          // 1단 최고 높이 ≈ 142px, 2단 ≈ 284px
const SPIN_DUR = 0.45;       // 2단 점프 회전 시간
const INV_DUR = 1.2;         // 피격 후 무적 시간
const BASE_SPEED = 380;
const MAX_SPEED = 720;
const ACCEL = 7;             // 초당 속도 증가량
const MAX_HP = 2;
const OVER_BOTTOM = GROUND_Y - 56; // 천장 장애물 아래 끝: 서 있으면 닿고, 슬라이드하면 통과
const SLIDE_SCALE = 0.78;
const BEST_KEY = 'spongebob-run-best';
const FONT = '"Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

// halfW: 슬라이드로 눕혔을 때 바닥 위로 띄울 몸 반폭
const CHARACTERS = [
  { id: 'sponge', name: '스폰지밥', halfW: 28 },
  { id: 'patrick', name: '뚱이', halfW: 25 },
  { id: 'squid', name: '징징이', halfW: 22 },
  { id: 'krabs', name: '집게사장', halfW: 30 },
  { id: 'sandy', name: '다람이', halfW: 27 },
];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
setupCanvas();
window.addEventListener('resize', setupCanvas);

// ===== 유틸 =====
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mod = (a, n) => ((a % n) + n) % n;
const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function loadBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch (e) {
    // 저장 불가 환경에서도 게임은 계속 동작
  }
}

function roundRect(x, y, w, h, r) {
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
}

function drawText(str, x, y, size, fill, align = 'center', stroke = '#123a63') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 7);
  ctx.strokeStyle = stroke;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}

// ===== 게임 상태 =====
const game = {
  state: 'home',            // 'home' | 'playing' | 'over'
  selected: 0,
  best: loadBest(),
  time: 0,
  bgOffset: 0,
  speed: BASE_SPEED,
  distance: 0,
  score: 0,
  hp: MAX_HP,
  obstacles: [],
  spawnCursor: 0,
  flash: 0,
  overTimer: 0,
  newRecord: false,
};

const player = {
  y: GROUND_Y,
  vy: 0,
  jumps: 0,
  onGround: true,
  sliding: false,
  falling: false,           // 구멍에 빠지는 중
  spinT: -1,                // 2단 점프 회전 진행 시간 (-1이면 회전 안 함)
  inv: 0,
  bubble: 0,                // 구멍에서 복귀한 뒤 물방울 보호막 시간
  runT: 0,
};

function resetPlayer() {
  Object.assign(player, {
    y: GROUND_Y, vy: 0, jumps: 0, onGround: true, sliding: false, falling: false,
    spinT: -1, inv: 0, bubble: 0, runT: 0,
  });
}

function startGame() {
  game.state = 'playing';
  game.speed = BASE_SPEED;
  game.distance = 0;
  game.score = 0;
  game.hp = MAX_HP;
  game.obstacles = [];
  game.spawnCursor = W + 300;
  game.flash = 0;
  game.newRecord = false;
  resetPlayer();
}

function goHome() {
  game.state = 'home';
  game.obstacles = [];
  resetPlayer();
}

function gameOver() {
  game.state = 'over';
  game.overTimer = 0;
  if (game.score > game.best) {
    game.best = game.score;
    game.newRecord = true;
    saveBest(game.best);
  }
}

// ===== 배경 요소 =====
const FLOWER_COLORS = ['#c9f0ff', '#f5b8e6', '#b8f0b0', '#ffe39a', '#d7c4ff'];
const flowers = Array.from({ length: 11 }, (_, i) => ({
  x: i * 100 + rand(-20, 20),
  y: rand(30, 260),
  r: rand(18, 38),
  color: pick(FLOWER_COLORS),
  rot: rand(0, Math.PI),
}));

const kelps = Array.from({ length: 9 }, (_, i) => ({
  x: i * 130 + rand(-30, 30),
  h: rand(80, 170),
  phase: rand(0, Math.PI * 2),
  color: pick(['#3c9a4a', '#4fb35a', '#2f8a5a']),
}));

const bubbles = Array.from({ length: 26 }, () => newBubble(true));

function newBubble(anywhere) {
  return {
    x: rand(0, W + 100),
    y: anywhere ? rand(0, H) : H + rand(10, 80),
    r: rand(2.5, 9),
    speed: rand(30, 80),
    phase: rand(0, Math.PI * 2),
  };
}

// ===== 장애물 =====
const CORAL_COLORS = [
  { main: '#ff7aa8', dark: '#c94473' },
  { main: '#ff9a4d', dark: '#c4621c' },
  { main: '#c77dff', dark: '#8a45c4' },
];

function spawnObstacle() {
  const d = Math.min(1, game.distance / 25000); // 진행할수록 어려워짐
  const pHole = 0.2 + 0.08 * d;
  const pTall = 0.22 + 0.1 * d;
  const pOver = 0.18 + 0.07 * d;
  const r = Math.random();
  const x = game.spawnCursor;
  let o;

  if (r < pHole) {
    o = { type: 'hole', x, w: rand(110, 150 + 40 * d), h: 0 };
  } else if (r < pHole + pOver) {
    // 위에서 내려오는 장애물: 슬라이드로만 통과
    const variant = pick(['kelp', 'sign']);
    o = {
      type: 'over', variant, x,
      w: variant === 'kelp' ? rand(70, 100) : rand(130, 160),
      h: OVER_BOTTOM,
      seed: Math.random() * 100,
    };
  } else if (r < pHole + pOver + pTall) {
    // 2단 점프로만 넘을 수 있는 높이 (1단 최고 ≈142px)
    o = { type: 'tall', variant: pick(['pineapple', 'tiki']), x, w: rand(78, 96), h: rand(165, 192) };
  } else {
    // 1단 점프로 넘을 수 있는 높이
    const variant = pick(['coral', 'rock']);
    o = {
      type: 'low', variant, x,
      w: variant === 'coral' ? rand(48, 66) : rand(70, 90),
      h: rand(55, 85),
      color: pick(CORAL_COLORS),
    };
  }
  game.obstacles.push(o);

  // 장애물 사이 최소 간격: 2단 점프 후 착지해서 다시 뛸 수 있는 거리 보장
  const gap = game.speed * 1.15 + 60 + Math.random() * game.speed * 0.9;
  game.spawnCursor = x + o.w + gap;
}

function obstacleBox(o) {
  if (o.type === 'over') return { x: o.x + 6, y: 0, w: o.w - 12, h: OVER_BOTTOM - 4 };
  const inset = o.type === 'tall' ? 8 : 6;
  return { x: o.x + inset, y: GROUND_Y - o.h + inset, w: o.w - inset * 2, h: o.h - inset };
}

function playerBox() {
  if (player.sliding) return { x: PLAYER_X - 30, y: player.y - 38, w: 60, h: 36 };
  return { x: PLAYER_X - 18, y: player.y - 74, w: 36, h: 70 };
}

function isOverHole() {
  if (player.bubble > 0) return false; // 물방울 보호막 중에는 구멍 위를 떠서 지나감
  return game.obstacles.some(
    (o) => o.type === 'hole' && PLAYER_X > o.x + 8 && PLAYER_X < o.x + o.w - 8
  );
}

// ===== 조작 =====
function jump() {
  if (player.falling || player.jumps >= 2) return;
  player.jumps++;
  player.vy = -JUMP_V;
  player.onGround = false;
  player.sliding = false;
  if (player.jumps === 2) player.spinT = 0;
}

function onSpace() {
  if (game.state === 'home') startGame();
  else if (game.state === 'playing') jump();
  else if (game.state === 'over' && game.overTimer > 0.6) goHome();
}

const keys = { down: false };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) onSpace();
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    keys.down = true;
  } else if (game.state === 'home' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    const n = CHARACTERS.length;
    game.selected = (game.selected + (e.code === 'ArrowLeft' ? -1 : 1) + n) % n;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowDown') keys.down = false;
});
window.addEventListener('blur', () => { keys.down = false; });

// 홈 화면 UI 영역
const CARD_W = 160;
const CARD_H = 212;
const CARD_GAP = 14;
const CARD_Y = 148;
const CARD_X0 = (W - (CARD_W * CHARACTERS.length + CARD_GAP * (CHARACTERS.length - 1))) / 2;
const cardRect = (i) => ({ x: CARD_X0 + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H });
const START_BTN = { x: W / 2 - 110, y: 382, w: 220, h: 50 };
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const p = {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
  if (game.state === 'home') {
    for (let i = 0; i < CHARACTERS.length; i++) {
      if (inRect(p, cardRect(i))) game.selected = i;
    }
    if (inRect(p, START_BTN)) startGame();
  } else if (game.state === 'over' && game.overTimer > 0.6) {
    goHome();
  }
});

// ===== 피격 =====
function shakeScreen() {
  wrap.classList.remove('shake');
  void wrap.offsetWidth; // 애니메이션 재시작
  wrap.classList.add('shake');
}

function damage() {
  game.hp--;
  player.inv = INV_DUR;
  game.flash = 0.25;
  shakeScreen();
  if (game.hp <= 0) gameOver();
}

function respawnFromHole() {
  damage();
  if (game.state !== 'playing') return;
  player.falling = false;
  player.onGround = false;
  player.y = GROUND_Y - 170;
  player.vy = 0;
  player.jumps = 1;
  player.spinT = -1;
  player.inv = INV_DUR + 0.4;
  player.bubble = INV_DUR + 0.4;
}

// ===== 업데이트 =====
function update(dt) {
  game.time += dt;
  if (game.state === 'playing') game.speed = Math.min(MAX_SPEED, game.speed + ACCEL * dt);

  const scroll = game.state === 'playing' ? game.speed : game.state === 'home' ? 160 : 0;
  game.bgOffset += scroll * dt;

  for (const b of bubbles) {
    b.y -= b.speed * dt;
    b.x -= scroll * 0.3 * dt;
    if (b.y < -20 || b.x < -20) Object.assign(b, newBubble(false));
  }

  if (game.flash > 0) game.flash -= dt;

  if (game.state === 'playing') updatePlaying(dt);
  else if (game.state === 'over') game.overTimer += dt;
}

function updatePlaying(dt) {
  const dx = game.speed * dt;
  game.distance += dx;
  game.score = Math.floor(game.distance / 10);

  for (const o of game.obstacles) o.x -= dx;
  game.spawnCursor -= dx;
  while (game.spawnCursor < W + 120) spawnObstacle();
  game.obstacles = game.obstacles.filter((o) => o.x + o.w > -60);

  player.runT += dt * (game.speed / BASE_SPEED);
  if (player.inv > 0) player.inv -= dt;
  if (player.bubble > 0) player.bubble -= dt;
  if (player.spinT >= 0) {
    player.spinT += dt;
    if (player.spinT >= SPIN_DUR) player.spinT = -1;
  }

  // 공중에서 ↓를 누르면 빠르게 내려온다
  if (!player.onGround && !player.falling && keys.down) player.vy += GRAVITY * 1.4 * dt;

  // 달리다가 구멍 위로 들어서면 추락 시작
  if (player.onGround && isOverHole()) {
    player.onGround = false;
    player.falling = true;
    player.jumps = 2;
    player.vy = 0;
  }

  if (!player.onGround) {
    const prevY = player.y;
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;

    if (!player.falling && player.vy > 0 && player.y >= GROUND_Y && prevY <= GROUND_Y + 1) {
      if (isOverHole()) {
        player.falling = true;
        player.jumps = 2;
      } else {
        player.y = GROUND_Y;
        player.vy = 0;
        player.onGround = true;
        player.jumps = 0;
        player.spinT = -1;
      }
    }

    if (player.falling && player.y > H + 100) {
      respawnFromHole();
      return;
    }
  }

  player.sliding = player.onGround && keys.down;

  if (player.inv <= 0 && !player.falling) {
    const pb = playerBox();
    for (const o of game.obstacles) {
      if (o.type !== 'hole' && overlap(pb, obstacleBox(o))) {
        damage();
        break;
      }
    }
  }
}

// ===== 배경 그리기 =====
function drawFlower(x, y, r, color, rot) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    const px = x + Math.cos(a) * r * 0.62;
    const py = y + Math.sin(a) * r * 0.62;
    ctx.moveTo(px + r * 0.5, py);
    ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function drawHills(offset, base, amp1, amp2, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= W; x += 16) {
    const t = x + offset;
    const y = base - amp1 * Math.sin(t * 0.009) - amp2 * Math.sin(t * 0.023 + 1.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, GROUND_Y);
  ctx.closePath();
  ctx.fill();
}

function drawKelp(k) {
  const x = mod(k.x - game.bgOffset * 0.6, W + 200) - 100;
  const n = 8;
  ctx.strokeStyle = k.color;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, GROUND_Y + 4);
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const sway = Math.sin(game.time * 2 + k.phase + i * 0.6) * 7 * (i / n);
    const p = { x: x + sway, y: GROUND_Y + 4 - (k.h * i) / n };
    pts.push(p);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.fillStyle = k.color;
  pts.forEach((p, i) => {
    if (i % 2 === 1) {
      const side = i % 4 === 1 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(p.x + side * 9, p.y, 10, 4, side * -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawBubble(b) {
  const x = b.x + Math.sin(game.time * 2 + b.phase) * 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#5cc8ff');
  g.addColorStop(0.55, '#2a8ee0');
  g.addColorStop(1, '#1a64b0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, GROUND_Y);

  // 하늘 꽃 무늬 (비키니 시티 특유의 꽃 구름)
  ctx.globalAlpha = 0.75;
  for (const f of flowers) {
    const x = mod(f.x - game.bgOffset * 0.12, W + 120) - 60;
    drawFlower(x, f.y, f.r, f.color, f.rot);
  }
  ctx.globalAlpha = 1;

  // 빛줄기
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 4; i++) {
    const x = mod(i * 260 - game.bgOffset * 0.05, W + 300) - 150;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 70, 0);
    ctx.lineTo(x + 190, GROUND_Y);
    ctx.lineTo(x + 100, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }

  drawHills(game.bgOffset * 0.25, GROUND_Y - 70, 30, 16, '#2f7cc4');
  drawHills(game.bgOffset * 0.45 + 400, GROUND_Y - 30, 18, 10, '#2a6aa8');

  for (const k of kelps) drawKelp(k);
}

function drawGround() {
  ctx.fillStyle = '#f3d98b';
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = '#e2bd62';
  ctx.fillRect(0, GROUND_Y, W, 6);
  ctx.fillStyle = '#dcb75e';
  for (let i = 0; i < 44; i++) {
    const x = mod(i * 97 - game.bgOffset, W + 40) - 20;
    const y = GROUND_Y + 20 + ((i * 37) % 76);
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + (i % 3), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 구멍
  for (const o of game.obstacles) {
    if (o.type !== 'hole') continue;
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#0d3159');
    g.addColorStop(1, '#020a16');
    ctx.fillStyle = g;
    ctx.fillRect(o.x, GROUND_Y, o.w, H - GROUND_Y);
    ctx.fillStyle = '#c99d45';
    ctx.fillRect(o.x - 4, GROUND_Y, 4, H - GROUND_Y);
    ctx.fillRect(o.x + o.w, GROUND_Y, 4, H - GROUND_Y);
  }
}

// ===== 장애물 그리기 =====
function drawCoral(o) {
  const base = GROUND_Y;
  const P = (nx, ny) => [o.x + nx * o.w, base - ny * o.h];
  const branches = [
    [[0.5, 0], [0.5, 0.45], [0.22, 0.68], [0.18, 0.86]],
    [[0.5, 0.45], [0.75, 0.62], [0.8, 0.88]],
    [[0.5, 0.45], [0.5, 0.88]],
    [[0.22, 0.68], [0.1, 0.74]],
    [[0.75, 0.62], [0.9, 0.66]],
  ];
  const lw = Math.max(9, o.w * 0.18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [width, color] of [[lw + 5, o.color.dark], [lw, o.color.main]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const br of branches) {
      ctx.beginPath();
      ctx.moveTo(...P(...br[0]));
      for (let i = 1; i < br.length; i++) ctx.lineTo(...P(...br[i]));
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [nx, ny] of [[0.5, 0.25], [0.3, 0.6], [0.72, 0.7], [0.5, 0.7]]) {
    const [x, y] = P(nx, ny);
    ctx.beginPath();
    ctx.arc(x - 1, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRock(o) {
  const base = GROUND_Y;
  const cx = o.x + o.w / 2;
  const domeH = o.h * 0.8;
  // 안테나(풍향계)
  ctx.strokeStyle = '#6b4a2f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, base - domeH + 2);
  ctx.lineTo(cx, base - o.h + 3);
  ctx.moveTo(cx - 8, base - o.h + 8);
  ctx.lineTo(cx + 8, base - o.h + 8);
  ctx.stroke();
  // 바위 돔
  ctx.fillStyle = '#9a6a45';
  ctx.strokeStyle = '#5e3b26';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, base, o.w / 2, domeH, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7d5235';
  for (const [dx, dy, r] of [[-0.22, 0.45, 6], [0.18, 0.62, 5], [0.05, 0.3, 4], [0.28, 0.25, 3.5]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * o.w, base - dy * domeH, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 바닥 해초
  ctx.strokeStyle = '#3c9a4a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const sx of [o.x + 4, o.x + o.w - 4]) {
    ctx.beginPath();
    ctx.moveTo(sx, base);
    ctx.quadraticCurveTo(sx - 6, base - 12, sx + 2, base - 22);
    ctx.stroke();
  }
}

function drawPineapple(o) {
  const base = GROUND_Y;
  const cx = o.x + o.w / 2;
  const bodyH = o.h * 0.72;
  const top = base - bodyH;

  // 잎
  const leafLen = o.h - bodyH + 8;
  for (const a of [-0.95, -0.55, -0.2, 0.2, 0.55, 0.95, 0]) {
    const len = a === 0 ? leafLen : leafLen * (1 - Math.abs(a) * 0.25);
    ctx.save();
    ctx.translate(cx, top + 8);
    ctx.rotate(a);
    ctx.fillStyle = a === 0 ? '#4cc35a' : '#3aa548';
    ctx.strokeStyle = '#25722f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -len / 2, 7, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 몸통
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, base - bodyH / 2, o.w / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f7a531';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(160, 85, 10, 0.55)';
  ctx.lineWidth = 2;
  for (let i = -10; i < 20; i++) {
    const x = o.x + i * 14;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + bodyH, base);
    ctx.moveTo(x + bodyH, top);
    ctx.lineTo(x, base);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#c06f12';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, base - bodyH / 2, o.w / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 창문
  for (const [wx, wy] of [[-0.2, 0.62], [0.2, 0.4]]) {
    ctx.fillStyle = '#86dcff';
    ctx.strokeStyle = '#5a5a6a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx + wx * o.w, base - wy * bodyH, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 문
  ctx.fillStyle = '#5b7fa6';
  ctx.strokeStyle = '#3c5878';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 13, base);
  ctx.lineTo(cx - 13, base - 20);
  ctx.arc(cx, base - 20, 13, Math.PI, 0);
  ctx.lineTo(cx + 13, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawTiki(o) {
  const base = GROUND_Y;
  const cx = o.x + o.w / 2;
  const x0 = o.x + 7;
  const bw = o.w - 14;
  const top = base - o.h;

  // 귀
  ctx.fillStyle = '#7d8ea8';
  ctx.strokeStyle = '#56657d';
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * (bw / 2), top + o.h * 0.4, 8, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 머리
  roundRect(x0, top, bw, o.h + 2, 14);
  ctx.fillStyle = '#8c9db5';
  ctx.fill();
  ctx.stroke();
  // 눈썹
  const browY = base - o.h * 0.72;
  ctx.fillStyle = '#6f7f97';
  roundRect(x0 + 4, browY - 6, bw - 8, 11, 5);
  ctx.fill();
  // 눈 창문
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#34445a';
    ctx.strokeStyle = '#b5c3d6';
    ctx.lineWidth = 2;
    const ex = side < 0 ? cx - 25 : cx + 9;
    ctx.fillRect(ex, browY + 9, 16, 15);
    ctx.strokeRect(ex, browY + 9, 16, 15);
  }
  // 코
  const noseBottom = base - o.h * 0.32;
  roundRect(cx - 8, browY, 16, noseBottom - browY, 6);
  ctx.fillStyle = '#7a8ba3';
  ctx.strokeStyle = '#56657d';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  // 문
  ctx.fillStyle = '#9c6b3c';
  ctx.strokeStyle = '#6b4523';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 13, base);
  ctx.lineTo(cx - 13, base - 24);
  ctx.arc(cx, base - 24, 13, Math.PI, 0);
  ctx.lineTo(cx + 13, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawKelpCurtain(o) {
  const n = Math.max(4, Math.floor(o.w / 15));
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = o.x + 8 + (i * (o.w - 16)) / (n - 1);
    const len = OVER_BOTTOM - ((i * 7 + o.seed) % 3) * 4;
    const color = i % 2 ? '#2f8f45' : '#3fae55';
    ctx.strokeStyle = '#1f6630';
    ctx.lineWidth = 13;
    ctx.beginPath();
    for (let y = -10; y <= len; y += 12) {
      const sx = x + Math.sin(game.time * 2.5 + y * 0.04 + i + o.seed) * 4 * (y / len);
      if (y === -10) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    ctx.stroke();
    // 잎사귀 마디
    ctx.fillStyle = color;
    for (let y = 40 + (i % 3) * 15; y < len - 10; y += 55) {
      const sx = x + Math.sin(game.time * 2.5 + y * 0.04 + i + o.seed) * 4 * (y / len);
      const side = (Math.floor(y / 55) + i) % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(sx + side * 8, y, 9, 4, side * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSign(o) {
  const boardH = 84;
  const top = OVER_BOTTOM - boardH;
  // 사슬
  ctx.strokeStyle = '#6d6d78';
  ctx.lineWidth = 4;
  for (const cx of [o.x + 22, o.x + o.w - 22]) {
    for (let y = -6; y < top; y += 14) {
      ctx.beginPath();
      ctx.ellipse(cx, y + 7, 4, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // 나무 간판
  roundRect(o.x, top, o.w, boardH, 10);
  ctx.fillStyle = '#9b6232';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#5c3414';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(92, 52, 20, 0.45)';
  ctx.lineWidth = 2;
  for (const ly of [top + 22, top + 44, top + 64]) {
    ctx.beginPath();
    ctx.moveTo(o.x + 6, ly);
    ctx.lineTo(o.x + o.w - 6, ly);
    ctx.stroke();
  }
  // 안쪽 판 + 글자
  roundRect(o.x + 10, top + 10, o.w - 20, boardH - 20, 8);
  ctx.fillStyle = '#4aa3df';
  ctx.fill();
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 3;
  ctx.stroke();
  drawText('집게리아', o.x + o.w / 2, top + boardH / 2 + 2, Math.min(34, o.w / 4.4), '#ff4d3d', 'center', '#ffffff');
  // 양쪽 집게 장식
  ctx.fillStyle = '#e8402e';
  for (const side of [-1, 1]) {
    const cx = o.x + o.w / 2 + side * (o.w / 2 - 2);
    ctx.beginPath();
    ctx.arc(cx, top + boardH / 2, 9, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.fill();
  }
}

function drawObstacles() {
  for (const o of game.obstacles) {
    if (o.type === 'hole') continue;
    if (o.variant === 'coral') drawCoral(o);
    else if (o.variant === 'rock') drawRock(o);
    else if (o.variant === 'pineapple') drawPineapple(o);
    else if (o.variant === 'tiki') drawTiki(o);
    else if (o.variant === 'kelp') drawKelpCurtain(o);
    else drawSign(o);
  }
}

// ===== 캐릭터 그리기 =====
// 원점(0,0) = 발 밑 중앙. air=true면 다리를 벌린 점프 포즈.
function drawLimb(x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawSponge(pose, t) {
  const air = pose === 'air';
  const sw = Math.sin(t * 18);
  const YELLOW = '#fff35c';
  const OUT = '#b8a400';

  // 다리 + 양말 + 신발
  const feet = air
    ? [{ hx: -10, x: -26, y: -4 }, { hx: 10, x: 26, y: -4 }]
    : [{ hx: -10, x: -10 + sw * 9, y: 0 }, { hx: 10, x: 10 - sw * 9, y: 0 }];
  for (const f of feet) {
    const mx = (f.hx + f.x) / 2;
    const my = (-20 + f.y) / 2;
    drawLimb(f.hx, -20, mx, my, YELLOW, 4);
    drawLimb(mx, my, f.x, f.y - 3, '#ffffff', 5);
    ctx.fillStyle = '#e8463c';
    ctx.fillRect(mx - 2.5, my + 1, 5, 1.6);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(f.x + 3, f.y - 3, 7, 4, air ? (f.x < 0 ? 0.6 : -0.6) : 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 팔
  const arms = pose === 'slide'
    ? [[-28, -50, -22, -90], [28, -50, 22, -90]]
    : air
    ? [[-28, -50, -42, -70], [28, -50, 42, -70]]
    : [[-28, -50, -36 - sw * 4, -34], [28, -50, 36 + sw * 4, -34]];
  for (const [x1, y1, x2, y2] of arms) {
    drawLimb(x1, y1, x2, y2, YELLOW, 4);
    ctx.fillStyle = YELLOW;
    ctx.beginPath();
    ctx.arc(x2, y2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.fillRect(x1 + (x1 < 0 ? -5 : 0), y1 - 4, 5, 8);
  }

  // 몸 (스펀지)
  ctx.fillStyle = YELLOW;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-28, -42);
  for (let i = 0; i <= 4; i++) ctx.quadraticCurveTo(-31, -46 - i * 8 + 4, -28, -46 - i * 8);
  for (let i = 0; i < 7; i++) ctx.quadraticCurveTo(-28 + i * 8 + 4, -82, -28 + (i + 1) * 8, -79);
  for (let i = 0; i <= 4; i++) ctx.quadraticCurveTo(31, -79 + i * 8 + 4, 28, -79 + (i + 1) * 8 - 1);
  ctx.lineTo(28, -42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d4c935';
  for (const [hx, hy, r] of [[-20, -72, 3.5], [20, -74, 3], [-22, -47, 2.5], [22, -48, 3.5], [16, -44, 2]]) {
    ctx.beginPath();
    ctx.ellipse(hx, hy, r, r * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 셔츠 + 바지 + 넥타이
  ctx.fillStyle = '#fff';
  ctx.fillRect(-28, -42, 56, 7);
  ctx.fillStyle = '#a0582a';
  ctx.fillRect(-28, -35, 56, 15);
  ctx.strokeStyle = '#6e3a17';
  ctx.strokeRect(-28, -35, 56, 15);
  ctx.fillStyle = '#111';
  ctx.fillRect(-28, -32, 56, 3);
  ctx.fillStyle = '#fff';
  for (const bx of [-20, -8, 4, 16]) ctx.fillRect(bx, -32, 5, 3);
  ctx.fillStyle = '#e8312a';
  ctx.beginPath();
  ctx.moveTo(-3, -42);
  ctx.lineTo(3, -42);
  ctx.lineTo(4, -33);
  ctx.lineTo(0, -29);
  ctx.lineTo(-4, -33);
  ctx.closePath();
  ctx.fill();

  // 눈
  for (const ex of [-11, 11]) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ex, -62, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3fa9f5';
    ctx.beginPath();
    ctx.arc(ex + 2, -62, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex + 2, -62, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    for (const lx of [-5, 0, 5]) {
      ctx.beginPath();
      ctx.moveTo(ex + lx, -72);
      ctx.lineTo(ex + lx * 1.3, -76);
      ctx.stroke();
    }
  }
  // 볼, 코, 입, 이빨
  ctx.fillStyle = 'rgba(240, 90, 80, 0.55)';
  for (const cx of [-21, 21]) {
    ctx.beginPath();
    ctx.arc(cx, -51, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = YELLOW;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(4, -55, 5, 3.5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-16, -51);
  ctx.quadraticCurveTo(0, -40, 16, -51);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  for (const tx of [-5.5, 1]) {
    ctx.fillRect(tx, -46, 4.5, 5);
    ctx.strokeRect(tx, -46, 4.5, 5);
  }
}

function drawPatrick(pose, t) {
  const air = pose === 'air';
  const sw = Math.sin(t * 18);
  const PINK = '#ff9ec4';
  const OUT = '#d9578d';

  // 다리 (아래쪽 별 꼭짓점)
  const feet = air
    ? [{ hx: -11, x: -30, y: -6 }, { hx: 11, x: 30, y: -6 }]
    : [{ hx: -11, x: -11 + sw * 9, y: 0 }, { hx: 11, x: 11 - sw * 9, y: 0 }];
  ctx.lineJoin = 'round';
  for (const f of feet) {
    ctx.fillStyle = PINK;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.hx - 9, -24);
    ctx.lineTo(f.hx + 9, -24);
    ctx.quadraticCurveTo(f.x + 6, f.y - 4, f.x, f.y);
    ctx.quadraticCurveTo(f.x - 6, f.y - 4, f.hx - 9, -24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 윗몸 (머리 꼭짓점 + 팔 꼭짓점)
  const armY = pose === 'slide' ? -86 : air ? -76 : -60 + sw * 3;
  const armX = pose === 'slide' ? 26 : air ? 44 : 42;
  ctx.fillStyle = PINK;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-23, -42);
  ctx.quadraticCurveTo(-30, -54, -armX, armY);
  ctx.quadraticCurveTo(-armX + 2, armY - 8, -16, -64);
  ctx.quadraticCurveTo(-10, -90, 0, -98);
  ctx.quadraticCurveTo(10, -90, 16, -64);
  ctx.quadraticCurveTo(armX - 2, armY - 8, armX, armY);
  ctx.quadraticCurveTo(30, -54, 23, -42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 바지 (초록 + 보라 꽃무늬)
  ctx.fillStyle = '#7ed957';
  ctx.strokeStyle = '#4c9c2e';
  ctx.beginPath();
  ctx.moveTo(-24, -44);
  ctx.lineTo(24, -44);
  ctx.lineTo(22, -22);
  ctx.lineTo(-22, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a35bd6';
  for (const [fx, fy] of [[-13, -36], [6, -30], [15, -39], [-4, -27]]) {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 얼굴
  for (const ex of [-6, 6]) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(ex, -75, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex + (ex < 0 ? 1.5 : -1.5), -74, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  drawLimb(-11, -86, -3, -84, '#111', 2.5);
  drawLimb(3, -84, 11, -86, '#111', 2.5);
  ctx.fillStyle = '#8b1a3a';
  ctx.beginPath();
  ctx.moveTo(-10, -64);
  ctx.quadraticCurveTo(0, -53, 10, -64);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff6b8a';
  ctx.beginPath();
  ctx.ellipse(0, -59, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 테두리 있는 굵은 선 (팔/다리용)
function drawOutlinedLimb(x1, y1, x2, y2, color, outline, width) {
  drawLimb(x1, y1, x2, y2, outline, width + 3);
  drawLimb(x1, y1, x2, y2, color, width);
}

// 포즈별 팔 끝 위치: [달리기, 점프, 슬라이드]
function armEnd(pose, side, run, air, slide) {
  const p = pose === 'slide' ? slide : pose === 'air' ? air : run;
  return [side * p[0], p[1]];
}

function drawSquid(pose, t) {
  const air = pose === 'air';
  const sw = Math.sin(t * 18);
  const SKIN = '#9fd8c8';
  const OUT = '#4f8f80';

  // 문어 다리 4개
  [-12, -4, 4, 12].forEach((hx, i) => {
    const dir = i % 2 ? 1 : -1;
    const fx = air ? hx * 2.6 : hx + dir * sw * 8;
    const fy = air ? -8 : 0;
    for (const [color, width] of [[OUT, 8], [SKIN, 5]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, -30);
      ctx.quadraticCurveTo(hx + (fx - hx) * 0.3 + 5, -12, fx, fy);
      ctx.quadraticCurveTo(fx + 6, fy + 1, fx + 7, fy - 4);
      ctx.stroke();
    }
  });

  // 머리 (길쭉한 달걀형)
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -80, 19, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 갈색 셔츠
  ctx.fillStyle = '#b5652a';
  ctx.strokeStyle = '#7a3f14';
  ctx.beginPath();
  ctx.moveTo(-15, -58);
  ctx.lineTo(15, -58);
  ctx.lineTo(19, -30);
  ctx.lineTo(-19, -30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 팔
  for (const side of [-1, 1]) {
    const [ex, ey] = armEnd(pose, side, [24 + side * sw * 3, -36], [34, -74], [12, -106]);
    drawOutlinedLimb(side * 14, -54, ex, ey, SKIN, OUT, 4);
  }

  // 반쯤 감긴 눈
  for (const ex of [-8, 8]) {
    ctx.fillStyle = '#fffbe6';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(ex, -80, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#b0303a';
    ctx.beginPath();
    ctx.arc(ex, -76.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.ellipse(ex, -80, 7.6, 8.6, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    drawLimb(ex - 7, -80, ex + 7, -80, OUT, 1.5);
  }

  // 늘어진 큰 코
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-4, -77);
  ctx.quadraticCurveTo(-8, -55, 1, -48);
  ctx.quadraticCurveTo(9, -56, 4, -77);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawLimb(-12, -61, -7, -63, '#333', 1.5);
}

function drawKrabs(pose, t) {
  const air = pose === 'air';
  const sw = Math.sin(t * 18);
  const RED = '#e8402e';
  const OUT = '#a3241a';

  // 뾰족한 다리
  const feet = air
    ? [[-10, -28, -6], [10, 28, -6]]
    : [[-10, -10 + sw * 9, 0], [10, 10 - sw * 9, 0]];
  for (const [hx, fx, fy] of feet) drawOutlinedLimb(hx, -28, fx, fy, RED, OUT, 5);

  // 눈자루
  for (const side of [-1, 1]) {
    drawOutlinedLimb(side * 7, -70, side * 10, -92, RED, OUT, 3);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(side * 10, -95, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(side * 10 + 1.5, -95, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 몸 + 하늘색 셔츠 + 벨트
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -50, 30, 24, 0, 0, Math.PI * 2);
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#8fd0f0';
  ctx.fillRect(-32, -50, 64, 26);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-10, -50);
  ctx.lineTo(0, -42);
  ctx.lineTo(10, -50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6b3d1f';
  ctx.fillRect(-32, -36, 64, 5);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(-4, -37, 8, 7);
  ctx.restore();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -50, 30, 24, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 입
  ctx.strokeStyle = '#5a0e0e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-15, -62);
  ctx.quadraticCurveTo(0, -52, 15, -62);
  ctx.stroke();

  // 집게발
  for (const side of [-1, 1]) {
    const [cx, cy] = armEnd(pose, side, [42, -46 + side * sw * 4], [40, -80], [16, -102]);
    drawOutlinedLimb(side * 27, -54, cx, cy, RED, OUT, 4);
    ctx.fillStyle = RED;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.5;
    for (const [dy, rx, ry, rot] of [[-4, 10, 5.5, -0.3], [5, 8, 4.5, 0.3]]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * 2, cy + dy, rx, ry, side * rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawSandy(pose, t) {
  const air = pose === 'air';
  const sw = Math.sin(t * 18);
  const SUIT = '#f5f5f5';
  const OUT = '#9a9a9a';
  const FUR = '#b97a45';

  // 꼬리 (등 뒤)
  ctx.fillStyle = FUR;
  ctx.strokeStyle = '#7a4a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-25, -50 + sw * 2, 10, 22, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 다리 + 부츠
  const feet = air
    ? [[-8, -24, -6], [8, 24, -6]]
    : [[-8, -8 + sw * 8, 0], [8, 8 - sw * 8, 0]];
  for (const [hx, fx, fy] of feet) {
    drawOutlinedLimb(hx, -18, fx, fy - 3, SUIT, OUT, 7);
    ctx.fillStyle = '#55606e';
    ctx.beginPath();
    ctx.ellipse(fx + 2, fy - 3, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 잠수복 몸통
  roundRect(-20, -52, 40, 36, 12);
  ctx.fillStyle = SUIT;
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#8b5a2b';
  ctx.beginPath();
  ctx.ellipse(8, -36, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c3a18';
  ctx.fillRect(4, -42, 8, 3);

  // 팔 + 장갑
  for (const side of [-1, 1]) {
    const [ex, ey] = armEnd(pose, side, [28 + side * sw * 3, -30], [34, -70], [14, -106]);
    drawOutlinedLimb(side * 18, -46, ex, ey, SUIT, OUT, 6);
    ctx.fillStyle = '#8a6fd1';
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 헬멧 목 링
  roundRect(-14, -54, 28, 6, 3);
  ctx.fillStyle = '#c8c8c8';
  ctx.fill();

  // 다람쥐 얼굴
  ctx.fillStyle = FUR;
  for (const ex of [-11, 11]) {
    ctx.beginPath();
    ctx.arc(ex, -86, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, -73, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3dcc0';
  ctx.beginPath();
  ctx.ellipse(0, -66, 9, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const ex of [-6, 6]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, -76, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex + 1, -76, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(0, -69.5, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 0.8;
  for (const tx of [-3, 0]) {
    ctx.fillRect(tx, -65, 3, 5);
    ctx.strokeRect(tx, -65, 3, 5);
  }

  // 유리 헬멧
  ctx.fillStyle = 'rgba(210, 240, 255, 0.35)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -75, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, -75, 27.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -75, 20, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();

  // 헬멧 위 꽃
  ctx.fillStyle = '#ff8ccf';
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 5, -106 + Math.sin(a) * 5, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffd84d';
  ctx.beginPath();
  ctx.arc(0, -106, 3, 0, Math.PI * 2);
  ctx.fill();
}

const DRAWERS = {
  sponge: drawSponge,
  patrick: drawPatrick,
  squid: drawSquid,
  krabs: drawKrabs,
  sandy: drawSandy,
};

// pose: 'run' | 'air'(다리 벌린 점프) | 'slide'(뒤로 누워 미끄러짐)
function drawCharacter(id, x, y, opts = {}) {
  const { pose = 'run', t = 0, spin = 0, scale = 1 } = opts;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (pose === 'slide') {
    // 발을 앞(오른쪽)으로, 머리를 뒤로 눕힌다
    const halfW = CHARACTERS.find((c) => c.id === id).halfW;
    ctx.translate(36, -halfW * SLIDE_SCALE);
    ctx.rotate(-Math.PI / 2);
    ctx.scale(SLIDE_SCALE, SLIDE_SCALE);
  }
  if (spin) {
    ctx.translate(0, -46);
    ctx.rotate(spin);
    ctx.translate(0, 46);
  }
  DRAWERS[id](pose, t);
  ctx.restore();
}

function drawPlayer() {
  const id = CHARACTERS[game.selected].id;
  const blinking = player.inv > 0 && player.bubble <= 0 && Math.floor(player.inv * 12) % 2 === 0;
  const spin = player.spinT >= 0 ? (player.spinT / SPIN_DUR) * Math.PI * 2 : 0;

  ctx.save();
  // 구멍 속으로 떨어질 때 바닥 뒤로 가려지도록 클립
  ctx.beginPath();
  ctx.rect(0, 0, W, GROUND_Y);
  for (const o of game.obstacles) {
    if (o.type === 'hole') ctx.rect(o.x, GROUND_Y, o.w, H - GROUND_Y);
  }
  ctx.clip();

  // 그림자
  if (!player.falling && !isOverHole()) {
    const hgt = GROUND_Y - player.y;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(PLAYER_X, GROUND_Y + 2, Math.max(8, 26 - hgt * 0.06), 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const pose = player.sliding ? 'slide' : player.onGround ? 'run' : 'air';
  if (player.sliding) {
    // 슬라이드 모래 먼지
    ctx.fillStyle = 'rgba(243, 217, 139, 0.8)';
    for (let i = 0; i < 4; i++) {
      const k = mod(game.time * 3 + i * 0.25, 1);
      ctx.beginPath();
      ctx.arc(PLAYER_X - 50 - k * 50, GROUND_Y - 6 - k * 12, 4 + k * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = blinking ? 0.35 : 1;
  drawCharacter(id, PLAYER_X, player.y, { pose, t: player.runT, spin });
  ctx.globalAlpha = 1;

  if (player.bubble > 0) {
    const r = 58 + Math.sin(game.time * 8) * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.fillStyle = 'rgba(180,235,255,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(PLAYER_X, player.y - 46, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(PLAYER_X - r * 0.45, player.y - 46 - r * 0.5, 10, 6, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ===== HUD / 화면 =====
function drawHeart(x, y, s, filled) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.3);
  ctx.bezierCurveTo(0, 0, -s * 0.5, 0, -s * 0.5, s * 0.3);
  ctx.bezierCurveTo(-s * 0.5, s * 0.6, 0, s * 0.75, 0, s * 0.95);
  ctx.bezierCurveTo(0, s * 0.75, s * 0.5, s * 0.6, s * 0.5, s * 0.3);
  ctx.bezierCurveTo(s * 0.5, 0, 0, 0, 0, s * 0.3);
  ctx.closePath();
  ctx.fillStyle = filled ? '#ff4d6d' : 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = filled ? '#9e1030' : 'rgba(18,58,99,0.8)';
  ctx.stroke();
  if (filled) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.25, s * 0.25, s * 0.08, s * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHUD() {
  for (let i = 0; i < MAX_HP; i++) drawHeart(42 + i * 46, 18, 38, i < game.hp);
  drawText(`SCORE ${game.score}`, W - 24, 36, 34, '#ffe14d', 'right');
  drawText(`BEST ${Math.max(game.best, game.score)}`, W - 24, 70, 20, '#ffffff', 'right');
}

function drawHome() {
  ctx.fillStyle = 'rgba(6, 34, 63, 0.25)';
  ctx.fillRect(0, 0, W, H);

  const bob = Math.sin(game.time * 3) * 4;
  drawText('SpongeBob Run', W / 2, 58 + bob, 60, '#ffe14d', 'center', '#8a4b00');
  drawText(`🏆 최고 기록 : ${game.best}`, W / 2, 108, 26, '#ffffff');

  CHARACTERS.forEach((c, i) => {
    const r = cardRect(i);
    const sel = i === game.selected;
    roundRect(r.x, r.y, r.w, r.h, 18);
    ctx.fillStyle = sel ? 'rgba(255, 241, 140, 0.92)' : 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    ctx.lineWidth = sel ? 6 : 3;
    ctx.strokeStyle = sel ? '#ff9d00' : 'rgba(18,58,99,0.5)';
    ctx.stroke();

    const jumpY = sel ? Math.abs(Math.sin(game.time * 4)) * -14 : 0;
    drawCharacter(c.id, r.x + r.w / 2, r.y + 160 + jumpY, {
      t: sel ? game.time : 0,
      pose: sel && jumpY < -10 ? 'air' : 'run',
      scale: 1.15,
    });
    drawText(c.name, r.x + r.w / 2, r.y + r.h - 24, 26, sel ? '#ff7a00' : '#ffffff');
    if (sel) drawText('▼', r.x + r.w / 2, r.y - 14 + bob * 0.5, 22, '#ffe14d');
  });

  roundRect(START_BTN.x, START_BTN.y, START_BTN.w, START_BTN.h, 25);
  ctx.fillStyle = '#ff9d00';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8a4b00';
  ctx.stroke();
  drawText('게임 시작 ▶', W / 2, START_BTN.y + START_BTN.h / 2 + 2, 30, '#ffffff', 'center', '#8a4b00');

  drawText('← → 또는 클릭으로 캐릭터 선택  ·  SPACE 로 시작', W / 2, 466, 20, '#ffffff');
  drawText('SPACE 점프 (2단 점프 가능)  ·  ↓ 누르고 있기 = 슬라이드', W / 2, 496, 20, '#ffe14d');
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(2, 16, 36, 0.6)';
  ctx.fillRect(0, 0, W, H);

  roundRect(W / 2 - 240, 110, 480, 310, 26);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ff9d00';
  ctx.stroke();

  drawText('GAME OVER', W / 2, 170, 64, '#ff4d6d', 'center', '#5a0e1e');
  drawText(`점수  ${game.score}`, W / 2, 245, 40, '#ffe14d', 'center', '#123a63');
  drawText(`최고 기록  ${game.best}`, W / 2, 297, 28, '#ffffff', 'center', '#123a63');
  if (game.newRecord && Math.floor(game.time * 3) % 2 === 0) {
    drawText('★ NEW RECORD! ★', W / 2, 342, 28, '#ff9d00', 'center', '#5a2a00');
  }
  if (game.overTimer > 0.6) {
    drawText('SPACE 를 눌러 홈으로', W / 2, 390, 22, '#ffffff', 'center', '#123a63');
  }
}

function render() {
  drawBackground();
  drawGround();

  if (game.state !== 'home') {
    drawObstacles();
    drawPlayer();
  }

  for (const b of bubbles) drawBubble(b);

  if (game.state === 'home') {
    drawHome();
  } else {
    drawHUD();
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 40, 60, ${game.flash * 1.4})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (game.state === 'over') drawGameOver();
  }
}

// ===== 메인 루프 =====
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
