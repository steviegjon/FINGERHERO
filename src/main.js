// Boot, fixed-timestep loop, state machine (title -> playing -> dying -> dead -> playing).
import { VIEW, FRAME, PHYSICS, SPEED, FX, STORAGE_KEY, DEBUG_DEFAULT, PLAYER } from './config.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { World } from './world/world.js';
import { Generator } from './world/generator.js';
import { drawPlayLane, drawHazards } from './render/playlane.js';
import { FX as Effects } from './render/fx.js';
import { drawHUD, drawGameOver, drawPressSpace, loadFonts, FONTS } from './ui.js';

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
    this.fx = new Effects();
    loadFonts();
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
    const gen = new Generator(seed);
    gen.forcePattern = params.get('pattern'); // debug: ?pattern=carConvoy
    this.world = new World(gen);
    this.world.onEvent = (type, e) => this.onWorldEvent(type, e);
  }

  onWorldEvent(type, e) { /* audio/fx hooks (milestones 5-6) */ }

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
    if (e.code === 'KeyN') this.world.gen.skipBiome();
  }

  setState(s) { this.state = s; this.stateT = 0; }

  startRun() {
    if (urlSeed == null) this.seed = (Math.random() * 1e9) >>> 0;
    this.newWorld(this.seed);
    this.world.gen.startRunway(this.world);
    this.world.update(0, SPEED.start); // activate the runway
    const x0 = PLAYER.x - PLAYER.feetHalf, x1 = PLAYER.x + PLAYER.feetHalf;
    let best = null;
    for (const s of this.world.surfacesNear(x0, x1)) {
      const top = s.topBetween(x0, x1, this.world.D);
      if (top != null && (!best || top < best.top)) best = { s, top };
    }
    this.player.reset(best ? best.top : 470);
    this.player.surface = best ? best.s : null;
    this.miles = 0;
    this.newBest = false;
    this.deathInfo = null;
    this.fx.reset();
    this.world.playing = true;
    this.setState('playing');
  }

  // Speed is a pure function of run distance (so the generator can predict it exactly),
  // eased in from the attract speed at the start of a run.
  targetSpeed() {
    const w = this.world;
    if (this.state === 'title') return SPEED.attract;
    const s = w.gen.speedAt(w.D);
    const e = Math.min(1, w.runTime / SPEED.easeIn);
    return w.startSpeed != null && e < 1 ? w.startSpeed + (s - w.startSpeed) * e * e * (3 - 2 * e) : s;
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
    } else if (this.state === 'dying') {
      // the world keeps rolling for a beat, easing down, then freezes under the overlay
      this.world.update(dt, this.world.speed * Math.exp(-4 * dt));
    }
    if (playing) {
      this.player.update(dt, this.input, pressed, this.world);
      if (this.state === 'playing') this.checkDeath();
      if (this.state === 'dying' && this.stateT >= FX.deathBeat) this.setState('dead');
    }
    for (const e of this.player.events) this.onPlayerEvent(e);
    this.player.events.length = 0;
    this.fx.update(dt, this.state === 'dead' ? 0 : this.world.speed);
  }

  checkDeath() {
    const p = this.player, w = this.world;
    if (p.y - 20 > FRAME.sill) {
      if (this.invincible) { p.y = 380; p.vy = -600; p.grounded = false; }
      else p.kill('fall');
    }
    if (!p.dead && !this.invincible) {
      const hit = w.hazardHit(p.hurtbox());
      if (hit) {
        p.kill(hit.hazard.deathKind);
        this.deathInfo = { hazard: hit.hazard, x: hit.box.x + hit.box.w / 2, y: hit.box.y + hit.box.h / 2 };
        hit.hazard.hitPlayer = true;
      }
    }
    if (p.dead) this.onDeath();
  }

  onPlayerEvent(e) {
    const p = this.player, fx = this.fx;
    const k = p.surface?.k ?? 1;
    if (e.type === 'land') {
      const m = e.surface.material;
      if (m === 'wire') fx.burst('spark', p.x, p.y, 7, { k });
      else if (e.surface.bouncy) fx.burst('leaf', p.x, p.y, 8, { k });
      else fx.burst('dust', p.x, p.y, e.impact > 700 ? 9 : 5, { k, color: m === 'metal' ? '#cfd3d8' : '#d9cdb2' });
    } else if (e.type === 'jump' && e.vel) {
      if (!this.player.grounded) fx.burst('dust', p.x, p.y, 3, { k });
    } else if (e.type === 'death') {
      if (e.kind === 'bug' && this.deathInfo) {
        this.fx.splat(this.deathInfo.x + 30, this.deathInfo.y - 10, this.deathInfo.hazard.variant);
        this.deathInfo.hazard.dead = true;
      } else if (e.kind === 'hit') {
        this.fx.shake = 0.6;
        const h = this.deathInfo?.hazard;
        if (h?.kind === 'bird') this.fx.burst('feather', this.deathInfo.x, this.deathInfo.y, 10, { k: 0.2 });
        else this.fx.burst('chip', p.x + 14, p.y - p.h * 0.6, 6, { k: 0 });
      }
    }
  }

  onDeath() {
    this.setState('dying');
    if (this.miles > this.best) { this.newBest = this.best > 0 || this.miles >= 0.1; this.best = this.miles; saveBest(this.best); }
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
    drawPlayLane(ctx, w, D, w.time);
    drawHazards(ctx, w, D, w.time);
    this.fx.drawParticles(ctx);
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

    this.fx.drawSplats(ctx);
    if (this.state !== 'title') drawHUD(ctx, this);
    if (this.state === 'title') {
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `90px ${FONTS.hand}`;
      ctx.fillText('FINGER HERO', VIEW.W / 2, VIEW.H / 2 - 40);
      drawPressSpace(ctx, w.time, 1);
    }
    if (this.state === 'dead') drawGameOver(ctx, this, this.stateT);
    if (this.debug) this.renderDebug(ctx);
  }

  renderDebug(ctx) {
    const p = this.player, w = this.world;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '13px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(FRAME.left + 6, FRAME.top + 6, 340, 114);
    ctx.fillStyle = '#9f9';
    const lines = [
      `fps ${this.fps.toFixed(0)}  state ${this.state}/${p.state}`,
      `speed ${w.speed.toFixed(0)}${w.speedOverride ? ' (override)' : ''}  D ${w.D.toFixed(0)}`,
      `run ${w.runTime.toFixed(1)}s  seed ${this.seed}  diff ${w.gen.difficultyAt(w.D).toFixed(2)}`,
      `biome ${w.gen.biomeAt(w.D).id}  pattern ${w.gen.lastPattern}`,
      `inv ${this.invincible ? 'ON' : 'off'}  surfaces ${w.surfaces.length} pend ${w.pending.length}`,
      `[ ] speed  \\ reset  I invincible  N next biome`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, FRAME.left + 12, FRAME.top + 24 + i * 17));
    if (this.state !== 'title') {
      const hb = p.hurtbox();
      ctx.strokeStyle = '#0f0';
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
      ctx.strokeStyle = '#f33';
      for (const h of w.hazards) for (const b of h.boxes(w.D, w.time)) ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(80,200,255,0.7)';
      for (const s of w.surfaces) {
        const L = s.left(w.D);
        ctx.beginPath();
        for (const [lx, y] of s.profile) ctx.lineTo(L + lx, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

window.game = new Game(document.getElementById('game'));
