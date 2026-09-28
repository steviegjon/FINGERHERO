// Boot, fixed-timestep loop, state machine (title -> starting -> playing -> dying -> dead -> playing).
import { VIEW, FRAME, PHYSICS, SPEED, FX, STORAGE_KEY, DEBUG_DEFAULT, PLAYER } from './config.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { World } from './world/world.js';
import { Generator } from './world/generator.js';
import { drawSections, drawPlayLane, drawHazards, drawTunnelDarkness, drawTunnelMarkers } from './render/playlane.js';
import { FX as Effects } from './render/fx.js';
import { Sky, paletteAt } from './render/sky.js';
import { Parallax } from './render/parallax.js';
import { WindowFrame, glassPath } from './render/window.js';
import { drawHand, initHandRenderer } from './hand.js';
import { drawHUD, drawGameOver, drawPressSpace, loadFonts, FONTS } from './ui.js';
import { noise1, clamp, mixRgb, lerp, smoothstep } from './util.js';
import { Audio } from './audio.js';
import { FogTitle } from './render/fog.js';
import { TIME_OF_DAY } from './config.js';

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
    this.windowFrame = new WindowFrame();
    this.bob = 0; this.bump = 0; this.bumpV = 0;
    this.audio = new Audio();
    this.fog = new FogTitle();
    this.fogAlpha = 1;
    this.tod = TIME_OF_DAY.attractPhase;
    loadFonts();
    initHandRenderer();
    this.newWorld(this.seed);

    this.input.onAnyKey((e) => this.onKey(e));
    canvas.addEventListener('pointerdown', () => canvas.focus());
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      const c = this.audio.ctx;
      if (!c) return;
      if (document.hidden) c.suspend?.(); else c.resume?.();
    });
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
    this.sky = new Sky(seed);
    this.parallax = new Parallax(seed);
    this.world.inTunnel = 0;
    this.wasInTunnel = false;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const gutter = window.innerWidth < 700 ? 32 : 0; // 16px each side on narrow screens
    const scale = Math.min((window.innerWidth - gutter) / VIEW.W, window.innerHeight / VIEW.H);
    const cssW = Math.floor(VIEW.W * scale), cssH = Math.floor(VIEW.H * scale);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.pixelScale = (cssW * dpr) / VIEW.W;
  }

  onKey(e) {
    this.audio.start(); // audio context starts on the first keypress
    if (e.repeat) return;
    if (e.code === 'Backquote') this.debug = !this.debug;
    if (!this.debug) return;
    const w = this.world;
    if (e.code === 'KeyI') this.invincible = !this.invincible;
    if (e.code === 'BracketLeft') w.speedOverride = Math.max(120, (w.speedOverride ?? w.speed) - 60);
    if (e.code === 'BracketRight') w.speedOverride = Math.min(1400, (w.speedOverride ?? w.speed) + 60);
    if (e.code === 'Backslash') w.speedOverride = null;
    if (e.code === 'KeyN') w.gen.skipBiome();
    if (e.code === 'KeyT') this.todOffset = (this.todOffset ?? 0) + 0.125;
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
    this.fogAlpha = 0;
    this.tod = TIME_OF_DAY.startPhase;
    this.setState('playing');
  }

  // Title -> run without a cut: the world keeps rolling, the fog fades, the hand rises into frame.
  beginFromTitle() {
    const w = this.world;
    w.gen.beginRun(w.D);
    w.startSpeed = w.speed;
    w.runTime = 0;
    w.playing = true;
    this.player.reset(FRAME.sill + 110);
    this.player.grounded = false;
    this.riseFrom = FRAME.sill + 110;
    this.miles = 0;
    this.newBest = false;
    this.deathInfo = null;
    this.setState('starting');
  }

  riseHand(dt) {
    const p = this.player, w = this.world;
    p.prevY = p.y;
    const x0 = PLAYER.x - PLAYER.feetHalf, x1 = PLAYER.x + PLAYER.feetHalf;
    let best = null;
    for (const s of w.surfacesNear(x0, x1)) {
      const top = s.topBetween(x0, x1, w.D);
      if (top != null && (!best || top < best.top)) best = { s, top };
    }
    const k = smoothstep(0, 0.85, this.stateT);
    const target = best ? best.top : 470;
    p.y = lerp(this.riseFrom, target - 26 * Math.sin(Math.PI * k) * (1 - k), k);
    p.runPhase = (p.runPhase + dt * 1.6) % 1;
    if (k >= 1 && best) {
      p.y = best.top; p.prevY = best.top;
      p.grounded = true; p.surface = best.s; p.vy = 0;
      p.squash = 0.2;
      p.emit('land', { surface: best.s, impact: 300 });
      this.setState('playing');
    }
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
    const w = this.world;
    const playing = this.state === 'playing' || this.state === 'dying';
    if (this.state === 'starting') this.fx.update(dt, w.speed);

    if (this.state === 'title') {
      this.fog.update(dt, true);
      this.tod += (dt / TIME_OF_DAY.cycleSec) * 0.15;
      if (pressed.space) { this.beginFromTitle(); return; }
      w.update(dt, this.targetSpeed());
    } else if (this.state === 'starting') {
      w.runTime += dt;
      this.tod += dt / TIME_OF_DAY.cycleSec;
      w.update(dt, this.targetSpeed());
      this.fogAlpha = Math.max(0, this.fogAlpha - dt / 0.6);
      this.riseHand(dt);
    } else if (this.state === 'dead') {
      if (pressed.space) { this.startRun(); return; }
    } else if (this.state === 'playing') {
      w.runTime += dt;
      this.tod += dt / TIME_OF_DAY.cycleSec;
      w.update(dt, this.targetSpeed());
      this.miles += (w.speed * SPEED.mphPerPx * dt) / 3600;
    } else if (this.state === 'dying') {
      // the world keeps rolling for a beat, easing down, then freezes under the overlay
      w.update(dt, w.speed * Math.exp(-4 * dt));
    }
    if (playing) {
      this.player.update(dt, this.input, pressed, w);
      if (this.state === 'playing') this.checkDeath();
      if (this.state === 'dying' && this.stateT >= FX.deathBeat) this.setState('dead');
    }
    for (const e of this.player.events) this.onPlayerEvent(e);
    this.player.events.length = 0;

    const moving = this.state !== 'dead';
    if (this.state === 'playing') this.whooshes();
    this.fx.update(dt, moving ? w.speed : 0);
    if (moving) {
      this.sky.update(dt, w.speed);
      this.parallax.update(dt, w.speed, () => w.gen.biomeAt(w.D + VIEW.W - PLAYER.x).id);
      this.updateBob(dt);
      this.updateTunnel();
    }
  }

  updateBob(dt) {
    // small road rumble plus the occasional bigger bump (a spring)
    const t = this.world.time;
    const sp = clamp(this.world.speed / SPEED.max, 0.3, 1);
    this.bob = (noise1(t * 7) - 0.5) * 2 * FX.bobAmp * sp + (noise1(t * 23 + 5) - 0.5) * 0.8 * sp;
    if (Math.random() < FX.bumpChancePerSec * dt * (0.5 + sp)) this.bumpV += FX.bumpAmp * 60 * (0.6 + Math.random() * 0.6);
    this.bumpV += (-this.bump * 260 - this.bumpV * 14) * dt;
    this.bump += this.bumpV * dt;
  }

  updateTunnel() {
    const w = this.world;
    let inside = 0;
    for (const d of w.decor) {
      if (d.kind !== 'tunnel') continue;
      const L = d.left(w.D), R = L + d.w;
      inside = Math.max(inside, clamp(Math.min(PLAYER.x - L, R - PLAYER.x) / 120, 0, 1));
    }
    if (this.wasInTunnel && inside === 0) { this.fx.flash = 0.75; this.onWorldEvent('tunnelExit'); }
    if (!this.wasInTunnel && inside > 0) this.onWorldEvent('tunnelEnter');
    this.wasInTunnel = inside > 0;
    w.inTunnel = inside;
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
        this.deathInfo = { hazard: hit.hazard, x: hit.box.x + hit.box.w / 2, y: hit.box.y + hit.box.h / 2 };
        hit.hazard.hitPlayer = true;
        p.kill(hit.hazard.deathKind);
      }
    }
    if (p.dead) this.onDeath();
  }

  onWorldEvent(type, e) {
    const a = this.audio;
    if (type === 'birdTakeoff') a.flutter();
    else if (type === 'tunnelEnter') a.whoosh(true, -0.8);
    else if (type === 'tunnelExit') a.whoosh(true, -0.4);
  }

  // Whoosh when big things pass the fingers.
  whooshes() {
    const w = this.world, x = PLAYER.x + 150;
    const check = (e, big) => {
      if (e.whooshed) return;
      if (e.left(w.D) < x) { e.whooshed = true; if (w.playing) this.audio.whoosh(big); }
    };
    for (const h of w.hazards) if (h.kind === 'sign' || h.kind === 'overpass') check(h, h.kind === 'overpass' || h.w > 90);
    for (const s of w.surfaces) if (s.kind === 'vehicle' && (s.data.part === 'trailer' || s.data.part === 'loco')) check(s, true);
  }

  onPlayerEvent(e) {
    const p = this.player, fx = this.fx, a = this.audio;
    if (e.type === 'step') a.tap(e.surface?.material);
    else if (e.type === 'jump' && !e.bounce) a.jump();
    else if (e.type === 'land') a.land(e.surface.material, e.surface.bouncy);
    else if (e.type === 'slide') a.slide();
    else if (e.type === 'death') { if (e.kind === 'bug') a.splat(); else if (e.kind === 'hit') a.thunk(); else a.drop(); }
    const k = p.surface?.k ?? 1;
    if (e.type === 'land') {
      const m = e.surface.material;
      if (m === 'wire') fx.burst('spark', p.x, p.y, 7, { k });
      else if (e.surface.bouncy) { fx.burst('leaf', p.x, p.y, 8, { k }); e.surface.data.bounceT = this.world.time; }
      else fx.burst('dust', p.x, p.y, e.impact > 700 ? 9 : 5, { k, color: m === 'metal' ? '#cfd3d8' : '#d9cdb2' });
      if (e.impact > 900) this.bumpV += Math.min(140, (e.impact - 900) * 0.25); // screen bump on hard landings
    } else if (e.type === 'death') {
      if (e.kind === 'bug' && this.deathInfo) {
        fx.splat(this.deathInfo.x + 26, this.deathInfo.y - 8, this.deathInfo.hazard.variant);
        this.deathInfo.hazard.dead = true;
      } else if (e.kind === 'hit') {
        fx.shake = 0.6;
        const h = this.deathInfo?.hazard;
        if (h?.kind === 'bird') fx.burst('feather', this.deathInfo.x, this.deathInfo.y, 10, { k: 0.2 });
        else fx.burst('chip', p.x + 14, p.y - p.h * 0.6, 6, { k: 0 });
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
    this.updateAudio(dtReal);
    this.render(this.acc / step);
    requestAnimationFrame((t) => this.frame(t));
  }

  updateAudio(dt) {
    const w = this.world, p = this.player;
    this.audio.update(dt, {
      biome: w.gen.biomeAt(w.D).id,
      speed: w.speed,
      tunnel: w.inTunnel ?? 0,
      playing: this.state === 'playing',
      onWire: this.state === 'playing' && p.grounded && p.surface?.material === 'wire',
      dead: this.state === 'dead' || this.state === 'dying',
      frozen: this.state === 'dead',
    });
  }

  palette() {
    return paletteAt(this.tod + (this.todOffset ?? 0));
  }

  handState(alpha, P) {
    const p = this.player, w = this.world;
    const y = p.prevY + (p.y - p.prevY) * alpha;
    const inT = w.inTunnel ?? 0;
    const lamp = w.tunnelLamp ?? 0;
    const dark = clamp((1 - P.ambient) * 0.62 + inT * (0.42 - lamp * 0.3), 0, 0.72);
    const rim = inT > 0.3 ? mixRgb(P.rim, [255, 160, 80], inT) : P.rim;
    return {
      state: p.state, phase: p.runPhase, x: p.x, y, vy: p.vy, squash: p.squash,
      deathKind: p.deathKind, deathT: p.deathT, stateT: this.stateT,
      light: { dark, rim, rimA: Math.max(P.rimA * (1 - inT), inT * (0.35 + lamp * 0.5)) },
    };
  }

  render(alpha) {
    const ctx = this.ctx, w = this.world;
    const S = this.pixelScale;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const D = w.prevD + (w.D - w.prevD) * alpha;
    const t = w.time;
    const P = this.palette();
    const shake = this.fx.shake > 0 ? Math.sin(t * 90) * this.fx.shake * 5 : 0;
    const bob = this.bob + this.bump + shake;

    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);

    // ---- outside the glass
    ctx.save();
    ctx.beginPath();
    glassPath(ctx, -12);
    ctx.clip();
    this.sky.draw(ctx, P, t);
    ctx.translate(0, bob);
    for (let i = 0; i < 4; i++) this.parallax.drawLayer(ctx, P, i, t);
    drawSections(ctx, w, D, t, P);
    drawPlayLane(ctx, w, D, t, P);
    drawHazards(ctx, w, D, t, P);
    this.fx.drawParticles(ctx);
    drawTunnelDarkness(ctx, w, D);
    drawTunnelMarkers(ctx, w, D, t);
    const foreBiome = w.gen.biomeAt(D - PLAYER.x).id;
    this.parallax.drawForeground(ctx, P, foreBiome, w.speed);
    this.parallax.drawStreaks(ctx, w.speed);
    ctx.restore();

    // ---- the glass itself, then the kid's hand in front of it
    this.windowFrame.drawGlass(ctx, S);
    this.fx.drawSplats(ctx);
    if (this.state === 'title' || this.state === 'starting') this.fog.draw(ctx, S, t, this.state === 'title' ? 1 : this.fogAlpha);
    if (this.state !== 'title') {
      ctx.save();
      ctx.translate(0, bob);
      const hs = this.handState(alpha, P);
      if (this.state === 'starting') hs.state = 'run';
      drawHand(ctx, hs, t);
      ctx.restore();
    }
    this.fx.drawFlash(ctx);
    this.windowFrame.drawFrame(ctx, S, P.ambient, (w.inTunnel ?? 0) * (0.3 + (w.tunnelLamp ?? 0)));

    // ---- UI on the glass
    if (this.state === 'starting') drawHUD(ctx, this, smoothstep(0.3, 0.9, this.stateT));
    else if (this.state !== 'title') drawHUD(ctx, this);
    if (this.state === 'title') drawPressSpace(ctx, t, smoothstep(1.6, 2.6, this.fog.writeT), this.best, !document.hasFocus());
    if (this.state === 'dead') drawGameOver(ctx, this, this.stateT);
    if (this.debug) this.renderDebug(ctx, P);
  }

  renderDebug(ctx, P) {
    const p = this.player, w = this.world;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '13px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(FRAME.left + 6, FRAME.top + 6, 370, 132);
    ctx.fillStyle = '#9f9';
    const lines = [
      `fps ${this.fps.toFixed(0)}  state ${this.state}/${p.state}`,
      `speed ${w.speed.toFixed(0)}${w.speedOverride ? ' (override)' : ''}  D ${w.D.toFixed(0)}`,
      `run ${w.runTime.toFixed(1)}s  seed ${this.seed}  diff ${w.gen.difficultyAt(w.D).toFixed(2)}`,
      `biome ${w.gen.biomeAt(w.D).id}  gen ${w.gen.lastPattern}`,
      `time of day ${P.name} (${(P.phase % 1).toFixed(2)})`,
      `inv ${this.invincible ? 'ON' : 'off'}  surf ${w.surfaces.length} haz ${w.hazards.length} pend ${w.pending.length}`,
      '[ ] speed  \\ reset  I invincible  N biome  T time',
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
