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

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const timeEl = document.getElementById('time');
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
  let trail = [];
  let score = 0;
  let slashHits = 0;
  let lastHitAt = 0;
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
    blade = { x: W / 2, y: H / 2 };
  }

  function spawnWave() {
    const r = Math.min(W, H) * CFG.physics.radius;
    const base = timeLeft <= CFG.spawn.wave4At ? 4
      : timeLeft <= CFG.spawn.wave3At ? 3
      : timeLeft <= CFG.spawn.wave2At ? 2 : 1;
    const count = base + (Math.random() < 0.5 ? 0 : 1);
    const vx = (Math.random() - 0.5) * W * CFG.physics.drift;
    const vy = -H * (CFG.physics.launchMin + Math.random() * CFG.physics.launchRandom);
    const spacing = r * 2.4;
    const usable = W - 2 * r;
    const groupWidth = Math.min(usable, (count - 1) * spacing);
    const startX = r + Math.random() * Math.max(0, usable - groupWidth);
    const step = count > 1 ? groupWidth / (count - 1) : 0;

    for (let i = 0; i < count; i++) {
      const isBomb = timeLeft <= CFG.spawn.bombAfterSeconds && Math.random() < CFG.spawn.bombChance;
      const isHigh = !isBomb && Math.random() < CFG.spawn.highChance;

      fruits.push({
        x: startX + step * i,
        y: H + r,
        vx,
        vy,
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
    return p.y - p.r > H * 1.2 || p.x < -2 * p.r || p.x > W + 2 * p.r;
  }

  function update(dt) {
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnWave();
      spawnIn = CFG.spawn.intervalMin + Math.random() * (CFG.spawn.intervalMax - CFG.spawn.intervalMin);
    }

    for (const f of fruits) move(f, dt);
    for (const h of halves) move(h, dt);

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

  function slice(x0, y0, x1, y1) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const now = performance.now();
    const remaining = [];
    let hitBomb = false;

    for (const f of fruits) {
      if (segmentHitsCircle(x0, y0, x1, y1, f.x, f.y, f.r * 1.1)) {
        if (f.bomb) {
          score += f.points;
          hitBomb = true;
          flashScreen();
          playSound(EXPLOSION_AUDIO);
        } else {
          if (now - lastHitAt > CFG.combo.windowMs) slashHits = 0;
          slashHits++;
          lastHitAt = now;
          score += f.points * slashHits;
          split(f, angle);
          playSound(SLASH_AUDIO[(Math.random() * SLASH_AUDIO.length) | 0]);
        }
      } else {
        remaining.push(f);
      }
    }

    if (hitBomb) slashHits = 0;
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

    for (const f of fruits) drawFruit(f, false);
    for (const h of halves) drawFruit(h, true);

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
  }

  function start() {
    state = 'playing';
    score = 0;
    slashHits = 0;
    timeLeft = DURATION;
    fruits = [];
    halves = [];
    trail = [];
    spawnIn = 0;
    lastPoint = null;
    blade = { x: W / 2, y: H / 2 };
    bladeJump = true;
    bladeVisible = true;
    overlay.classList.add('hidden');
    if (SWORD) canvas.requestPointerLock()?.catch?.(() => {});
  }

  function end() {
    state = 'over';
    fruits = [];
    halves = [];
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
    slashHits = 0;
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
