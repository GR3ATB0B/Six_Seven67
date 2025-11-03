const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayMessage = document.getElementById("overlay-message");
const startBtn = document.getElementById("start-btn");

const config = {
  baseWidth: canvas.width,
  baseHeight: canvas.height,
  aspect: canvas.width / canvas.height,
  width: canvas.width,
  height: canvas.height,
  baseSpawnInterval: 1000,
  minSpawnInterval: 320,
  waveSeconds: 32,
  minSpeed: 95,
  maxSpeed: 165,
  sacredScore: 67,
  maxLives: 3,
  sacredFadeDuration: 60,
};

const palette = {
  sacredBodyStart: { r: 255, g: 224, b: 103 },
  sacredBodyEnd: { r: 107, g: 228, b: 255 },
  sacredGlowStart: { r: 255, g: 224, b: 103, a: 0.55 },
  sacredGlowEnd: { r: 111, g: 228, b: 255, a: 0.5 },
  commonBody: { r: 79, g: 195, b: 255 },
  commonGlow: { r: 78, g: 184, b: 255, a: 0.35 },
};

const clipSources = {
  wave: ["kid-67.mp3", "doot-doot-6-7.mp3", "67-normal.mp3"],
  kidDrop: "kid-67.mp3",
};

function loadAudioClip(path, volume = 0.7) {
  const clip = new Audio(path);
  clip.preload = "auto";
  clip.crossOrigin = "anonymous";
  clip.volume = volume;
  if (typeof clip.load === "function") {
    clip.load();
  }
  return clip;
}

function playClipInstance(baseClip, { volume = baseClip.volume ?? 1, playbackRate = 1 } = {}) {
  if (!baseClip) {
    return;
  }
  const instance = baseClip.cloneNode(true);
  instance.volume = volume;
  instance.playbackRate = playbackRate;
  const playPromise = instance.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

const state = {
  running: false,
  numbers: [],
  score: 0,
  level: 1,
  lives: config.maxLives,
  spawnTimer: 0,
  spawnInterval: config.baseSpawnInterval,
  timer: config.waveSeconds,
  lastTimestamp: null,
  lastFlash: 0,
  statusText: "",
  statusTimer: 0,
  fadeProgress: 0,
};

const audio = {
  ctx: null,
  master: null,
  enabled: false,
  waveClips: [],
  kidClip: null,
  init() {
    if (this.enabled) {
      if (this.ctx?.state === "suspended") {
        this.ctx.resume();
      }
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      this.ctx = null;
      this.master = null;
    } else {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(0.24, this.ctx.currentTime);
      this.master.connect(this.ctx.destination);
    }
    this.waveClips = clipSources.wave.map((path) => loadAudioClip(path, 0.7));
    this.kidClip = loadAudioClip(clipSources.kidDrop, 0.8);
    this.enabled = true;
  },
  playRandomWaveClip() {
    if (!this.enabled || this.waveClips.length === 0) {
      return;
    }
    const index = Math.floor(Math.random() * this.waveClips.length);
    playClipInstance(this.waveClips[index]);
  },
  playKidDrop() {
    if (!this.enabled || !this.kidClip) {
      return;
    }
    playClipInstance(this.kidClip);
  },
  playSacredHit() {
    if (!this.enabled || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    this._burst([
      { freq: 440, time: now, duration: 0.08, gain: 0.4 },
      { freq: 600, time: now + 0.08, duration: 0.1, gain: 0.5 },
      { freq: 670, time: now + 0.18, duration: 0.12, gain: 0.5 },
    ]);
    this._noisePing(now + 0.05, 0.18, 1200);
  },
  playMiss() {
    if (!this.enabled || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    const osc = this._osc("sawtooth", 480, now, 0.4, 0.28);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.28);
    this._noisePing(now, 0.22, 400, 0.2);
  },
  playLevelUp() {
    if (!this.enabled) {
      return;
    }
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const tones = [523, 659, 784];
      tones.forEach((freq, i) => {
        this._burst([
          { freq, time: now + i * 0.12, duration: 0.1, gain: 0.35 },
        ]);
      });
    }
    this.playRandomWaveClip();
  },
  playGameOver() {
    if (!this.enabled || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    const osc = this._osc("triangle", 220, now, 0.6, 0.5);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.5);
  },
  _burst(segments) {
    if (!this.ctx) {
      return;
    }
    segments.forEach(({ freq, time, duration, gain }) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(gain ?? 0.3, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, time + duration);
      osc.connect(g).connect(this.master);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    });
  },
  _noisePing(time, duration, cutoff, gain = 0.28) {
    if (!this.ctx) {
      return;
    }
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(cutoff, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(time);
    noise.stop(time + duration + 0.05);
  },
  _osc(type, freq, start, duration, gain) {
    if (!this.ctx) {
      return this._noopOsc();
    }
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain ?? 0.3, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.1);
    return osc;
  },
  _noopOsc() {
    return {
      frequency: { exponentialRampToValueAtTime: () => {} },
    };
  },
};

startBtn.addEventListener("click", () => startGame());
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !state.running) {
    startGame();
    event.preventDefault();
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!state.running) {
    return;
  }
  const point = translatePointer(event);
  handleClick(point);
});

window.addEventListener("resize", () => resizeCanvas());
window.addEventListener("orientationchange", () => {
  window.setTimeout(resizeCanvas, 120);
});
resizeCanvas();
drawSplash();

function startGame() {
  audio.init();
  state.running = true;
  state.numbers = [];
  state.score = 0;
  state.level = 1;
  state.lives = config.maxLives;
  state.spawnInterval = config.baseSpawnInterval;
  state.spawnTimer = 0;
  state.timer = config.waveSeconds;
  state.lastTimestamp = performance.now();
  state.lastFlash = 0;
  state.statusText = "";
  state.statusTimer = 0;
  state.fadeProgress = 0;
  overlay.classList.add("hidden");
  requestAnimationFrame(loop);
}

function endGame(message) {
  state.running = false;
  overlayTitle.textContent = "Meme Lost";
  overlayMessage.textContent = `${message} Final score: ${state.score}`;
  startBtn.textContent = "Try Again";
  overlay.classList.remove("hidden");
  audio.playGameOver();
}

function loop(timestamp) {
  if (!state.running) {
    return;
  }

  const delta = state.lastTimestamp ? (timestamp - state.lastTimestamp) / 1000 : 0;
  state.lastTimestamp = timestamp;

  update(delta);
  draw();

  if (state.running) {
    requestAnimationFrame(loop);
  }
}

function update(delta) {
  state.spawnTimer += delta * 1000;
  while (state.spawnTimer >= state.spawnInterval) {
    spawnNumber();
    state.spawnTimer -= state.spawnInterval;
  }

  for (let i = state.numbers.length - 1; i >= 0; i -= 1) {
    const num = state.numbers[i];
    num.y += num.speed * delta;

    if (num.y - num.radius > config.height) {
      state.numbers.splice(i, 1);
      if (num.isSacred) {
        loseLife("You let a 67 slip through!", { sacredDrop: true });
      }
    }
  }

  state.timer -= delta;
  if (state.timer <= 0) {
    levelUp();
  }

  state.fadeProgress = Math.min(1, state.fadeProgress + delta / config.sacredFadeDuration);

  if (state.statusTimer > 0) {
    state.statusTimer -= delta;
    if (state.statusTimer <= 0) {
      state.statusTimer = 0;
      state.statusText = "";
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, config.width, config.height);

  if (performance.now() - state.lastFlash < 120) {
    ctx.fillStyle = "rgba(255, 230, 103, 0.12)";
    ctx.fillRect(0, 0, config.width, config.height);
  }

  state.numbers.forEach((num) => drawNumber(num));
  drawHud();

  if (state.statusTimer > 0 && state.statusText) {
    ctx.fillStyle = "rgba(4, 12, 30, 0.6)";
    ctx.fillRect(0, config.height / 2 - 60, config.width, 120);
    ctx.fillStyle = "#ffe067";
    ctx.font = 'bold 54px "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.statusText, config.width / 2, config.height / 2);
  }
}

function drawNumber(num) {
  ctx.save();
  ctx.translate(num.x, num.y);

  const glowColor = num.isSacred
    ? colorToRgba(mixColor(palette.sacredGlowStart, palette.sacredGlowEnd, state.fadeProgress))
    : colorToRgba(palette.commonGlow);
  ctx.fillStyle = glowColor;
  ctx.beginPath();
  ctx.arc(0, 0, num.radius + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = num.isSacred
    ? colorToRgba(mixColor(palette.sacredBodyStart, palette.sacredBodyEnd, state.fadeProgress))
    : colorToRgba(palette.commonBody);
  ctx.beginPath();
  ctx.arc(0, 0, num.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#061222";
  ctx.font = `bold ${Math.round(num.radius * 1.3)}px "Montserrat", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(num.label, 0, num.labelOffset);
  ctx.restore();
}

function drawHud() {
  const hudHeight = config.height < 360 ? 70 : 60;
  ctx.fillStyle = "rgba(0, 8, 24, 0.55)";
  ctx.fillRect(0, 0, config.width, hudHeight);

  const fontSize = config.width < 480 ? 16 : 18;
  ctx.fillStyle = "#67f3ff";
  ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";

  const centerY = hudHeight / 2;
  const waveRemaining = Math.max(0, state.timer);
  const waveLabel = `Wave: ${waveRemaining.toFixed(config.width < 420 ? 0 : 1)}s`;

  ctx.textAlign = "left";
  ctx.fillText(`Score: ${state.score}`, 20, centerY);

  ctx.textAlign = "center";
  ctx.fillText(`Level: ${state.level} | ${waveLabel}`, config.width / 2, centerY);

  const livesRemaining = Math.max(0, Math.floor(state.lives));
  const livesLost = Math.max(0, config.maxLives - livesRemaining);
  const livesText = `Lives: ${"#".repeat(livesRemaining)}${"-".repeat(livesLost)}`;

  ctx.textAlign = "right";
  ctx.fillText(livesText, config.width - 20, centerY);
}

function spawnNumber() {
  const sacredChance = Math.min(0.32, 0.18 + state.level * 0.05);
  const isSacred = Math.random() < sacredChance;
  let value = 67;

  if (!isSacred) {
    do {
      value = Math.floor(Math.random() * 100);
    } while (value === 67);
  }

  const fontSize = 28 + Math.random() * 24;
  const radius = fontSize * 0.7;
  const x = radius + Math.random() * (config.width - radius * 2);
  const speed = (config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed)) * (1 + (state.level - 1) * 0.12);

  const label = value.toString();
  // Nudges to better vertically center odd-sized fonts.
  const labelOffset = label.length >= 3 ? 3 : 2;

  state.numbers.push({
    value,
    label,
    labelOffset,
    isSacred,
    x,
    y: -radius,
    radius,
    speed,
  });
}

function handleClick(point) {
  for (let i = state.numbers.length - 1; i >= 0; i -= 1) {
    const num = state.numbers[i];
    const dx = point.x - num.x;
    const dy = point.y - num.y;
    if (dx * dx + dy * dy <= num.radius * num.radius) {
      state.numbers.splice(i, 1);
      if (num.isSacred) {
        state.score += config.sacredScore;
        state.lastFlash = performance.now();
        audio.playSacredHit();
      } else {
        loseLife("That imposter drained the vibe.");
      }
      return;
    }
  }
}

function loseLife(reason, options = {}) {
  if (!state.running) {
    return;
  }
  state.lives = Math.max(0, state.lives - 1);
  state.statusText = reason;
  state.statusTimer = 1.2;
  audio.playMiss();
  if (options.sacredDrop) {
    audio.playKidDrop();
  }
  if (state.lives <= 0) {
    endGame(reason);
  }
}

function levelUp() {
  state.level += 1;
  state.timer = config.waveSeconds * Math.max(0.6, 1 - state.level * 0.05);
  state.spawnInterval = Math.max(config.minSpawnInterval, state.spawnInterval * 0.9);
  state.statusText = `Level ${state.level}`;
  state.statusTimer = 1.6;
  audio.playLevelUp();
}

function drawSplash() {
  ctx.clearRect(0, 0, config.width, config.height);
  ctx.fillStyle = "rgba(3, 10, 24, 0.75)";
  ctx.fillRect(0, 0, config.width, config.height);
  ctx.fillStyle = "#67f3ff";
  ctx.font = '48px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("Click start to unleash the 67.", config.width / 2, config.height / 2);
}

function translatePointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * config.width,
    y: ((event.clientY - bounds.top) / bounds.height) * config.height,
  };
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = Math.max(320, window.innerWidth - 24);
  const viewportHeight = Math.max(320, window.innerHeight - 180);
  let targetWidth = Math.min(config.baseWidth, viewportWidth);
  let targetHeight = targetWidth / config.aspect;

  if (targetHeight > viewportHeight) {
    targetHeight = viewportHeight;
    targetWidth = targetHeight * config.aspect;
  }

  config.width = Math.round(targetWidth);
  config.height = Math.round(targetHeight);

  canvas.style.width = `${config.width}px`;
  canvas.style.height = `${config.height}px`;
  canvas.width = Math.round(config.width * dpr);
  canvas.height = Math.round(config.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!state.running) {
    drawSplash();
  }
}

function mixColor(start, end, t) {
  return {
    r: blendChannel(start.r, end.r, t),
    g: blendChannel(start.g, end.g, t),
    b: blendChannel(start.b, end.b, t),
    a: blendChannel(start.a ?? 1, end.a ?? 1, t),
  };
}

function blendChannel(start, end, t) {
  return start + (end - start) * t;
}

function colorToRgba(color) {
  const { r, g, b, a = 1 } = color;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.max(0, Math.min(1, a))})`;
}
