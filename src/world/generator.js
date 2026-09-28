// Chunk-based procedural level generation with a reachability guarantee.
//
// Everything is placed on the D axis (see entities.js). A gap between two surfaces is measured in D;
// a full jump with airtime τ at speed S covers S·τ of D whatever the surfaces' own speed factors,
// so one rule covers rooftops, cars, trucks and trains alike:
//     gapD ≤ S(D) · airtimeTo(Δy) · (1 − GEN.reachSafety)
import { GEN, SPEED, PLAYER, DIFFICULTY, VIEW } from '../config.js';
import { Surface, Decor } from './entities.js';
import { RNG, clamp, lerp } from '../util.js';
import { BIOMES, BIOME_ORDER, PATTERNS } from './biomes.js';
import { airtimeTo, jumpApex } from '../player.js';
import { VEHICLES, ROAD_Y } from './vehicles.js';

const APEX = jumpApex();

export function catenaryProfile(y0, y1, span, sag, n = 14) {
  // Solve a·(cosh(span/2a) − 1) = sag for the catenary parameter a.
  let lo = 1, hi = 1e7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = mid * (Math.cosh(span / (2 * mid)) - 1);
    if (f > sag) lo = mid; else hi = mid;
  }
  const a = (lo + hi) / 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (span * i) / n;
    const u = x - span / 2;
    const dip = sag - a * (Math.cosh(u / a) - 1);
    pts.push([x, lerp(y0, y1, x / span) + dip]);
  }
  return pts;
}

export class Generator {
  constructor(seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.mode = 'attract';
    this.cursorD = 0;
    this.lastTop = 470;
    this.runStartD = null;
    this.biomes = [{ startD: -Infinity, id: 'country', loop: 0 }];
    this.nextBiomeD = Infinity;
    this.biomeIndex = 0;
    this.loop = 0;
    this.lastPattern = null;
    this.segLog = [];        // [{d0, d1, s}] recent surfaces in D order (for hazard placement + validation)
    this.gapLog = [];        // [{d, gap, reach, dy}] every generated gap, for tools/gen-check
    this.hazardLog = [];     // [{d0, d1, kind, needs}] for tools/gen-check
    this.lastHazardD = -Infinity;
    this.blockHazardsUntil = -Infinity;
    this.pendingRunway = false;
    this.ids = 0;
    this.keepAll = typeof process !== 'undefined'; // tools/gen-check keeps every surface
    this.allSurfaces = [];
  }

  attach(world) { this.world = world; }

  // ---- speed / difficulty prediction (speed is a pure function of run distance; see main.targetSpeed)
  speedAt(D) {
    if (this.runStartD == null || D < this.runStartD) return SPEED.attract;
    const d = D - this.runStartD;
    return Math.min(SPEED.max, Math.sqrt(SPEED.start * SPEED.start + 2 * SPEED.ramp * d));
  }
  runTimeAt(D) {
    if (this.runStartD == null || D < this.runStartD) return 0;
    return (this.speedAt(D) - SPEED.start) / SPEED.ramp; // exact while below the cap
  }
  difficultyAt(D) {
    const t = this.runTimeAt(D);
    return clamp(t / DIFFICULTY.rampSec, 0, 1) + this.loop * 0.15;
  }
  biomeAt(D) {
    let b = this.biomes[0];
    for (const s of this.biomes) if (s.startD <= D) b = s;
    return b;
  }

  // ---- reachability
  reach(dy, D) { return this.speedAt(D) * airtimeTo(dy) * (1 - GEN.reachSafety); }
  maxRise() { return APEX * GEN.maxRise; }
  clampTop(top) {
    top = clamp(top, GEN.surfaceTopMin, GEN.surfaceTopMax);
    return Math.max(top, this.lastTop - this.maxRise());
  }
  // Pick a gap (in D) before a surface whose leading top is `top`, as a fraction of the safe reach.
  gapTo(top, frac = null) {
    const dy = top - this.lastTop;
    const reach = this.reach(dy, this.cursorD);
    const diff = Math.min(1, this.difficultyAt(this.cursorD));
    if (frac == null) {
      const lo = lerp(DIFFICULTY.gapFrac[0][0], DIFFICULTY.gapFrac[1][0], diff);
      const hi = lerp(DIFFICULTY.gapFrac[0][1], DIFFICULTY.gapFrac[1][1], diff);
      frac = this.rng.float(lo, hi);
    }
    const minGap = GEN.minGapSec * this.speedAt(this.cursorD);
    const gap = clamp(reach * frac, Math.min(minGap, reach), reach);
    this.gapLog.push({ d: this.cursorD, gap, reach, dy, speed: this.speedAt(this.cursorD) });
    return gap;
  }

  // ---- placement
  push(s) {
    s.id = this.ids++;
    if (this.keepAll && s.profile) this.allSurfaces.push(s);
    this.world.add(s);
    return s;
  }
  pushSurface(s, { advance = true, hazardOk = true } = {}) {
    this.push(s);
    if (advance) {
      this.cursorD = Math.max(this.cursorD, s.dTail);
      this.lastTop = s.profile[s.profile.length - 1][1];
    }
    this.segLog.push({ d0: s.dLead, d1: s.dTail, s, hazardOk });
    if (this.segLog.length > 200) this.segLog.splice(0, 100);
    return s;
  }
  // The surface covering D at the fingers, if any (from the recent log).
  surfaceAtD(D) {
    for (let i = this.segLog.length - 1; i >= 0; i--) {
      const g = this.segLog[i];
      if (g.d0 <= D && g.d1 >= D) return g;
    }
    return null;
  }

  // ---- run lifecycle
  // Title screen -> run: drop everything not yet visible, then lay a safe runway.
  // Drop everything that hasn't been spawned yet, so new content starts just past the right edge.
  truncateAhead(D) {
    const w = this.world;
    const cutD = D + (VIEW.W + GEN.spawnMargin - PLAYER.x);
    const keep = (e) => e.dLead <= cutD && e.spawnD <= D;
    w.pending = w.pending.filter(keep);
    this.segLog = this.segLog.filter((g) => keep(g.s));
    if (this.keepAll) this.allSurfaces = this.allSurfaces.filter(keep);
    this.cursorD = D;
    for (const g of this.segLog) this.cursorD = Math.max(this.cursorD, g.d1);
    const last = this.segLog.reduce((a, g) => (!a || g.d1 > a.d1 ? g : a), null);
    if (last) this.lastTop = last.s.profile[last.s.profile.length - 1][1];
    this.blockHazardsUntil = -Infinity;
  }

  beginRun(D) {
    this.truncateAhead(D);
    this.mode = 'play';
    this.runStartD = D;
    this.loop = 0;
    this.biomeIndex = 0;
    this.biomes = [{ startD: -Infinity, id: 'country', loop: 0 }];
    this.nextBiomeD = D + GEN.biomeSec * SPEED.start;
    this.blockHazardsUntil = this.cursorD + GEN.startRunwaySec * SPEED.start;
    this.buildRunway(BIOMES.country, GEN.startRunwaySec, true);
  }

  // Fresh run with no attract content (restart): runway directly under the fingers. Returns top y.
  startRunway(world) {
    this.mode = 'play';
    this.runStartD = world.D;
    this.nextBiomeD = world.D + GEN.biomeSec * SPEED.start;
    this.cursorD = world.D - 500;
    this.lastTop = 470;
    this.buildRunway(BIOMES.country, GEN.startRunwaySec + 500 / SPEED.start, true);
    this.blockHazardsUntil = this.cursorD;
    return this.segLog[0].s.topAtLocal(PLAYER.x - this.segLog[0].s.left(world.D));
  }

  skipBiome() {
    this.truncateAhead(this.world.D);
    this.enterNextBiome();
  }

  fill(untilD) {
    let guard = 0;
    while (this.cursorD < untilD && guard++ < 50) {
      if (this.mode === 'attract') { this.builders.wires.call(this, { spans: [6, 9], missing: 0 }, BIOMES.country, { attract: true }); continue; }
      if (this.cursorD >= this.nextBiomeD) this.enterNextBiome();
      const seg = this.biomeAt(this.cursorD);
      const biome = BIOMES[seg.id];
      const diff = this.difficultyAt(this.cursorD);
      const choices = Object.entries(biome.patterns)
        .map(([id, wt]) => ({ id, wt, p: PATTERNS[id] }))
        .filter((c) => c.p && diff >= c.p.minDiff && this.builders[c.p.builder]);
      if (this.forcePattern && PATTERNS[this.forcePattern]) choices.splice(0, choices.length, { id: this.forcePattern, wt: 1, p: PATTERNS[this.forcePattern] });
      const pick = this.rng.weighted(choices, (c) => c.wt * (c.id === this.lastPattern ? 0.35 : 1));
      this.lastPattern = pick.id;
      const before = this.segLog.length;
      this.builders[pick.p.builder].call(this, pick.p, biome, {});
      this.placeHazards?.(pick.p, biome, before);
    }
  }

  enterNextBiome() {
    this.biomeIndex++;
    const id = BIOME_ORDER[this.biomeIndex % BIOME_ORDER.length];
    if (this.biomeIndex % BIOME_ORDER.length === 0) this.loop++;
    this.biomes.push({ startD: this.cursorD, id, loop: this.loop });
    if (this.biomes.length > 8) this.biomes.splice(1, 1);
    this.nextBiomeD = this.cursorD + GEN.biomeSec * this.speedAt(this.cursorD);
    this.buildRunway(BIOMES[id], GEN.runwaySec, true);
  }

  // A long, hazard-free, biome-appropriate surface.
  buildRunway(biome, sec, safe) {
    const len = sec * this.speedAt(this.cursorD);
    const kind = biome.fore === 'guardrail' ? 'barrier' : biome === BIOMES.country ? 'wires' : 'roof';
    const d0 = this.cursorD;
    if (kind === 'wires') {
      const spans = Math.max(2, Math.ceil(len / 240));
      this.builders.wires.call(this, { spans: [spans, spans], missing: 0 }, biome, { safe, first: this.segLog.length === 0 });
    } else if (kind === 'barrier') {
      const top = this.clampTop(530);
      const gap = this.segLog.length ? this.gapTo(top, 0.4) : 0;
      this.pushSurface(new Surface({ kind: 'barrier', dLead: this.cursorD + gap, w: len, top, biome: biome.name }), { hazardOk: !safe });
    } else {
      const top = this.clampTop(biome === BIOMES.city ? 440 : 500);
      const gap = this.segLog.length ? this.gapTo(top, 0.4) : 0;
      this.pushSurface(this.makeRoof(this.cursorD + gap, len, top, biome, { style: 'flat' }), { hazardOk: !safe });
    }
    if (safe) this.blockHazardsUntil = Math.max(this.blockHazardsUntil, this.cursorD);
    return d0;
  }

  makeRoof(dLead, w, top, biome, o = {}) {
    const r = this.rng;
    const style = o.style ?? r.pick(['flat', 'flat', 'flat', 'slope', 'parapet']);
    let profile = [[0, top], [w, top]];
    if (style === 'slope') {
      const dh = r.float(10, 26) * (r.chance(0.5) ? 1 : -1);
      profile = [[0, top + Math.max(0, dh)], [w, top + Math.max(0, -dh)]];
    }
    return new Surface({
      kind: 'roof', dLead, w, profile, biome: biome.name,
      data: { style, seed: r.int(0, 1e6), tall: !!o.tall, city: biome === BIOMES.city },
    });
  }
}

// ---------------------------------------------------------------------------
// Builders. `this` is the Generator. Each advances cursorD and lastTop.
Generator.prototype.builders = {
  wires(p, biome, o = {}) {
    const r = this.rng;
    const spans = r.int(p.spans[0], p.spans[1]);
    const missing = new Set();
    if (p.missing && !o.safe && !o.attract) {
      const nMiss = r.int(p.missing[0], p.missing[1]);
      for (let i = 0; i < nMiss; i++) missing.add(r.int(1, Math.max(1, spans - 2)));
    }
    const capW = 28;
    let top = this.clampTop(o.attract ? r.float(440, 470) : this.lastTop + r.float(-30, 30));
    top = clamp(top, 390, 520);
    // first pole
    let gap = this.segLog.length && !o.first ? this.gapTo(top) : 0;
    if (o.attract && this.segLog.length) gap = 0; // continuous during attract (safe start)
    let poleD = this.cursorD + gap + capW / 2;
    let prevTop = top;
    const addPole = (d, t) => {
      this.push(new Decor({ kind: 'pole', dLead: d - 6, w: 12, biome: biome.name, data: { top: t, seed: r.int(0, 1e6) } }));
      const cap = new Surface({ kind: 'polecap', dLead: d - capW / 2, w: capW, top: t, material: 'wood', biome: biome.name });
      this.pushSurface(cap);
    };
    addPole(poleD, prevTop);
    for (let i = 0; i < spans; i++) {
      let nextTop = clamp(prevTop + r.float(-22, 22), 390, 525);
      if (missing.has(i)) {
        this.lastTop = prevTop;
        this.cursorD = poleD + capW / 2;
        nextTop = this.clampTop(nextTop);
        const g = this.gapTo(nextTop);
        const nextD = this.cursorD + g + capW / 2;
        addPole(nextD, nextTop);
        poleD = nextD; prevTop = nextTop;
        continue;
      }
      const span = r.float(210, 290);
      const nextD = poleD + span;
      const sag = span * r.float(0.07, 0.1);
      const profile = catenaryProfile(prevTop, nextTop, span, sag);
      const wire = new Surface({ kind: 'wire', dLead: poleD, w: span, profile, material: 'wire', biome: biome.name, data: { sag } });
      this.pushSurface(wire);
      addPole(nextD, nextTop);
      poleD = nextD; prevTop = nextTop;
    }
    this.cursorD = poleD + capW / 2;
    this.lastTop = prevTop;
  },

  roofs(p, biome) {
    const r = this.rng;
    const n = r.int(p.count[0], p.count[1]);
    for (let i = 0; i < n; i++) {
      const w = r.float(p.w[0], p.w[1]);
      let top = i === 0 ? r.float(p.tops[0], p.tops[1]) : this.lastTop + r.float(-p.dy, p.dy);
      top = this.clampTop(clamp(top, p.tops[0], p.tops[1]));
      const gap = this.gapTo(top);
      const roof = this.makeRoof(this.cursorD + gap, w, top, biome, { tall: p.tall });
      this.pushSurface(roof);
    }
  },

  cars(p, biome) {
    const r = this.rng;
    const n = r.int(p.count[0], p.count[1]);
    const k = r.float(p.k[0], p.k[1]);
    const lights = r.int(0, 1e6);
    for (let i = 0; i < n; i++) {
      const type = r.pick(['sedan', 'sedan', 'hatch', 'van']);
      this.placeVehicle(type, k, biome, { paint: r.int(0, 7), lights });
    }
  },
};

// Place one vehicle (possibly multi-part, e.g. truck trailer + cab) after the cursor.
Generator.prototype.placeVehicle = function (type, k, biome, data = {}) {
  const v = VEHICLES[type];
  const parts = v.parts;
  const firstTop = ROAD_Y - parts[0].profile[0][1];
  const gap = this.gapTo(this.clampTop(firstTop));
  const baseD = this.cursorD + gap;
  let offset = 0;
  const made = [];
  const vehicle = { type, k, data };
  for (const part of parts) {
    const profile = part.profile.map(([x, h]) => [x, ROAD_Y - h]);
    const s = new Surface({
      kind: 'vehicle', k, dLead: baseD + (offset + (part.x ?? 0)) / k, w: part.w, profile,
      material: part.material ?? 'metal', biome: biome.name,
      data: { vehicle, part: part.name, type },
    });
    made.push(s);
  }
  // body decor (drawn once per vehicle, from the first part's position)
  vehicle.parts = made;
  for (const s of made) this.pushSurface(s);
  return made;
};
