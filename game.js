import { CONFIG } from './config.js';

(() => {
  'use strict';

  const CFG = CONFIG;
  const DURATION = CFG.duration;
  const params = new URLSearchParams(location.search);
  const SWORD = params.has('sword');
  const SWORD_SENS = Math.max(0.1, Math.min(2, Number(params.get('sens')) || CFG.sword.sensitivity));
  const SWAP_AXES = params.has('swap');
  const KIOSK2 = params.has('kiosk2');
  const KIOSK = params.has('kiosk') || KIOSK2;
  const sprites = {};

  const TIERS = [
    { key: 'common', label: 'COMMON', color: '#ffffff', rgb: '255,255,255' },
    { key: 'rare', label: 'RARE', color: '#4ade80', rgb: '74,222,128' },
    { key: 'epic', label: 'EPIC', color: '#c084fc', rgb: '192,132,252' },
    { key: 'unique', label: 'UNIQUE', color: '#ffd400', rgb: '255,212,0' }
  ];
  const COMBO_COLORS = ['#ffffff', '#4ade80', '#c084fc', '#ff8a1f', '#ffd400'];
  const COMBO_NOTES = [0, 0, 523.25, 659.25, 783.99, 1046.5]; // ponytail: C5 E5 G5 C6, triangle chime per tier
  const NO_PRIZE = { key: 'none', label: 'NO PRIZE', color: '#9aa0a6', rgb: '154,160,166' };

  const kiosk = KIOSK2
    ? { threshold: CFG.kiosk2.threshold, weights: { ...CFG.kiosk2.weights } }
    : { threshold: CFG.kiosk.threshold, weights: { ...CFG.kiosk.weights } };

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
  const SCREAM_AUDIO = new Audio(CFG.assets.screamAudio);
  let lastScreamAt = 0; // ponytail: 150ms gate so a multi-skeleton swipe is one shriek
  const JUICE_COLORS = {
    fruit: ['#ff9a2e', '#ffbf5a', '#e06b16', '#a33d12'],
    high: ['#ffd36b', '#ff9a2e', '#ff6b2e', '#c94c14'],
    bomb: ['#ffefd6', '#c9c4d6', '#ff4b3a', '#7a1f1f'],
    common: ['#ffffff', '#e8e8ff', '#c9c9d6', '#a8a8b8'],
    rare: ['#d9ffe6', '#4ade80', '#22c55e', '#15803d'],
    epic: ['#f5e6ff', '#c084fc', '#a855f7', '#7e22ce'],
    unique: ['#fffbe0', '#ffd400', '#facc15', '#eab308'],
    none: ['#e6e8ea', '#9aa0a6', '#6b7075', '#4a4e52']
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
  const shareBtn = document.getElementById('share-score');
  const playAgainBtn = document.getElementById('play-again');

  let shareFile = null;

  nameInput.value = localStorage.getItem('fruit-name') || '';

  let firebaseApi;
  function loadFirebase() {
    firebaseApi ??= import('./firebase.js');
    return firebaseApi;
  }

  if (SWORD) {
    document.body.classList.add('sword');
    overlay.querySelector('small').insertAdjacentHTML('afterbegin', 'Move to slice · click to recenter<br>');
  }

  let W = 0, H = 0, S = 0;
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
  let comboVisualTier = 0;
  let timeLeft = DURATION;
  let state = 'ready';
  let spawnIn = 0;
  let lastFrame = 0;
  const pointers = new Map();
  const startTrack = new Map();
  let blade = { x: 0, y: 0 };
  let bladeJump = true;
  let bladeVisible = true;
  let chest = null;
  let revealedAt = 0;
  let kioskTarget = null;

  if (KIOSK) {
    kioskTarget = document.createElement('span');
    kioskTarget.id = 'kiosk-target';
    overlay.querySelector('.start-title').after(kioskTarget);
    updateKioskTarget();
    if (!KIOSK2) {
      loadFirebase()
        .then(({ watchKioskSettings }) => watchKioskSettings(applyKioskSettings))
        .catch(() => {});
    }
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function updateKioskTarget() {
    if (kioskTarget) kioskTarget.textContent = `Score ${kiosk.threshold.toLocaleString()} to win a prize`;
  }

  function applyKioskSettings(data) {
    if (!data) return;
    const threshold = Number(data.threshold);
    if (Number.isFinite(threshold) && threshold >= 0) kiosk.threshold = Math.round(threshold);
    const weights = data.weights && typeof data.weights === 'object' ? data.weights : data;
    for (const tier of TIERS) kiosk.weights[tier.key] = positive(weights[tier.key]);
    updateKioskTarget();
  }

  function pickTier() {
    const options = TIERS
      .map(tier => [tier, positive(kiosk.weights[tier.key])])
      .filter(([, weight]) => weight > 0);
    const total = options.reduce((sum, [, weight]) => sum + weight, 0);
    if (!total) return null;
    let roll = Math.random() * total;
    for (const [tier, weight] of options) {
      if ((roll -= weight) < 0) return tier;
    }
    return options[options.length - 1][0];
  }

  function chestTarget() {
    return { x: W / 2, y: H * 0.52, r: S * 0.17 };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    S = Math.min(W, H);
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
    const r = S * CFG.physics.radius;
    const bombR = S * CFG.physics.bombRadius;
    const base = timeLeft <= CFG.spawn.wave4At ? 4
      : timeLeft <= CFG.spawn.wave3At ? 3
      : timeLeft <= CFG.spawn.wave2At ? 2 : 1;
    const count = base + (Math.random() < 0.5 ? 0 : 1);
    const spacing = r * 2.4;
    const usable = W - 2 * r;
    const groupWidth = Math.min(usable, (count - 1) * spacing);
    const startX = r + Math.random() * Math.max(0, usable - groupWidth);
    const step = count > 1 ? groupWidth / (count - 1) : 0;

    let bombs = 0;
    for (let i = 0; i < count; i++) {
      const isBomb = bombs < CFG.spawn.bombMaxPerWave && timeLeft <= CFG.spawn.bombAfterSeconds && Math.random() < CFG.spawn.bombChance;
      if (isBomb) bombs++;
      const isHigh = !isBomb && Math.random() < CFG.spawn.highChance;
      const objR = isBomb ? bombR : r;
      const depth = objR + Math.random() * H * 0.35;
      const apex = H * (CFG.physics.apexMin + Math.random() * CFG.physics.apexRange);
      const x = Math.max(r, Math.min(W - r, startX + step * i + (Math.random() - 0.5) * spacing * 0.9));
      const y = H + depth;

      fruits.push({
        x,
        y,
        vx: (Math.random() - 0.5) * S * CFG.physics.drift,
        vy: -Math.sqrt(2 * H * CFG.physics.gravity * (apex + depth)),
        r: objR,
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

  function scoreMultiplier() {
    const tier = comboMultiplier();
    return tier === CFG.combo.max ? CFG.combo.maxScore : tier;
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

  let audioCtx = null;

  function unlockAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playComboChime(tier) {
    const freq = COMBO_NOTES[tier];
    if (!audioCtx || !freq) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
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
          const screamAt = performance.now();
          if (screamAt - lastScreamAt > 150) {
            lastScreamAt = screamAt;
            playSound(SCREAM_AUDIO);
          }
        } else {
          const multiplier = scoreMultiplier();
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
      comboProgress = Math.max(0, comboProgress - CFG.combo.slicesPerTier);
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

  function drawChest() {
    const target = chestTarget();
    const tier = chest.tier;
    const hidden = tier.key !== 'none' && state === 'chest';
    const shown = hidden ? { color: '#cfe3f2', rgb: '207,227,242' } : tier;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);

    const glow = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, target.r * 2.4);
    glow.addColorStop(0, `rgba(${shown.rgb}, ${0.28 + 0.22 * pulse})`);
    glow.addColorStop(0.45, `rgba(${shown.rgb}, ${0.12 + 0.1 * pulse})`);
    glow.addColorStop(1, `rgba(${shown.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.shadowColor = shown.color;
    ctx.shadowBlur = target.r * (0.5 + 0.6 * pulse);
    drawSprite(ctx, sprites.treasure, target.x, target.y, target.r * 2, 0, 1);
    ctx.restore();

    if (tier.key === 'none' && state === 'chest') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(214, 218, 222, .92)';
      ctx.font = `700 ${S * 0.045}px system-ui, sans-serif`;
      ctx.fillText('BELOW THRESHOLD', target.x, target.y + target.r * 1.35);
      ctx.fillStyle = 'rgba(180, 186, 192, .9)';
      ctx.font = `600 ${S * 0.038}px system-ui, sans-serif`;
      ctx.fillText(`SCORE ${score} / ${kiosk.threshold}`, target.x, target.y + target.r * 1.35 + S * 0.06);
    }
  }

  function drawReveal() {
    const tier = chest.tier;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, .6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = tier.color;
    ctx.shadowBlur = S * 0.08;
    ctx.fillStyle = tier.color;
    ctx.font = `900 ${S * 0.13}px system-ui, sans-serif`;
    ctx.fillText(tier.label, W / 2, H * 0.44);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${S * 0.055}px system-ui, sans-serif`;
    ctx.fillText(
      tier.key === 'none' ? `SCORE ${score} / ${kiosk.threshold}` : 'PRIZE',
      W / 2,
      H * 0.57
    );
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

    if (chest && (state === 'chest' || state === 'reveal')) drawChest();

    const combo = comboMultiplier();
    const boost = (combo - 1) / (CFG.combo.max - 1);
    const trails = SWORD
      ? [{ trail, hue: null }]
      : [...pointers.values()].map(p => ({ trail: p.trail, hue: p.hue }));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.min(W, H) * (0.0144 + 0.010 * boost);
    ctx.shadowColor = COMBO_COLORS[combo - 1];
    ctx.shadowBlur = Math.min(W, H) * 0.03 * boost;
    for (const { trail: points, hue } of trails) {
      if (points.length < 2) continue;
      ctx.strokeStyle = hue == null
        ? (boost > 0 ? COMBO_COLORS[combo - 1] : 'rgba(255, 255, 255, 0.7)')
        : `hsla(${hue}, 95%, ${68 + boost * 10}%, 0.85)`;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    if (SWORD && state === 'playing' && bladeVisible) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(blade.x, blade.y, Math.min(W, H) * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.min(W, H) * 0.06}px system-ui, sans-serif`;
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    if (state === 'reveal' && chest) drawReveal();

    if (state === 'playing' && timeLeft <= 10) {
      const urgency = 1 - timeLeft / 10;
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 140);
      const alpha = (0.06 + 0.2 * urgency) * pulse;
      const glow = ctx.createRadialGradient(W / 2, H / 2, S * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
      glow.addColorStop(0, 'rgba(255, 40, 30, 0)');
      glow.addColorStop(1, `rgba(255, 40, 30, ${alpha})`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function start() {
    unlockAudio();
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
    chest = null;
    revealedAt = 0;
    spawnIn = CFG.spawn.startDelay;
    pointers.clear();
    startTrack.clear();
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
    pointers.clear();
    if (document.pointerLockElement) document.exitPointerLock();

    if (KIOSK) {
      if (!KIOSK2) loadFirebase().then(({ logGame }) => logGame(score)).catch(err => console.error('[logGame]', err));
      const tier = score >= kiosk.threshold ? pickTier() : null;
      beginChest(tier || NO_PRIZE);
      return;
    }

    showBoard();
  }

  function beginChest(tier) {
    state = 'chest';
    chest = { tier };
    revealedAt = 0;
    trail = [];
    pointers.clear();
    startTrack.clear();
  }

  function sliceChest() {
    if (state !== 'chest' || !chest) return;
    const target = chestTarget();
    state = 'reveal';
    revealedAt = performance.now();
    burst({ x: target.x, y: target.y, r: target.r }, chest.tier.key);
    addCutFlash(target.x, target.y, Math.random() * Math.PI, target.r);
    if (chest.tier.key !== 'none') flashScreen();
    playSound(SLASH_AUDIO[(Math.random() * SLASH_AUDIO.length) | 0]);
    trail = [];
    pointers.clear();
  }

  function resetToReady() {
    state = 'ready';
    chest = null;
    revealedAt = 0;
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
    pointers.clear();
    startTrack.clear();
    board.classList.add('hidden');
    overlay.classList.remove('hidden');
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

    try {
      shareFile = makeShareFile(score);
    } catch {
      shareFile = null;
    }

    board.classList.remove('hidden');
    renderScores();
  }

  function drawSprite(g, sprite, x, y, size, rotation, alpha) {
    if (!sprite) return;
    const scale = size / Math.max(sprite.width, sprite.height);
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rotation);
    g.drawImage(
      sprite,
      -sprite.width * scale / 2,
      -sprite.height * scale / 2,
      sprite.width * scale,
      sprite.height * scale
    );
    g.restore();
  }

  function drawScoreCard(value) {
    const size = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');

    const bg = g.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#160b0d');
    bg.addColorStop(.55, '#2b1510');
    bg.addColorStop(1, '#080508');
    g.fillStyle = bg;
    g.fillRect(0, 0, size, size);

    const glow = g.createRadialGradient(size / 2, 520, 80, size / 2, 520, 650);
    glow.addColorStop(0, 'rgba(255, 150, 70, .26)');
    glow.addColorStop(.55, 'rgba(120, 30, 25, .2)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);

    const vignette = g.createRadialGradient(size / 2, size / 2, 260, size / 2, size / 2, 720);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, .78)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, size, size);

    g.strokeStyle = 'rgba(255, 179, 92, .25)';
    g.lineWidth = 3;
    g.strokeRect(38, 38, size - 76, size - 76);

    drawSprite(g, sprites.fruit, 122, 970, 150, -0.22, .95);
    drawSprite(g, sprites.high, 958, 980, 120, 0.18, .9);

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.fillStyle = '#ffb35c';
    g.font = '700 34px system-ui, sans-serif';
    g.fillText('PIONEER SPOOKY NIGHT', size / 2, 140);

    g.save();
    g.shadowColor = 'rgba(255, 120, 50, .55)';
    g.shadowBlur = 32;
    g.fillStyle = '#fff3e0';
    g.font = '800 82px Georgia, serif';
    g.fillText('OLD SCHOOL', size / 2, 250);
    g.fillText('PUMPKIN SLASHER', size / 2, 340);
    g.restore();

    g.strokeStyle = 'rgba(255, 179, 92, .4)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(size / 2 - 120, 405);
    g.lineTo(size / 2 + 120, 405);
    g.stroke();

    g.fillStyle = '#ffb35c';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText('SCORE', size / 2, 475);

    const scoreText = String(value);
    const scoreSize = scoreText.length > 4 ? 150 : scoreText.length === 4 ? 190 : 230;
    g.save();
    g.shadowColor = 'rgba(255, 100, 40, .55)';
    g.shadowBlur = 36;
    g.fillStyle = '#fff';
    g.font = `900 ${scoreSize}px system-ui, sans-serif`;
    g.fillText(scoreText, size / 2, 620);
    g.restore();

    g.fillStyle = 'rgba(255, 255, 255, .68)';
    g.font = '600 28px system-ui, sans-serif';
    g.fillText('OLD SCHOOL HORRORS', size / 2, 745);

    g.fillStyle = '#ffb35c';
    g.font = '600 26px system-ui, sans-serif';
    g.fillText('#PioneerYOUth  #PioneerTogether', size / 2, 855);
    g.fillText('#PioneerSpookyNight  #oldschoolhorrors', size / 2, 898);

    return canvas;
  }

  function makeShareFile(value) {
    const canvas = drawScoreCard(value);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], 'pioneer-pumpkin-slasher.png', { type: 'image/png' });
  }

  function shareCaption(value) {
    return `I got a score of ${value} at the Old School Pumpkin Slasher booth — Pioneer Spooky Night!\n#PioneerYOUth #PioneerTogether #PioneerSpookyNight #oldschoolhorrors`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  async function downloadShareImage(file, caption) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pioneer-pumpkin-slasher.png';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    const copied = await copyText(caption);
    boardStatus.textContent = copied
      ? 'Image downloaded. Caption copied — post it to Facebook.'
      : caption;
  }

  shareBtn.addEventListener('click', async () => {
    if (!shareFile) {
      boardStatus.textContent = 'Share image unavailable.';
      return;
    }

    const caption = shareCaption(score);
    shareBtn.disabled = true;
    boardStatus.textContent = '';

    try {
      if (navigator.share && navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          text: caption,
          title: 'Pioneer Spooky Night'
        });
      } else {
        await downloadShareImage(shareFile, caption);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        await downloadShareImage(shareFile, caption);
      }
    } finally {
      shareBtn.disabled = false;
    }
  });

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

  playAgainBtn.addEventListener('click', resetToReady);

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
    timeEl.classList.toggle('urgent', state === 'playing' && timeLeft <= 10);
    const tier = comboMultiplier();
    const fill = tier === CFG.combo.max
      ? 1
      : (comboProgress % CFG.combo.slicesPerTier) / CFG.combo.slicesPerTier;
    comboFill.style.transform = `scaleX(${fill})`;
    comboLabel.textContent = `x${tier === CFG.combo.max ? CFG.combo.maxScore : tier}`;
    comboMeter.classList.toggle('maxed', tier === CFG.combo.max);
    if (tier !== comboVisualTier) {
      const up = tier > comboVisualTier && comboVisualTier > 0;
      comboVisualTier = tier;
      comboMeter.style.setProperty('--tier', COMBO_COLORS[tier - 1]);
      comboMeter.style.setProperty('--tier-prev', tier > 1 ? COMBO_COLORS[tier - 2] : '#ffffff1a');
      if (up) {
        comboLabel.classList.remove('pop');
        void comboLabel.offsetWidth;
        comboLabel.classList.add('pop');
        playComboChime(tier);
      }
    }
    scoreEl.textContent = score;
    const trailLife = 120 + (tier - 1) * 35;
    trail = trail.filter(p => now - p.t < trailLife);
    for (const ptr of pointers.values()) ptr.trail = ptr.trail.filter(p => now - p.t < trailLife);
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

  function enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const result = req?.call(el);
      if (result?.catch) result.catch(() => {});
    } catch {}
  }

  function startTarget() {
    const el = document.getElementById('start-pumpkin');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const c = canvas.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - c.left,
      y: r.top + r.height / 2 - c.top,
      r: Math.max(r.width, r.height) * 0.5
    };
  }

  function beginFromPoint(e, x, y, angle) {
    const target = startTarget();
    start();
    if (target) {
      const f = { x: target.x, y: target.y, vx: 0, vy: -S * 0.15, r: target.r, rot: 0, spin: 0, sprite: 'fruit' };
      split(f, angle);
      burst(f, 'fruit');
      addCutFlash(f.x, f.y, angle, f.r);
      playSound(SLASH_AUDIO[(Math.random() * SLASH_AUDIO.length) | 0]);
    }
    pointers.set(e.pointerId, {
      x,
      y,
      hue: (e.pointerId * 67) % 360,
      trail: [{ x, y, t: performance.now() }]
    });
  }

  window.addEventListener('pointerdown', e => {
    if (SWORD && document.pointerLockElement === canvas) {
      blade = { x: W / 2, y: H / 2 };
      trail = [];
      bladeVisible = true;
      return;
    }
    if (SWORD && state === 'playing') canvas.requestPointerLock()?.catch?.(() => {});
    if (state === 'over') return;

    const p = localPoint(e);

    if (state === 'ready') {
      enterFullscreen();
      startTrack.set(e.pointerId, { x: p.x, y: p.y });
      const target = startTarget();
      if (target && Math.hypot(p.x - target.x, p.y - target.y) <= target.r) {
        beginFromPoint(e, p.x, p.y, Math.random() * Math.PI);
      }
      return;
    }

    if (state === 'reveal') {
      if (performance.now() - revealedAt >= 2500) resetToReady();
      return;
    }

    if (state === 'chest') {
      const target = chestTarget();
      if (Math.hypot(p.x - target.x, p.y - target.y) <= target.r) {
        sliceChest();
        return;
      }
      pointers.set(e.pointerId, { x: p.x, y: p.y, hue: (e.pointerId * 67) % 360, trail: [{ ...p, t: performance.now() }] });
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    if (SWORD) {
      trail = [{ ...p, t: performance.now() }];
      return;
    }
    pointers.set(e.pointerId, { x: p.x, y: p.y, hue: (e.pointerId * 67) % 360, trail: [{ ...p, t: performance.now() }] });
    canvas.setPointerCapture?.(e.pointerId);
  });

  window.addEventListener('pointermove', e => {
    if (state === 'ready') {
      const track = startTrack.get(e.pointerId);
      const target = track && startTarget();
      if (target) {
        const p = localPoint(e);
        if (segmentHitsCircle(track.x, track.y, p.x, p.y, target.x, target.y, target.r)) {
          beginFromPoint(e, p.x, p.y, Math.atan2(p.y - track.y, p.x - track.x));
        } else {
          track.x = p.x;
          track.y = p.y;
        }
      }
      return;
    }

    if (state === 'chest') {
      const ptr = pointers.get(e.pointerId);
      if (!ptr) return;
      const p = localPoint(e);
      ptr.trail.push({ ...p, t: performance.now() });
      const target = chestTarget();
      if (segmentHitsCircle(ptr.x, ptr.y, p.x, p.y, target.x, target.y, target.r)) sliceChest();
      ptr.x = p.x;
      ptr.y = p.y;
      return;
    }

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

    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    const p = localPoint(e);
    ptr.trail.push({ ...p, t: performance.now() });
    slice(ptr.x, ptr.y, p.x, p.y);
    ptr.x = p.x;
    ptr.y = p.y;
  });

  const release = e => { pointers.delete(e.pointerId); startTrack.delete(e.pointerId); };
  const loseFocus = () => {
    pointers.clear();
    startTrack.clear();
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
    pointers.clear();
    startTrack.clear();
    trail = [];
    bladeJump = true;
    bladeVisible = true;
  });

  console.assert(segmentHitsCircle(0, 0, 100, 0, 50, 10, 20), 'segment should hit circle');
  console.assert(!segmentHitsCircle(0, 0, 100, 0, 50, 40, 20), 'segment should miss circle');
  console.assert(Math.abs(Math.atan2(0, 100)) < 1e-9, 'horizontal cut angle should be 0');

  console.assert(positive('5') === 5 && positive(-1) === 0 && positive('oops') === 0, 'odds must sanitise to non-negative numbers');
  const savedWeights = { ...kiosk.weights };
  kiosk.weights = { common: 0, rare: 0, epic: 0, unique: 0 };
  console.assert(pickTier() === null, 'all-zero odds must draw nothing');
  kiosk.weights = { common: 0, rare: 0, epic: 0, unique: 1 };
  console.assert(pickTier()?.key === 'unique', 'only the weighted tier can be drawn');
  kiosk.weights = savedWeights;

  resize();
  requestAnimationFrame(frame);
})();
