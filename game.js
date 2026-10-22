import { CONFIG } from './config.js';

(() => {
  'use strict';

  const CFG = CONFIG;
  const DURATION = CFG.duration;
  const params = new URLSearchParams(location.search);
  const SWORD = params.has('sword');
  const SWORD_SENS = Math.max(0.1, Math.min(2, Number(params.get('sens')) || CFG.sword.sensitivity));
  const SWAP_AXES = params.has('swap');
  const sprites = {};

  for (const [kind, src] of Object.entries(CFG.assets.sprites)) {
    const img = new Image();
    img.onload = () => {
      const scale = CFG.assets.spriteMaxSize / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      sprites[kind] = canvas;
    };
    img.src = src;
  }

  const SLASH_AUDIO = CFG.assets.slashAudio.map(src => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  });
  const EXPLOSION_AUDIO = new Audio(CFG.assets.explosionAudio);
  const JUICE_COLORS = {
    fruit: ['#ff9a2e', '#ffbf5a', '#e06b16', '#a33d12'],
    high: ['#ffd36b', '#ff9a2e', '#ff6b2e', '#c94c14'],
    bomb: ['#ffefd6', '#c9c4d6', '#ff4b3a', '#7a1f1f']
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const timeEl = document.getElementById('time');
  const comboMeter = document.getElementById('combo-meter');
  const comboFill = document.getElementById('combo-fill');
  const comboLabel = document.getElementById('combo-label');
  const scoreEl = document.getElementById('score');
  const overlay = document.getElementById('overlay');
  const flashEl = document.getElementById('flash');
  const board = document.getElementById('board');
  const boardScores = document.getElementById('scores');
  const finalScoreEl = document.getElementById('final-score');
  const scoreForm = document.getElementById('score-form');
  const submitScoreBtn = document.getElementById('submit-score');
  const nameInput = document.getElementById('player-name');
  const boardStatus = document.getElementById('board-status');
  const youRow = document.getElementById('you');
  const youRank = document.getElementById('you-rank');
  const youScore = document.getElementById('you-score');
  const playAgainBtn = document.getElementById('play-again');

  nameInput.value = localStorage.getItem('fruit-name') || '';

  let firebaseApi;
  function loadFirebase() {
    firebaseApi ??= import('./firebase.js');
    return firebaseApi;
  }

  if (SWORD) {
    document.body.classList.add('sword');
    overlay.querySelector('small').textContent = 'Move to slice · click to recenter';
  }

  let W = 0, H = 0;
  let fruits = [];
  let halves = [];
  let particles = [];
  let popups = [];
  let cutFlashes = [];
  let shake = 0;
  let trail = [];
  let score = 0;
  let comboProgress = 0;
  let comboTimer = 0;
  let timeLeft = DURATION;
  let state = 'ready';
  let spawnIn = 0;
  let lastFrame = 0;
  let lastPoint = null;
  let blade = { x: 0, y: 0 };
  let bladeJump = true;
  let bladeVisible = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fruits = [];
    halves = [];
    particles = [];
    popups = [];
    cutFlashes = [];
    shake = 0;
    blade = { x: W / 2, y: H / 2 };
  }

  function spawnWave() {
    const r = Math.min(W, H) * CFG.physics.radius;
    const base = timeLeft <= CFG.spawn.wave4At ? 4
      : timeLeft <= CFG.spawn.wave3At ? 3
      : timeLeft <= CFG.spawn.wave2At ? 2 : 1;
    const count = base + (Math.random() < 0.5 ? 0 : 1);
    const spacing = r * 2.4;
    const usable = W - 2 * r;
    const groupWidth = Math.min(usable, (count - 1) * spacing);
    const startX = r + Math.random() * Math.max(0, usable - groupWidth);
    const step = count > 1 ? groupWidth / (count - 1) : 0;

    for (let i = 0; i < count; i++) {
      const isBomb = timeLeft <= CFG.spawn.bombAfterSeconds && Math.random() < CFG.spawn.bombChance;
      const isHigh = !isBomb && Math.random() < CFG.spawn.highChance;
      const depth = r + Math.random() * H * 0.35;
      const apex = H * (CFG.physics.apexMin + Math.random() * CFG.physics.apexRange);
      const x = Math.max(r, Math.min(W - r, startX + step * i + (Math.random() - 0.5) * spacing * 0.9));
      const y = H + depth;

      fruits.push({
        x,
        y,
        vx: (Math.random() - 0.5) * W * CFG.physics.drift,
        vy: -Math.sqrt(2 * H * CFG.physics.gravity * (apex + depth)),
        r,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * CFG.physics.spin,
        sprite: isBomb ? 'bomb' : isHigh ? 'high' : 'fruit',
        bomb: isBomb,
        points: isBomb ? CFG.points.bomb : isHigh ? CFG.points.high : CFG.points.fruit
      });
    }
  }

  function move(p, dt) {
    p.vy += H * CFG.physics.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }

  function offscreen(p) {
    return p.y - p.r > H * 1.5 || p.x < -2 * p.r || p.x > W + 2 * p.r;
  }

  function comboMultiplier() {
    return Math.min(CFG.combo.max, 1 + Math.floor(comboProgress / CFG.combo.slicesPerTier));
  }

  function update(dt) {
    if (comboProgress > 0) {
      if (comboTimer > 0) {
        comboTimer -= dt * 1000;
      } else {
        const drain = dt * 1000 * (CFG.combo.slicesPerTier / CFG.combo.decayMs);
        comboProgress = Math.max(0, comboProgress - drain);
      }
    } else {
      comboTimer = 0;
    }

    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnWave();
      spawnIn = CFG.spawn.intervalMin + Math.random() * (CFG.spawn.intervalMax - CFG.spawn.intervalMin);
    }

    for (const f of fruits) move(f, dt);
    for (const h of halves) move(h, dt);

    shake = Math.max(0, shake - dt);

    for (const p of particles) {
      p.vy += H * CFG.physics.gravity * 0.7 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    for (const p of popups) {
      p.y -= H * 0.12 * dt;
      p.life -= dt;
    }
    popups = popups.filter(p => p.life > 0);

    for (const c of cutFlashes) c.life -= dt;
    cutFlashes = cutFlashes.filter(c => c.life > 0);

    fruits = fruits.filter(f => !offscreen(f));
    halves = halves.filter(h => !offscreen(h));
  }

  function segmentHitsCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((cx - x0) * dx + (cy - y0) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + t * dx - cx;
    const py = y0 + t * dy - cy;
    return px * px + py * py <= r * r;
  }

  function split(f, angle) {
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const speed = H * (CFG.physics.separationSpeed + Math.random() * CFG.physics.separationRandom);
    const offset = f.r * 0.1;

    for (const side of [1, -1]) {
      halves.push({
        x: f.x + nx * offset * side,
        y: f.y + ny * offset * side,
        vx: f.vx + nx * speed * side,
        vy: f.vy + ny * speed * side,
        r: f.r,
        rot: f.rot,
        spin: (Math.random() - 0.5) * CFG.physics.separationSpin,
        cutLocal: angle - f.rot,
        side,
        sprite: f.sprite
      });
    }
  }

  function playSound(track) {
    try {
      const playing = track.cloneNode().play();
      if (playing) playing.catch(() => {});
    } catch {}
  }

  function flashScreen() {
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('on');
  }

  function burst(f, kind) {
    const colors = JUICE_COLORS[kind];
    const bomb = kind === 'bomb';
    const count = bomb ? CFG.feedback.bombParticles : CFG.feedback.juiceParticles;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = H * (bomb ? 0.45 + Math.random() * 0.75 : 0.18 + Math.random() * 0.5);
      const life = CFG.feedback.particleLife * (0.6 + Math.random() * 0.6);

      particles.push({
        x: f.x + (Math.random() - 0.5) * f.r,
        y: f.y + (Math.random() - 0.5) * f.r,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - H * 0.08,
        radius: f.r * (bomb ? 0.1 + Math.random() * 0.22 : 0.06 + Math.random() * 0.16),
        color: colors[(Math.random() * colors.length) | 0],
        life,
        maxLife: life
      });
    }
  }

  function addPopup(x, y, text, color) {
    popups.push({
      x,
      y: y - Math.min(W, H) * 0.02,
      text,
      color,
      life: CFG.feedback.popupLife,
      maxLife: CFG.feedback.popupLife
    });
  }

  function addCutFlash(x, y, angle, radius) {
    cutFlashes.push({ x, y, angle, radius, life: 0.18, maxLife: 0.18 });
  }

  function slice(x0, y0, x1, y1) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const remaining = [];
    let hitBomb = false;

    for (const f of fruits) {
      if (segmentHitsCircle(x0, y0, x1, y1, f.x, f.y, f.r * 1.1)) {
        if (f.bomb) {
          score += f.points;
          hitBomb = true;
          shake = CFG.feedback.shakeTime;
          burst(f, 'bomb');
          addPopup(f.x, f.y, `${f.points}`, '#ff6b5a');
          flashScreen();
          playSound(EXPLOSION_AUDIO);
        } else {
          const multiplier = comboMultiplier();
          const gained = f.points * multiplier;
          const maxProgress = (CFG.combo.max - 1) * CFG.combo.slicesPerTier;
          score += gained;
          comboProgress = Math.min(maxProgress, comboProgress + 1);
          comboTimer = CFG.combo.graceMs;
          split(f, angle);
          burst(f, f.sprite);
          addCutFlash(f.x, f.y, angle, f.r);
          addPopup(f.x, f.y, `+${gained}`, f.sprite === 'high' || multiplier > 1 ? '#ffd36b' : '#fff3d6');
          playSound(SLASH_AUDIO[(Math.random() * SLASH_AUDIO.length) | 0]);
        }
      } else {
        remaining.push(f);
      }
    }

    if (hitBomb) {
      comboProgress = Math.max(0, comboProgress - CFG.combo.slicesPerTier * 2);
      comboTimer = CFG.combo.graceMs;
    }
    fruits = remaining;
  }

  function drawFruit(f, isHalf) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);

    if (isHalf) {
      ctx.rotate(f.cutLocal);
      ctx.beginPath();
      ctx.rect(-f.r * 2.5, f.side > 0 ? 0 : -f.r * 2.5, f.r * 5, f.r * 2.5);
      ctx.clip();
      ctx.rotate(-f.cutLocal);
    }

    const sprite = sprites[f.sprite];
    if (sprite) {
      const scale = (f.r * 2) / Math.max(sprite.width, sprite.height);
      const w = sprite.width * scale;
      const h = sprite.height * scale;
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const shakeScale = shake > 0 ? shake / CFG.feedback.shakeTime : 0;
    const shakeAmount = Math.min(W, H) * CFG.feedback.shakeAmount * shakeScale;
    ctx.save();
    if (shakeAmount > 0) {
      ctx.translate(
        (Math.random() * 2 - 1) * shakeAmount,
        (Math.random() * 2 - 1) * shakeAmount
      );
    }

    for (const f of fruits) drawFruit(f, false);
    for (const h of halves) drawFruit(h, true);

    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const c of cutFlashes) {
      const alpha = c.life / c.maxLife;
      const dx = Math.cos(c.angle);
      const dy = Math.sin(c.angle);
      const length = c.radius * 2.2;
      ctx.strokeStyle = `rgba(255, 244, 214, ${alpha})`;
      ctx.lineWidth = Math.max(1.5, c.radius * 0.18);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x - dx * length, c.y - dy * length);
      ctx.lineTo(c.x + dx * length, c.y + dy * length);
      ctx.stroke();
    }

    if (trail.length > 1) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = Math.min(W, H) * 0.012;
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }

    if (SWORD && state === 'playing' && bladeVisible) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(blade.x, blade.y, Math.min(W, H) * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.min(W, H) * 0.05}px system-ui, sans-serif`;
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function start() {
    state = 'playing';
    score = 0;
    comboProgress = 0;
    comboTimer = 0;
    timeLeft = DURATION;
    fruits = [];
    halves = [];
    particles = [];
    popups = [];
    cutFlashes = [];
    shake = 0;
    trail = [];
    spawnIn = CFG.spawn.startDelay;
    lastPoint = null;
    blade = { x: W / 2, y: H / 2 };
    bladeJump = true;
    bladeVisible = true;
    overlay.classList.add('hidden');
    if (SWORD) canvas.requestPointerLock()?.catch?.(() => {});
  }

  function end() {
    state = 'over';
    comboProgress = 0;
    comboTimer = 0;
    fruits = [];
    halves = [];
    particles = [];
    popups = [];
    cutFlashes = [];
    shake = 0;
    trail = [];
    lastPoint = null;
    if (document.pointerLockElement) document.exitPointerLock();
    showBoard();
  }

  async function renderScores() {
    boardScores.innerHTML = '';

    try {
      const { getTopScores } = await loadFirebase();
      const scores = await getTopScores();

      if (!scores.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'No scores yet';
        boardScores.append(empty);
        return;
      }

      scores.forEach((entry, index) => {
        const li = document.createElement('li');
        const rank = document.createElement('span');
        const who = document.createElement('span');
        const points = document.createElement('span');
        rank.textContent = `${index + 1}.`;
        who.textContent = entry.name;
        points.textContent = entry.score;
        li.append(rank, who, points);
        boardScores.append(li);
      });
    } catch {
      boardStatus.textContent = 'Leaderboard unavailable.';
    }
  }

  function showBoard() {
    overlay.classList.add('hidden');
    finalScoreEl.textContent = score;
    boardStatus.textContent = '';
    submitScoreBtn.disabled = false;
    youScore.textContent = score;
    youRank.textContent = '-';
    youRow.classList.remove('hidden');
    board.classList.remove('hidden');
    renderScores();
  }

  scoreForm.addEventListener('submit', async event => {
    event.preventDefault();

    const name = nameInput.value.trim().slice(0, 16) || 'Player';
    nameInput.value = name;
    localStorage.setItem('fruit-name', name);
    submitScoreBtn.disabled = true;
    boardStatus.textContent = 'Saving...';

    try {
      const { submitScore } = await loadFirebase();
      const result = await submitScore(name, score);
      youScore.textContent = result.best;
      youRank.textContent = result.rank ? `#${result.rank}` : '-';
      boardStatus.textContent = result.saved ? 'Saved.' : `Best so far: ${result.best}.`;
      renderScores();
    } catch {
      boardStatus.textContent = 'Could not save.';
      submitScoreBtn.disabled = false;
    }
  });

  playAgainBtn.addEventListener('click', () => location.reload());

  function frame(now) {
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;

    if (state === 'playing') {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        end();
      } else {
        update(dt);
      }
    }

    timeEl.textContent = Math.ceil(timeLeft);
    const maxProgress = (CFG.combo.max - 1) * CFG.combo.slicesPerTier;
    const tier = comboMultiplier();
    comboFill.style.transform = `scaleX(${comboProgress / maxProgress})`;
    comboLabel.textContent = `x${tier}`;
    comboMeter.classList.toggle('maxed', tier === CFG.combo.max);
    scoreEl.textContent = score;
    trail = trail.filter(p => now - p.t < 120);
    draw();
    requestAnimationFrame(frame);
  }

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function limitStep(x, y) {
    const max = Math.min(W, H) * CFG.sword.maxStep;
    const dist = Math.hypot(x, y);
    return dist > max ? { x: (x / dist) * max, y: (y / dist) * max } : { x, y };
  }

  window.addEventListener('pointerdown', e => {
    if (SWORD && document.pointerLockElement === canvas) {
      blade = { x: W / 2, y: H / 2 };
      trail = [];
      bladeVisible = true;
      return;
    }
    if (SWORD && state === 'playing') canvas.requestPointerLock()?.catch?.(() => {});
    if (state === 'ready') start();
    else if (state === 'over') return;
    lastPoint = localPoint(e);
    trail = [{ ...lastPoint, t: performance.now() }];
    if (!SWORD) canvas.setPointerCapture?.(e.pointerId);
  });

  window.addEventListener('pointermove', e => {
    if (state !== 'playing') return;

    if (SWORD) {
      if (document.pointerLockElement === canvas) {
        const rawX = (SWAP_AXES ? e.movementY : e.movementX) * SWORD_SENS;
        const rawY = (SWAP_AXES ? e.movementX : e.movementY) * SWORD_SENS;
        const step = limitStep(rawX, rawY);
        const x = blade.x + step.x;
        const y = blade.y + step.y;
        const inside = x >= 0 && x <= W && y >= 0 && y <= H;

        if (inside) {
          trail.push({ x, y, t: performance.now() });
          slice(blade.x, blade.y, x, y);
          bladeVisible = true;
        } else {
          trail = [];
          bladeVisible = false;
        }

        blade = { x, y };
      } else {
        const p = localPoint(e);
        if (bladeJump) {
          blade = p;
          bladeJump = false;
          bladeVisible = true;
          return;
        }
        const step = limitStep(p.x - blade.x, p.y - blade.y);
        const x = blade.x + step.x;
        const y = blade.y + step.y;
        trail.push({ x, y, t: performance.now() });
        slice(blade.x, blade.y, x, y);
        blade = { x, y };
        bladeVisible = true;
      }
      return;
    }

    if (!lastPoint) return;
    const p = localPoint(e);
    trail.push({ ...p, t: performance.now() });
    slice(lastPoint.x, lastPoint.y, p.x, p.y);
    lastPoint = p;
  });

  const release = () => { lastPoint = null; };
  const loseFocus = () => {
    lastPoint = null;
    bladeJump = true;
    bladeVisible = false;
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', loseFocus);
  document.addEventListener('mouseleave', loseFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loseFocus();
  });
  window.addEventListener('resize', resize);
  document.addEventListener('pointerlockchange', () => {
    lastPoint = null;
    trail = [];
    bladeJump = true;
    bladeVisible = true;
  });

  console.assert(segmentHitsCircle(0, 0, 100, 0, 50, 10, 20), 'segment should hit circle');
  console.assert(!segmentHitsCircle(0, 0, 100, 0, 50, 40, 20), 'segment should miss circle');
  console.assert(Math.abs(Math.atan2(0, 100)) < 1e-9, 'horizontal cut angle should be 0');

  resize();
  requestAnimationFrame(frame);
})();
