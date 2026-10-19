(() => {
  'use strict';

  const DURATION = 60;
  const EMOJI = ['🍉', '🍊', '🍎', '🥝', '🍋', '🍇', '🍓'];
  const SLASH_AUDIO = [
    'assets/mp3/cut-through-the-air.mp3',
    'assets/mp3/slashed-with-a-sword-and-gushing-blood.mp3',
    'assets/mp3/strong-swing-and-cut-in-half.mp3'
  ].map(src => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  });
  const EXPLOSION_AUDIO = new Audio('assets/mp3/explosion.mp3');

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const timeEl = document.getElementById('time');
  const scoreEl = document.getElementById('score');
  const overlay = document.getElementById('overlay');
  const flashEl = document.getElementById('flash');

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

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fruits = [];
    halves = [];
  }

  function spawn() {
    const r = Math.min(W, H) * 0.08;
    const isBomb = timeLeft <= 50 && Math.random() < 0.18;
    const isHigh = !isBomb && Math.random() < 0.1;

    fruits.push({
      x: r + Math.random() * (W - 2 * r),
      y: H + r,
      vx: (Math.random() - 0.5) * W * 0.44,
      vy: -H * (0.9 + Math.random() * 0.7),
      r,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2,
      emoji: isBomb ? '💣' : isHigh ? '💎' : EMOJI[(Math.random() * EMOJI.length) | 0],
      bomb: isBomb,
      points: isBomb ? -9 : isHigh ? 12 : 6
    });
  }

  function move(p, dt) {
    p.vy += H * 1.5 * dt;
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
      const wave = timeLeft <= 25 ? 3 : timeLeft <= 50 ? 2 : 1;
      for (let i = 0; i < wave; i++) spawn();
      spawnIn = 0.45 + Math.random() * 0.25;
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
    const speed = H * (0.35 + Math.random() * 0.15);
    const offset = f.r * 0.1;

    for (const side of [1, -1]) {
      halves.push({
        x: f.x + nx * offset * side,
        y: f.y + ny * offset * side,
        vx: f.vx + nx * speed * side,
        vy: f.vy + ny * speed * side,
        r: f.r,
        rot: f.rot,
        spin: (Math.random() - 0.5) * 4,
        cutLocal: angle - f.rot,
        side,
        emoji: f.emoji
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
          if (now - lastHitAt > 400) slashHits = 0;
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

    ctx.font = `${f.r * 2}px serif`;
    ctx.fillText(f.emoji, 0, 0);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

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
    overlay.classList.add('hidden');
  }

  function end() {
    state = 'over';
    fruits = [];
    halves = [];
    trail = [];
    lastPoint = null;
    overlay.innerHTML = `Time!<small>Score ${score} · tap to play again</small>`;
    overlay.classList.remove('hidden');
  }

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

  window.addEventListener('pointerdown', e => {
    if (state === 'ready') start();
    else if (state === 'over') { location.reload(); return; }
    slashHits = 0;
    lastPoint = localPoint(e);
    trail = [{ ...lastPoint, t: performance.now() }];
  });

  window.addEventListener('pointermove', e => {
    if (state !== 'playing' || !lastPoint) return;
    const p = localPoint(e);
    trail.push({ ...p, t: performance.now() });
    slice(lastPoint.x, lastPoint.y, p.x, p.y);
    lastPoint = p;
  });

  const release = () => { lastPoint = null; };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('resize', resize);

  console.assert(segmentHitsCircle(0, 0, 100, 0, 50, 10, 20), 'segment should hit circle');
  console.assert(!segmentHitsCircle(0, 0, 100, 0, 50, 40, 20), 'segment should miss circle');
  console.assert(Math.abs(Math.atan2(0, 100)) < 1e-9, 'horizontal cut angle should be 0');

  resize();
  requestAnimationFrame(frame);
})();
