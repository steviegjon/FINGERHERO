// Lo-fi road-trip audio, all synthesised with Web Audio: music loop, vinyl crackle, road hum,
// wire hum and SFX. Nothing plays until the first keypress (browsers require a gesture).
import { AUDIO, SPEED } from './config.js';
import { clamp } from './util.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Chord sets per biome (MIDI notes, 4-chord loop). The city opens the filter up.
const PROGRESSIONS = [
  [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], // Fmaj7 Em7 Dm7 Cmaj7
  [[48, 52, 55, 59], [45, 48, 52, 55], [50, 53, 57, 60], [43, 50, 53, 57]], // Cmaj7 Am7 Dm7 G7sus
  [[51, 55, 58, 62], [50, 53, 57, 60], [48, 51, 55, 58], [46, 50, 53, 57]], // Ebmaj7 Dm7 Cm7 Bbmaj7
  [[44, 48, 51, 55], [43, 46, 50, 53], [41, 44, 48, 51], [39, 43, 46, 50]], // Abmaj7 Gm7 Fm7 Ebmaj7
];
const BIOME_INDEX = { country: 0, town: 1, highway: 2, city: 3 };

export class Audio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.biome = 'country';
    this.filterTarget = 1400;
    this.nextBeatTime = 0;
    this.beat = 0;
    this.wireHum = 0;
    this.inTunnel = 0;
  }

  // Call from a keydown handler. (A context can be passed in, e.g. an OfflineAudioContext for tests.)
  start(ctx = null) {
    if (this.started) { if (this.ctx?.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !ctx) return;
    try { this.ctx = ctx ?? new AC(); } catch { return; }
    this.started = true;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = AUDIO.master;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp).connect(c.destination);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.18;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // music bus: warm low-pass, a little room
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 1400;
    this.musicFilter.Q.value = 0.4;
    this.music = c.createGain();
    this.music.gain.value = AUDIO.music;
    this.musicFilter.connect(this.music).connect(this.master);
    this.music.connect(this.reverbSend);

    this.sfx = c.createGain();
    this.sfx.gain.value = AUDIO.sfx;
    this.sfx.connect(this.master);
    this.sfxWet = c.createGain();
    this.sfxWet.gain.value = 0;
    this.sfx.connect(this.sfxWet).connect(this.reverb);

    this.noise = this.makeNoise(2, 'white');
    this.brown = this.makeNoise(4, 'brown');

    // vinyl crackle loop
    const crackle = c.createBufferSource();
    crackle.buffer = this.makeCrackle(5);
    crackle.loop = true;
    const cf = c.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 3000; cf.Q.value = 0.5;
    const cg = c.createGain(); cg.gain.value = AUDIO.crackle;
    crackle.connect(cf).connect(cg).connect(this.master);
    crackle.start();

    // road hum: brown noise, low-passed; pitch & level follow speed
    const road = c.createBufferSource();
    road.buffer = this.brown; road.loop = true;
    this.roadFilter = c.createBiquadFilter(); this.roadFilter.type = 'lowpass'; this.roadFilter.frequency.value = 220;
    this.roadGain = c.createGain(); this.roadGain.gain.value = 0;
    road.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
    road.start();
    // tunnel roar: band-passed noise that swells inside tunnels
    const roar = c.createBufferSource();
    roar.buffer = this.noise; roar.loop = true;
    this.roarFilter = c.createBiquadFilter(); this.roarFilter.type = 'bandpass'; this.roarFilter.frequency.value = 500; this.roarFilter.Q.value = 0.7;
    this.roarGain = c.createGain(); this.roarGain.gain.value = 0;
    roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master);
    this.roarGain.connect(this.reverbSend);
    roar.start();
    // wire hum (60Hz-ish mains buzz), faint
    this.humGain = c.createGain(); this.humGain.gain.value = 0;
    for (const [f, a] of [[120, 1], [240, 0.5], [360, 0.25]]) {
      const o = c.createOscillator(); o.frequency.value = f;
      const g = c.createGain(); g.gain.value = a * 0.03;
      o.connect(g).connect(this.humGain); o.start();
    }
    this.humGain.connect(this.master);

    this.nextBeatTime = c.currentTime + 0.1;
  }

  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(sec, type) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  makeCrackle(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.04;
      if (Math.random() < 0.0006) { const a = Math.random() * 0.9 + 0.1; for (let k = 0; k < 30 && i + k < len; k++) d[i + k] += a * (Math.random() * 2 - 1) * Math.exp(-k / 6); }
    }
    return buf;
  }

  // ---- per-frame: schedule music ahead, follow speed / tunnel / wire
  update(dt, info) {
    if (!this.started) return;
    const c = this.ctx, now = c.currentTime;
    if (info.biome && info.biome !== this.biome) this.biome = info.biome;
    const sp = clamp((info.speed - SPEED.attract) / (SPEED.max - SPEED.attract), 0, 1);
    const tun = info.tunnel ?? 0;
    const playing = info.playing;
    const roadLevel = (playing ? 0.5 + 0.5 * sp : 0.35) * AUDIO.road * (info.frozen ? 0 : 1);
    this.roadGain.gain.setTargetAtTime(roadLevel * (1 + tun * 0.6), now, 0.3);
    this.roadFilter.frequency.setTargetAtTime(170 + sp * 260 + tun * 200, now, 0.3);
    this.roarGain.gain.setTargetAtTime(tun * 0.16 * (info.frozen ? 0 : 1), now, 0.25);
    this.reverbSend.gain.setTargetAtTime(0.18 + tun * 0.5, now, 0.3);
    this.sfxWet.gain.setTargetAtTime(tun * 0.6, now, 0.2);
    this.humGain.gain.setTargetAtTime(info.onWire ? 0.9 : 0, now, 0.12);
    const cityOpen = this.biome === 'city' ? 900 : 0;
    const base = [1300, 1600, 1900, 2300][BIOME_INDEX[this.biome] ?? 0];
    const target = (info.dead ? 700 : base + cityOpen + sp * 500) * (1 - tun * 0.45);
    this.musicFilter.frequency.setTargetAtTime(target, now, 0.8);

    // music scheduler (80 BPM, swung 8ths, one chord per bar)
    const spb = 60 / AUDIO.bpm;
    if (this.nextBeatTime < now - 0.5) this.nextBeatTime = now + 0.05;
    while (this.nextBeatTime < now + 0.25) {
      this.scheduleBeat(this.beat, this.nextBeatTime, spb);
      this.nextBeatTime += spb;
      this.beat++;
    }
  }

  scheduleBeat(beat, t, spb) {
    const prog = PROGRESSIONS[BIOME_INDEX[this.biome] ?? 0];
    const bar = Math.floor(beat / 4), b = beat % 4;
    const chord = prog[bar % 4];
    const swing = spb * 0.58;
    if (b === 0) {
      this.epiano(chord, t, spb * 2.6, 0.13);
      this.bass(chord[0] - 12, t, spb * 3.5);
    }
    if (b === 1 && bar % 2 === 1) this.epiano(chord, t + swing, spb * 1.6, 0.08);
    if (b === 2) this.epiano(chord.slice(1), t, spb * 1.4, 0.07);
    // a lazy melody note now and then
    if ((b === 1 || b === 3) && Math.random() < 0.35) {
      const scale = [0, 2, 4, 7, 9, 12];
      const n = chord[0] + 12 + scale[Math.floor(Math.random() * scale.length)];
      this.lead(n, t + (Math.random() < 0.5 ? 0 : swing), spb * 0.9);
    }
    // drums
    if (b === 0 || (b === 2 && bar % 2 === 0)) this.kick(t);
    if (b === 2 && bar % 2 === 1) this.kick(t + swing);
    if (b === 1 || b === 3) this.snare(t);
    this.hat(t, 0.045);
    this.hat(t + swing, 0.03);
  }

  voice(freq, t, dur, gain, type = 'sine', detune = 0, dest = this.musicFilter) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  epiano(notes, t, dur, gain) {
    for (const n of notes) {
      const f = midi(n);
      this.voice(f, t, dur, gain * 0.55, 'sine', -5);
      this.voice(f, t, dur, gain * 0.35, 'triangle', 6);
      this.voice(f * 2, t, dur * 0.4, gain * 0.08, 'sine', 3); // tine
    }
  }
  bass(n, t, dur) { this.voice(midi(n), t, dur, 0.16, 'sine'); this.voice(midi(n) * 2, t, dur * 0.5, 0.03, 'triangle'); }
  lead(n, t, dur) { this.voice(midi(n), t, dur, 0.035, 'triangle', 4); }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.musicFilter);
    o.start(t); o.stop(t + 0.35);
  }
  noiseHit(t, dur, gain, type, freq, q, dest) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
    return { f, g };
  }
  snare(t) { this.noiseHit(t, 0.18, 0.08, 'bandpass', 1900, 0.8, this.musicFilter); }
  hat(t, gain) { this.noiseHit(t, 0.05, gain, 'highpass', 7000, 0.7, this.music); }

  // ---- SFX -----------------------------------------------------------------
  get t() { return this.ctx.currentTime; }

  tap(material = 'hard') {
    if (!this.started) return;
    const t = this.t;
    const pitch = { hard: 1, metal: 1.6, wire: 2, tree: 0.7, wood: 1.2 }[material] ?? 1;
    this.noiseHit(t, 0.03, 0.12, 'bandpass', 1500 * pitch * (0.9 + Math.random() * 0.2), 2, this.sfx);
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 420 * pitch * (0.92 + Math.random() * 0.16);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.06);
  }

  jump() {
    if (!this.started) return;
    const t = this.t;
    const { f } = this.noiseHit(t, 0.16, 0.16, 'bandpass', 700, 3, this.sfx);
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
  }

  land(material, bouncy) {
    if (!this.started) return;
    const c = this.ctx, t = this.t;
    if (bouncy) {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      lfo.frequency.value = 18; lg.gain.value = 25;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(this.sfx);
      o.start(t); lfo.start(t); o.stop(t + 0.36); lfo.stop(t + 0.36);
      this.noiseHit(t, 0.2, 0.06, 'bandpass', 3500, 1, this.sfx); // leaves
      return;
    }
    if (material === 'wire') {
      // tiny twang: a plucked triangle with a bend
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(196, t);
      o.frequency.exponentialRampToValueAtTime(170, t + 0.4);
      f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.4);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t); o.stop(t + 0.52);
    }
    this.tap(material);
    this.noiseHit(t, 0.07, 0.12, 'lowpass', 900, 0.5, this.sfx);
  }

  whoosh(big = false, pan = -0.3) {
    if (!this.started) return;
    const c = this.ctx, t = this.t;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(big ? 1400 : 2200, t);
    f.frequency.exponentialRampToValueAtTime(big ? 260 : 500, t + (big ? 0.7 : 0.4));
    const g = c.createGain();
    const dur = big ? 0.8 : 0.45;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(big ? 0.22 : 0.1, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.setValueAtTime(0.6, t); p.pan.linearRampToValueAtTime(pan, t + dur); s.connect(f).connect(g).connect(p).connect(this.sfx); }
    else s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  splat() {
    if (!this.started) return;
    const c = this.ctx, t = this.t;
    this.noiseHit(t, 0.12, 0.3, 'lowpass', 1200, 1, this.sfx);
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.18);
  }

  thunk() {
    if (!this.started) return;
    const c = this.ctx, t = this.t;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.27);
    this.noiseHit(t, 0.05, 0.2, 'lowpass', 2500, 0.5, this.sfx);
  }

  drop() {
    if (!this.started) return;
    const c = this.ctx, t = this.t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(720, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.55);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.62);
  }

  flutter() {
    if (!this.started) return;
    const t = this.t;
    for (let i = 0; i < 6; i++) this.noiseHit(t + i * 0.045, 0.035, 0.05, 'bandpass', 1100 + i * 80, 1.5, this.sfx);
  }

  slide() {
    if (!this.started) return;
    const t = this.t;
    const { f } = this.noiseHit(t, 0.22, 0.06, 'bandpass', 2400, 1.5, this.sfx);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.2);
  }
}
