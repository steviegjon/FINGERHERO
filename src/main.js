// Boot, fixed-timestep loop, state machine (title -> playing -> dying -> dead -> playing).
import { VIEW, FRAME, PHYSICS, SPEED, FX, STORAGE_KEY, DEBUG_DEFAULT, PLAYER } from './config.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { World } from './world/world.js';
import { Generator } from './world/generator.js';

const params = new URLSearchParams(location.search);
const urlSeed = params.has('seed') ? parseInt(params.get('seed'), 10) >>> 0 : null;

function loadBest() { try { return parseFloat(localStorage.getItem(STORAGE_KEY)) || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* storage blocked */ } }

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input(window);
    this.player = new Player();
    this.best = loadBest();
    this.debug = DEBUG_DEFAULT || params.get('debug') === '1';
    this.invincible = false;
    this.fps = 60;
    this.state = 'title';
    this.stateT = 0;
    this.miles = 0;
    this.newBest = false;
    this.seed = urlSeed ?? ((Math.random() * 1e9) >>> 0);
    this.newWorld(this.seed);

    this.input.onAnyKey((e) => this.onKey(e));
    canvas.addEventListener('pointerdown', () => canvas.focus());
    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.focus();

    this.acc = 0;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  newWorld(seed) {
    this.world = new World(new Generator(seed));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(window.innerWidth / VIEW.W, window.innerHeight / VIEW.H);
    const cssW = Math.floor(VIEW.W * scale), cssH = Math.floor(VIEW.H * scale);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.pixelScale = (cssW * dpr) / VIEW.W;
  }

  onKey(e) {
    if (e.repeat) return;
    if (e.code === 'Backquote') this.debug = !this.debug;
    if (!this.debug) return;
    if (e.code === 'KeyI') this.invincible = !this.invincible;
    if (e.code === 'BracketLeft') this.world.speedOverride = Math.max(120, (this.world.speedOverride ?? this.world.speed) - 60);
    if (e.code === 'BracketRight') this.world.speedOverride = Math.min(1400, (this.world.speedOverride ?? this.world.speed) + 60);
    if (e.code === 'Backslash') this.world.speedOverride = null;
  }

  setState(s) { this.state = s; this.stateT = 0; }

  startRun() {
    if (urlSeed == null) this.seed = (Math.random() * 1e9) >>> 0;
    this.newWorld(this.seed);
    const top = this.world.gen.startRunway(this.world);
    this.player.reset(top);
    this.player.surface = this.world.surfaces[0] ?? null;
    this.miles = 0;
    this.newBest = false;
    this.setState('playing');
  }

  targetSpeed() {
    if (this.state === 'title') return SPEED.attract;
    const t = this.world.runTime;
    return Math.min(SPEED.max, SPEED.start + SPEED.ramp * t);
  }

  step(dt) {
    const pressed = this.input.consume();
    this.stateT += dt;
    const playing = this.state === 'playing' || this.state === 'dying';

    if (this.state === 'title') {
      if (pressed.space) { this.startRun(); return; }
      this.world.update(dt, this.targetSpeed());
      return;
    }
    if (this.state === 'dead') {
      if (pressed.space) this.startRun();
      return;
    }

    if (this.state === 'playing') {
      this.world.runTime += dt;
      this.world.update(dt, this.targetSpeed());
      this.miles += (this.world.speed * SPEED.mphPerPx * dt) / 3600;
    }
    if (playing) {
      this.player.update(dt, this.input, pressed, this.world);
      if (this.state === 'playing') this.checkDeath();
      if (this.state === 'dying' && this.stateT >= FX.deathBeat) this.setState('dead');
    }
    this.player.events.length = 0;
  }

  checkDeath() {
    const p = this.player;
    if (p.y - 20 > FRAME.sill) {
      if (this.invincible) { p.y = 380; p.vy = -600; }
      else p.kill('fall');
    }
    if (p.dead) this.onDeath();
  }

  onDeath() {
    this.setState('dying');
    if (this.miles > this.best) { this.best = this.miles; this.newBest = true; saveBest(this.best); }
  }

  frame(now) {
    let dtReal = (now - this.last) / 1000;
    this.last = now;
    if (dtReal > 0.25) dtReal = 0.25;
    this.fps += (1 / Math.max(dtReal, 1e-4) - this.fps) * 0.05;
    this.acc += dtReal;
    const step = PHYSICS.step;
    while (this.acc >= step) { this.step(step); this.acc -= step; }
    this.render(this.acc / step);
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- Milestone 1 grey-box renderer
  render(alpha) {
    const ctx = this.ctx, w = this.world;
    ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
    const D = w.prevD + (w.D - w.prevD) * alpha;
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
    ctx.fillStyle = '#4a525c';
    for (const s of w.surfaces) {
      const L = s.left(D);
      ctx.beginPath();
      ctx.moveTo(L, VIEW.H);
      for (const [lx, y] of s.profile) ctx.lineTo(L + lx, y);
      ctx.lineTo(L + s.w, VIEW.H);
      ctx.fill();
    }
    if (this.state !== 'title') {
      const p = this.player;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      ctx.fillStyle = p.dead ? '#b03a2e' : '#f0c9a0';
      const sq = p.squash;
      const bw = PLAYER.w * (1 + sq * 0.6), bh = p.h * (1 - sq * 0.6);
      ctx.fillRect(p.x - bw / 2, y - bh, bw, bh);
    }
    // frame
    ctx.fillStyle = '#15171b';
    ctx.fillRect(0, 0, VIEW.W, FRAME.top);
    ctx.fillRect(0, 0, FRAME.left, VIEW.H);
    ctx.fillRect(FRAME.right, 0, VIEW.W - FRAME.right, VIEW.H);
    ctx.fillRect(0, FRAME.sill, VIEW.W, VIEW.H - FRAME.sill);

    ctx.fillStyle = '#fff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.miles.toFixed(1).padStart(5, '0')} mi   BEST ${this.best.toFixed(1)}`, FRAME.right - 20, FRAME.top + 30);
    ctx.textAlign = 'center';
    if (this.state === 'title') ctx.fillText('FINGER HERO — press SPACE', VIEW.W / 2, VIEW.H / 2);
    if (this.state === 'dead') ctx.fillText(`${this.miles.toFixed(1)} mi — SPACE to go again`, VIEW.W / 2, VIEW.H / 2);
    if (this.debug) this.renderDebug(ctx);
  }

  renderDebug(ctx) {
    const p = this.player, w = this.world;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '13px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(FRAME.left + 6, FRAME.top + 6, 300, 96);
    ctx.fillStyle = '#9f9';
    const lines = [
      `fps ${this.fps.toFixed(0)}  state ${this.state}/${p.state}`,
      `speed ${w.speed.toFixed(0)}${w.speedOverride ? ' (override)' : ''}  D ${w.D.toFixed(0)}`,
      `run ${w.runTime.toFixed(1)}s  seed ${this.seed}`,
      `inv ${this.invincible ? 'ON' : 'off'}  surfaces ${w.surfaces.length} pend ${w.pending.length}`,
      `[ ] speed  \\ reset  I invincible  N next biome`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, FRAME.left + 12, FRAME.top + 24 + i * 17));
    if (this.state !== 'title') {
      const hb = p.hurtbox();
      ctx.strokeStyle = '#0f0';
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.restore();
  }
}

window.game = new Game(document.getElementById('game'));
