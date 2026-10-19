(() => {
  'use strict';

  const DURATION = 60;
  const EMOJI = ['🍉', '🍊', '🍎', '🥝', '🍋', '🍇', '🍓'];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const timeEl = document.getElementById('time');
  const scoreEl = document.getElementById('score');
  const overlay = document.getElementById('overlay');

  let W = 0, H = 0;
  let fruits = [];
  let trail = [];
  let score = 0;
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
  }

  function spawn() {
    const r = Math.min(W, H) * 0.07;
    fruits.push({
      x: r + Math.random() * (W - 2 * r),
      y: H + r,
      vx: (Math.random() - 0.5) * W * 0.44,
      vy: -H * (1.2 + Math.random() * 0.15),
      r,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2,
      emoji: EMOJI[(Math.random() * EMOJI.length) | 0]
    });
  }

  function update(dt) {
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawn();
      spawnIn = 0.45 + Math.random() * 0.25;
    }

    const gravity = H * 1.5;
    for (const f of fruits) {
      f.vy += gravity * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
    }

    fruits = fruits.filter(f =>
      f.y - f.r <= H * 1.2 && f.x > -2 * f.r && f.x < W + 2 * f.r
    );
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

  function slice(x0, y0, x1, y1) {
    const before = fruits.length;
    fruits = fruits.filter(f => !segmentHitsCircle(x0, y0, x1, y1, f.x, f.y, f.r * 1.1));
    score += before - fruits.length;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of fruits) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.font = `${f.r * 2}px serif`;
      ctx.fillText(f.emoji, 0, 0);
      ctx.restore();
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
  }

  function start() {
    state = 'playing';
    score = 0;
    timeLeft = DURATION;
    fruits = [];
    trail = [];
    spawnIn = 0;
    lastPoint = null;
    overlay.classList.add('hidden');
  }

  function end() {
    state = 'over';
    fruits = [];
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

  window.addEventListener('pointerdown', e => {
    if (state === 'ready') start();
    else if (state === 'over') { location.reload(); return; }
    lastPoint = { x: e.clientX, y: e.clientY };
    trail = [{ ...lastPoint, t: performance.now() }];
  });

  window.addEventListener('pointermove', e => {
    if (state !== 'playing' || !lastPoint) return;
    const p = { x: e.clientX, y: e.clientY };
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

  resize();
  requestAnimationFrame(frame);
})();
