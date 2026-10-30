(() => {
  'use strict';

  const stage = document.getElementById('dino-stage');
  const canvas = document.getElementById('dino-canvas');
  if (!stage || !canvas) return;

  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('dino-overlay');
  const overlayTitle = document.getElementById('dino-overlay-title');
  const overlaySub = document.getElementById('dino-overlay-sub');
  const startBtn = document.getElementById('dino-start');
  const scoreEl = document.getElementById('dino-score');
  const hiEl = document.getElementById('dino-hi');

  const INK = '#232842';
  const GROUND = '#c7cee3';
  const HI_KEY = 'd1n910-dino-hi';

  const GRAVITY = 1180;
  const JUMP_V = 404;
  const JUMP_CUT = 186;

  let W = 360;
  let H = 250;
  let k = 1;
  let grid = 2;
  let groundY = 210;
  let bumps = [];
  let bumpsTotal = 1;

  const state = {
    mode: 'ready',
    time: 0,
    speed: 0,
    dist: 0,
    score: 0,
    hi: 0,
    diedAt: 0,
    obstacles: [],
    clouds: [],
    groundOffset: 0,
    spawnIn: 1,
    cloudIn: 0.4,
    nextBonus: 100
  };

  const runner = {
    x: 0,
    y: 0,
    vy: 0,
    airborne: false,
    ducking: false,
    squash: 0,
    tilt: 0,
    size: 54
  };

  let logoSprite = null;
  let logoReady = false;

  // ---------- 音效 ----------
  let audio = null;
  function beep(freq, dur, type, gain) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);
      amp.gain.setValueAtTime(gain || 0.05, now);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(amp).connect(audio.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (err) {
      /* 静音降级 */
    }
  }

  // ---------- logo：抠掉白底，做成快跑的小圆章 ----------
  const logoImg = new Image();
  logoImg.decoding = 'async';
  logoImg.addEventListener('load', () => {
    const size = 256;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d', { willReadFrequently: true });
    try {
      octx.drawImage(logoImg, 0, 0, size, size);
      const frame = octx.getImageData(0, 0, size, size);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        const m = Math.min(px[i], px[i + 1], px[i + 2]);
        if (m > 236) px[i + 3] = 0;
        else if (m > 206) px[i + 3] = Math.round((px[i + 3] * (236 - m)) / 30);
      }
      octx.putImageData(frame, 0, 0);
      logoSprite = off;
    } catch (err) {
      logoSprite = logoImg;
    }
    logoReady = true;
  });
  logoImg.src = canvas.dataset.logo || '/images/logo.jpg';

  // ---------- 尺寸 ----------
  function resize() {
    const rect = stage.getBoundingClientRect();
    W = Math.max(260, Math.round(rect.width));
    H = Math.max(180, Math.round(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    k = Math.max(0.55, Math.min(1.06, Math.min(W / 780, H / 300)));
    grid = Math.max(2, Math.round(2 * k));
    groundY = Math.round(H - Math.max(28, 44 * k));
    runner.size = Math.round(Math.max(36, 56 * k));
    runner.x = Math.round(Math.max(34 * k, W * 0.11));
    if (!runner.airborne) runner.y = groundY;

    buildBumps();
  }

  function buildBumps() {
    bumpsTotal = Math.max(1200 * k, W * 1.5);
    bumps = [];
    let x = 0;
    while (x < bumpsTotal) {
      const len = grid * (1 + Math.round(Math.random() * 3));
      bumps.push({ x: Math.round(x / grid) * grid, len });
      x += len + grid * (3 + Math.round(Math.random() * 11));
    }
  }

  // ---------- 状态机 ----------
  function pad5(n) {
    return String(Math.max(0, Math.min(99999, Math.floor(n)))).padStart(5, '0');
  }

  function paintHud() {
    scoreEl.textContent = pad5(state.score);
    hiEl.textContent = pad5(Math.max(state.hi, state.score));
  }

  function reset() {
    state.time = 0;
    state.speed = 0;
    state.dist = 0;
    state.score = 0;
    state.obstacles.length = 0;
    state.clouds.length = 0;
    state.groundOffset = 0;
    state.spawnIn = 0.9;
    state.cloudIn = 0.35;
    state.nextBonus = 100;
    runner.y = groundY;
    runner.vy = 0;
    runner.airborne = false;
    runner.ducking = false;
    runner.squash = 0;
    runner.tilt = 0;
    paintHud();
  }

  function start() {
    reset();
    state.mode = 'running';
    overlay.hidden = true;
    beep(760, 0.06, 'square', 0.04);
  }

  function restart() {
    if (performance.now() - state.diedAt < 350) return;
    start();
  }

  function gameOver() {
    state.mode = 'over';
    state.diedAt = performance.now();
    runner.ducking = false;
    runner.tilt = 0.3;
    if (state.score > state.hi) {
      state.hi = state.score;
      try {
        localStorage.setItem(HI_KEY, String(state.hi));
      } catch (err) {
        /* 隐私模式下无法存储 */
      }
    }
    beep(150, 0.3, 'sawtooth', 0.05);
    overlayTitle.textContent = '撞上了！本局 ' + state.score + ' 分';
    overlaySub.textContent =
      state.score >= state.hi ? '新纪录，可以再来一局。' : '最高分 ' + state.hi + ' 分，再冲一次？';
    startBtn.textContent = '再来一局';
    overlay.hidden = false;
    paintHud();
  }

  function jump() {
    if (state.mode === 'ready') return start();
    if (state.mode === 'over') return restart();
    if (runner.airborne) return;
    runner.ducking = false;
    runner.airborne = true;
    runner.vy = -JUMP_V * k;
    runner.squash = -0.16;
    beep(630, 0.07, 'square', 0.035);
  }

  function jumpCut() {
    if (runner.airborne && runner.vy < -JUMP_CUT * k) runner.vy = -JUMP_CUT * k;
  }

  function setDuck(on) {
    if (state.mode !== 'running') return;
    if (on && runner.airborne) return;
    runner.ducking = on;
  }

  // ---------- 生成障碍 ----------
  function spawnObstacle() {
    const birdChance = state.score >= 260 ? 0.26 : 0;
    if (Math.random() < birdChance) {
      const w = Math.round(Math.max(34, 48 * k));
      const h = Math.round(w * 0.7);
      const s = runner.size;
      // 低位：必须跳过去；高位：必须蹲下钻过去
      const low = groundY - Math.round(s * 0.18) - h;
      const high = groundY - Math.round(s * 0.62) - h;
      const y = Math.random() < 0.55 ? low : high;
      state.obstacles.push({ type: 'bird', x: W + 20, w, h, y, lane: y === low ? 0 : 1 });
      return;
    }

    const cluster = Math.random() < 0.32 ? (Math.random() < 0.55 ? 2 : 3) : 1;
    const unitW = Math.round(Math.max(16, 21 * k));
    const gapW = Math.round(Math.max(3, 5 * k));
    const h = Math.round((42 + Math.random() * 14) * k);
    const w = cluster * unitW + (cluster - 1) * gapW;
    state.obstacles.push({
      type: 'cactus',
      x: W + 20,
      w,
      h,
      y: groundY - h,
      unitW,
      gapW,
      cluster
    });
  }

  function hits(o) {
    const s = runner.size;
    const duck = runner.ducking && !runner.airborne;
    const bw = duck ? s * 0.96 : s * 0.7;
    const bh = duck ? s * 0.42 : s * 0.76;
    const bx = runner.x - bw / 2;
    const by = runner.y - bh;

    const inset = Math.max(2, 4 * k);
    const ox = o.x + inset;
    const ow = o.w - inset * 2;
    const oy = o.y + inset;
    const oh = o.h - inset * 2;

    return bx < ox + ow && bx + bw > ox && by < oy + oh && by + bh > oy;
  }

  // ---------- 每帧逻辑 ----------
  function update(dt) {
    if (state.mode === 'ready') {
      runner.squash += (0 - runner.squash) * Math.min(1, dt * 10);
      runner.tilt = Math.sin(performance.now() / 760) * 0.05;
      return;
    }
    if (state.mode === 'over') {
      runner.squash += (0 - runner.squash) * Math.min(1, dt * 10);
      return;
    }

    state.time += dt;
    state.speed = (296 + Math.min(state.time, 40) * 6.6) * k;
    const moved = state.speed * dt;
    state.dist += moved;
    state.groundOffset = (state.groundOffset + moved) % bumpsTotal;

    const next = Math.floor(state.dist / (11 * k));
    if (next !== state.score) {
      state.score = next;
      if (state.score >= state.nextBonus) {
        state.nextBonus += 100;
        beep(1040, 0.08, 'square', 0.03);
      }
      paintHud();
    }

    state.cloudIn -= dt;
    if (state.cloudIn <= 0) {
      state.cloudIn = 1.7 + Math.random() * 2.4;
      state.clouds.push({
        x: W + 40 * k,
        y: Math.round((14 + Math.random() * 40) * k),
        s: 0.7 + Math.random() * 0.55,
        v: 0.32 + Math.random() * 0.16
      });
    }
    for (let i = state.clouds.length - 1; i >= 0; i--) {
      const c = state.clouds[i];
      c.x -= state.speed * c.v * dt;
      if (c.x < -90 * k) state.clouds.splice(i, 1);
    }

    if (runner.airborne) {
      runner.vy += GRAVITY * k * dt;
      runner.y += runner.vy * dt;
      runner.tilt = Math.max(-0.24, Math.min(0.32, runner.vy / (940 * k)));
      if (runner.y >= groundY) {
        runner.y = groundY;
        runner.vy = 0;
        runner.airborne = false;
        runner.squash = 0.2;
      }
    } else {
      runner.tilt = 0;
      runner.squash += (0 - runner.squash) * Math.min(1, dt * 9);
    }

    state.spawnIn -= dt;
    if (state.spawnIn <= 0) {
      spawnObstacle();
      const pressure = Math.max(0.72, Math.min(1.15, (340 * k) / state.speed));
      state.spawnIn = (0.8 + Math.random() * 0.7) * pressure;
    }

    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.x -= state.speed * (o.type === 'bird' ? 1.08 : 1) * dt;
      if (o.x + o.w < -12) {
        state.obstacles.splice(i, 1);
        continue;
      }
      if (hits(o)) {
        gameOver();
        return;
      }
    }
  }

  // ---------- 绘制 ----------
  function drawGround() {
    const y = groundY + grid * 2;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, y, W, grid);

    ctx.fillStyle = 'rgba(150, 160, 198, 0.55)';
    const off = state.groundOffset;
    for (let i = 0; i < bumps.length; i++) {
      const b = bumps[i];
      let x = b.x - off;
      if (x + b.len < 0) x += bumpsTotal;
      if (x > W) continue;
      ctx.fillRect(Math.round(x), y + grid * 2, b.len, grid);
    }
  }

  function drawCloud(c) {
    const u = Math.max(2, Math.round(grid * 1.6 * c.s));
    const x = Math.round(c.x / u) * u;
    const y = Math.round(c.y / u) * u;
    ctx.fillStyle = 'rgba(146, 158, 205, 0.38)';
    ctx.fillRect(x + u * 2, y, u * 3, u);
    ctx.fillRect(x + u, y + u, u * 6, u);
    ctx.fillRect(x, y + u * 2, u * 8, u);
  }

  function drawCactusUnit(left, bottom, unitW, height) {
    const top = bottom - height;
    const put = (rx, ry, rw, rh) => {
      ctx.fillRect(
        Math.round(left + unitW * rx),
        Math.round(top + height * ry),
        Math.max(2, Math.round(unitW * rw)),
        Math.max(2, Math.round(height * rh))
      );
    };
    // 主干
    put(0.33, 0, 0.34, 1);
    // 左臂：竖杆 + 底部横向连接
    put(0, 0.34, 0.26, 0.38);
    put(0.13, 0.6, 0.37, 0.12);
    // 右臂：竖杆 + 底部横向连接
    put(0.74, 0.18, 0.26, 0.34);
    put(0.5, 0.4, 0.37, 0.12);
  }

  function drawCactus(o) {
    ctx.fillStyle = INK;
    for (let i = 0; i < o.cluster; i++) {
      drawCactusUnit(o.x + i * (o.unitW + o.gapW), groundY, o.unitW, o.h);
    }
  }

  function drawBird(o) {
    const w = o.w;
    const h = o.h;
    const x = Math.round(o.x);
    const y = Math.round(o.y);
    const up = Math.floor(state.time * 7) % 2 === 0;
    const p = (v) => Math.round(v);
    const px = (u) => p(x + w * u);
    const py = (v) => p(y + h * v);

    ctx.fillStyle = INK;

    // 翅膀：上下两帧，明显挑出身体之外
    ctx.beginPath();
    if (up) {
      ctx.moveTo(px(0.44), py(0.58));
      ctx.lineTo(px(0.2), py(0.02));
      ctx.lineTo(px(0.62), py(0.48));
    } else {
      ctx.moveTo(px(0.44), py(0.6));
      ctx.lineTo(px(0.22), py(0.99));
      ctx.lineTo(px(0.63), py(0.68));
    }
    ctx.closePath();
    ctx.fill();

    // 尾巴
    ctx.beginPath();
    ctx.moveTo(px(0.28), py(0.58));
    ctx.lineTo(px(0.06), py(0.47));
    ctx.lineTo(px(0.08), py(0.7));
    ctx.closePath();
    ctx.fill();

    // 身体
    ctx.beginPath();
    ctx.ellipse(px(0.46), py(0.63), w * 0.21, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 头
    ctx.beginPath();
    ctx.ellipse(px(0.66), py(0.55), w * 0.11, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 长尖喙
    ctx.beginPath();
    ctx.moveTo(px(0.75), py(0.49));
    ctx.lineTo(px(0.99), py(0.56));
    ctx.lineTo(px(0.75), py(0.63));
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px(0.69), py(0.52), Math.max(1.2, w * 0.028), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRunner() {
    const s = runner.size;
    const duck = runner.ducking && !runner.airborne;
    const w = duck ? Math.round(s * 1.16) : s;
    const h = duck ? Math.round(s * 0.64) : s;
    const cx = runner.x;
    const hover = groundY - runner.y;
    const bob = runner.airborne ? 0 : Math.round(Math.sin(state.time * 16) * grid * 0.5);
    const cy = runner.y - h / 2 + bob;

    const shadow = Math.max(0.24, 1 - hover / (150 * k));
    ctx.fillStyle = 'rgba(32, 36, 61, 0.11)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY + grid * 2, s * 0.34 * shadow, grid * 1.3 * shadow, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(runner.tilt);
    ctx.scale(1 + runner.squash * 0.5, 1 - runner.squash * 0.55);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0, (w / 2) * 0.94, (h / 2) * 0.94, 0, 0, Math.PI * 2);
    ctx.fill();

    if (logoReady && logoSprite) {
      ctx.drawImage(logoSprite, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#6547d7';
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < state.clouds.length; i++) drawCloud(state.clouds[i]);
    drawGround();
    for (let i = 0; i < state.obstacles.length; i++) {
      const o = state.obstacles[i];
      if (o.type === 'bird') drawBird(o);
      else drawCactus(o);
    }
    drawRunner();
  }

  // ---------- 主循环 ----------
  let last = 0;
  function loop(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- 输入 ----------
  const inView = () => {
    const r = stage.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 0);
  };

  window.addEventListener('keydown', (e) => {
    if (!inView()) return;
    const code = e.code;
    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW' || code === 'Enter') {
      if (e.repeat) return;
      e.preventDefault();
      jump();
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      e.preventDefault();
      setDuck(true);
    }
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') jumpCut();
    else if (code === 'ArrowDown' || code === 'KeyS') setDuck(false);
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    e.preventDefault();
    jump();
  });

  stage.addEventListener('pointerup', () => jumpCut());
  stage.addEventListener('pointercancel', () => jumpCut());
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('visibilitychange', () => {
    last = 0;
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resize()).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }

  try {
    state.hi = Number(localStorage.getItem(HI_KEY)) || 0;
  } catch (err) {
    state.hi = 0;
  }

  resize();
  reset();
  paintHud();
  requestAnimationFrame(loop);
})();
