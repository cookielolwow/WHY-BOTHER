/**
 * AudioSpaceSynth — v4 REMASTERED
 * Motor de audio atmosférico estilo "Interstellar" + Hip-Hop Beat psicodélico
 *
 * Cadena de señal (master bus):
 *   Fuentes individuales → Gain individual → drumBus / padBus / noiseBus
 *   → masterLimiter (hard limiter -1dBFS) → masterGain → ctx.destination
 *
 * Principios de mezcla:
 *   - Cada instrumento tiene su propio GainNode de nivel fijo (≤ 0.8)
 *   - masterGain sube suavemente de 0 → 0.72 con energía (NO > 0.72)
 *   - LowPass filter sweeps de 200 Hz → 16 kHz (no 18k que puede resonar)
 *   - WaveShaper de distorsión SOLO en la rama de glitch noise (no en drums)
 *   - DynamicsCompressor con ratio 8:1 agresivo como safety net
 *   - Hard limiter (WaveShaper de clip) en el master antes del output
 */
export class AudioSpaceSynth {
  constructor() {
    this.ctx        = null;
    this.inited     = false;
    this.playing    = false;

    // Estado DJ
    this._energy          = 0;
    this._angularVelocity = 0;
    this._beatSec         = 60 / 90;   // ~0.667s por beat a 90 BPM
    this._nextBeat        = 0;
    this._beatIndex       = 0;
    this._barIndex        = 0;
    this._schedulerTimer  = null;
    this._lastBPM         = 90;

    // Nodos de master bus
    this.masterGain   = null;  // volumen maestro 0→0.72
    this.masterLPF    = null;  // lowpass 200Hz→16kHz
    this.masterComp   = null;  // compresor safety net
    this.masterLimiter= null;  // hard clip limiter

    // Buses de submix
    this.drumBus  = null;   // todos los drums → aquí
    this.padBus   = null;   // pad / melodía → aquí
    this.noiseBus = null;   // glitch + crackle → aquí

    // Reverb
    this.convolver  = null;
    this.reverbSend = null;

    // Pad
    this.padGain       = null;
    this.padOscs       = [];
    this._padChords    = [];
    this._padChordIdx  = 0;
    this._padChordTimer= 0;
    this._padChordDur  = 8;

    // Glitch / crackle / scratch
    this.glitchGain  = null;
    this.crackleGain = null;
    this.scratchGain = null;
    this.scratchBpf  = null;

    // Distorsión (solo para el noiseBus)
    this.noiseShaper = null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════════════ */
  async init() {
    if (this.inited) return;
    this.inited = true;

    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    /* ────────────────────────────────────────────
       MASTER BUS (derecho a izquierda en el grafo)
    ──────────────────────────────────────────── */

    // 4. Output — Hard limiter (WaveShaper clip a ±0.95)
    this.masterLimiter = ctx.createWaveShaper();
    this.masterLimiter.curve = this._clipCurve(0.95);
    this.masterLimiter.oversample = '4x';
    this.masterLimiter.connect(ctx.destination);

    // 3. DynamicsCompressor — safety net, ratio alto
    this.masterComp = ctx.createDynamicsCompressor();
    this.masterComp.threshold.value = -18;
    this.masterComp.knee.value      = 8;
    this.masterComp.ratio.value     = 10;
    this.masterComp.attack.value    = 0.002;
    this.masterComp.release.value   = 0.18;
    this.masterComp.connect(this.masterLimiter);

    // 2. Master Gain — nunca pasa de 0.72
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.masterComp);

    // 1. Master LowPass filter
    this.masterLPF = ctx.createBiquadFilter();
    this.masterLPF.type = 'lowpass';
    this.masterLPF.frequency.value = 200;
    this.masterLPF.Q.value = 0.8;
    this.masterLPF.connect(this.masterGain);

    /* ────────────────────────────────────────────
       SUBMIX BUSES (todos conectan al masterLPF)
    ──────────────────────────────────────────── */

    // Drum bus — level -6dB (0.5)
    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.50;
    this.drumBus.connect(this.masterLPF);

    // Pad bus — level -9dB (0.35)
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.35;
    this.padBus.connect(this.masterLPF);

    // Noise bus → WaveShaper distorsión → masterLPF
    this.noiseShaper = ctx.createWaveShaper();
    this.noiseShaper.curve = this._distCurve(0); // empieza limpio
    this.noiseShaper.oversample = '2x';
    this.noiseShaper.connect(this.masterLPF);

    this.noiseBus = ctx.createGain();
    this.noiseBus.gain.value = 0.30;
    this.noiseBus.connect(this.noiseShaper);

    /* ────────────────────────────────────────────
       REVERB SEND (solo para pad + lead)
    ──────────────────────────────────────────── */
    await this._buildReverb();

    /* ────────────────────────────────────────────
       FUENTES DE AUDIO
    ──────────────────────────────────────────── */
    this._buildPad();
    this._buildGlitchNoise();
    this._buildCrackle();
    this._buildScratch();
  }

  /* ── Hard clip limiter curve (clips at ±peak) ── */
  _clipCurve(peak = 0.95) {
    const n = 512;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = Math.max(-peak, Math.min(peak, x));
    }
    return c;
  }

  /* ── Soft distortion curve (0 = identity, 200 = heavy) ── */
  _distCurve(amount) {
    const n = 512;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      if (amount < 0.01) {
        c[i] = x;
      } else {
        // Arctangent soft clip — sounds warmer than naive clip
        c[i] = (2 / Math.PI) * Math.atan(x * (amount / 50));
      }
    }
    return c;
  }

  /* ── Cosmic reverb IR ── */
  async _buildReverb() {
    const SR  = this.ctx.sampleRate;
    const dur = 3.5;
    const len = Math.floor(SR * dur);
    const buf = this.ctx.createBuffer(2, len, SR);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 1.1) * (c === 0 ? 1 : 0.9);
      }
    }
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = buf;

    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0;

    // Reverb output at low level into padBus
    const reverbOut = this.ctx.createGain();
    reverbOut.gain.value = 0.28;
    this.convolver.connect(this.reverbSend);
    this.reverbSend.connect(reverbOut);
    reverbOut.connect(this.padBus);
  }

  /* ── Pad: acordes de órgano cósmico estilo Interstellar ── */
  _buildPad() {
    // Am pentatonic voicings (lower register for warmth, not brightness)
    this._padChords = [
      [55.0, 65.4, 82.4, 98.0],   // Am sus2
      [43.7, 55.0, 73.4, 87.3],   // Fmaj7
      [36.7, 55.0, 65.4, 87.3],   // Cmaj9
      [49.0, 61.7, 73.4, 98.0],   // G6
    ];

    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0;

    // Tape-style delay for depth (NOT feedback that runs away)
    const padDelay = this.ctx.createDelay(1.0);
    padDelay.delayTime.value = 0.38;
    const padFB = this.ctx.createGain();
    padFB.gain.value = 0.28;  // safe feedback < 0.5
    padDelay.connect(padFB);
    padFB.connect(padDelay);

    const padLP = this.ctx.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.value = 800;
    padLP.Q.value = 0.5;

    this.padGain.connect(padLP);
    padLP.connect(this.padBus);
    padLP.connect(padDelay);
    padDelay.connect(this.padBus);
    padLP.connect(this.convolver); // reverb send

    this._spawnPadChord(this._padChords[0]);
  }

  _spawnPadChord(freqs) {
    this.padOscs.forEach(o => { try { o.stop(); } catch (_) {} });
    this.padOscs = [];
    for (const freq of freqs) {
      // 1 saw detuned + 1 sine octave up — fewer oscillators = less buildup
    for (const freq of freqs) {
      // 3 triangle oscillators per note detuned at -4, 0, +4 cents (chorus effect)
      const detunes = [-4, 0, 4];
      for (const cents of detunes) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        // Individual gain per oscillator (4 freqs × 3 = 12 oscs)
        const oscGain = this.ctx.createGain();
        oscGain.gain.value = 0.12;
        // Gentle LFO tremolo at ~0.8Hz, depth 0.08
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 0.8;
        lfoGain.gain.value = 0.08;
        lfo.connect(lfoGain);
        lfoGain.connect(oscGain.gain);
        lfo.start();
        osc.connect(oscGain);
        oscGain.connect(this.padGain);
        osc.start();
        this.padOscs.push(osc, lfo);
      }
    }
    }
  }

  /* ── Glitch noise: broken machine at low energy ── */
  _buildGlitchNoise() {
    const SR  = this.ctx.sampleRate;
    const len = Math.floor(SR * 4);
    const buf = this.ctx.createBuffer(1, len, SR);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const r = Math.random();
      // Sparse pops at low amplitude — the WaveShaper will add harmonics
      if (r < 0.0004)      d[i] = (Math.random() * 2 - 1) * 0.4;
      else if (r < 0.002)  d[i] = (Math.random() * 2 - 1) * 0.15;
      else                 d[i] = (Math.random() * 2 - 1) * 0.012;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    const glitchLP = this.ctx.createBiquadFilter();
    glitchLP.type = 'highpass';
    glitchLP.frequency.value = 300;
    glitchLP.Q.value = 0.6;

    this.glitchGain = this.ctx.createGain();
    this.glitchGain.gain.value = 0.5; // will be modulated

    src.connect(glitchLP);
    glitchLP.connect(this.glitchGain);
    this.glitchGain.connect(this.noiseBus);
    src.start(0);
  }

  /* ── Vinyl crackle ── */
  _buildCrackle() {
    const SR  = this.ctx.sampleRate;
    const len = Math.floor(SR * 3);
    const buf = this.ctx.createBuffer(1, len, SR);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const r = Math.random();
      d[i] = r < 0.0003 ? (Math.random() * 2 - 1) * 0.35
           : r < 0.0015  ? (Math.random() * 2 - 1) * 0.09
                          : (Math.random() * 2 - 1) * 0.005;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 2200; bpf.Q.value = 0.8;

    this.crackleGain = this.ctx.createGain();
    this.crackleGain.gain.value = 0.18;

    src.connect(bpf);
    bpf.connect(this.crackleGain);
    this.crackleGain.connect(this.noiseBus); // goes through WaveShaper too
    src.start(0);
  }

  /* ── Scratch synth ── */
  _buildScratch() {
    const SR  = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, SR, SR);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < SR; i++) d[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    this.scratchBpf = this.ctx.createBiquadFilter();
    this.scratchBpf.type = 'bandpass';
    this.scratchBpf.frequency.value = 900;
    this.scratchBpf.Q.value = 4.0;

    this.scratchGain = this.ctx.createGain();
    this.scratchGain.gain.value = 0;

    const scratchLP = this.ctx.createBiquadFilter();
    scratchLP.type = 'lowpass';
    scratchLP.frequency.value = 8000;

    src.connect(this.scratchBpf);
    this.scratchBpf.connect(scratchLP);
    scratchLP.connect(this.scratchGain);
    this.scratchGain.connect(this.masterLPF); // bypass drum bus — direct to master
    src.start(0);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DRUM MACHINES — all at controlled levels, all → drumBus
  ═══════════════════════════════════════════════════════════════════════ */

  _kick(t, vel = 1.0) {
    if (!this.drumBus) return;
    vel = Math.min(vel, 1.0); // cap
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.85, t);          // was 1.9 — reduced to 0.85
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.drumBus);
    o.start(t); o.stop(t + 0.5);
  }

  _snare(t, vel = 1.0) {
    if (!this.drumBus) return;
    vel = Math.min(vel, 1.0);
    const ctx = this.ctx, SR = ctx.sampleRate;
    // Noise body
    const len = Math.floor(SR * 0.15);
    const buf = ctx.createBuffer(1, len, SR);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 2500; bpf.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.45, t);          // was 0.85 — reduced
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    // Tone body
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.18, t);         // was 0.35 — reduced
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bpf); bpf.connect(g); g.connect(this.drumBus);
    o.connect(og); og.connect(this.drumBus);
    src.start(t); o.start(t); o.stop(t + 0.08);
  }

  _hihat(t, open = false, vel = 0.5) {
    if (!this.drumBus) return;
    vel = Math.min(vel, 1.0);
    const ctx = this.ctx, SR = ctx.sampleRate;
    const dur = open ? 0.18 : 0.03;
    const len = Math.floor(SR * dur);
    const buf = ctx.createBuffer(1, len, SR);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * (open ? 0.18 : 0.10), t); // was 0.32/0.18 — halved
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hpf); hpf.connect(g); g.connect(this.drumBus);
    src.start(t);
  }

  _bass808(t, freq, dur, vel = 0.8) {
    if (!this.drumBus) return;
    vel = Math.min(vel, 0.9);
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.75, t);          // was 1.5 — halved
    g.gain.setValueAtTime(vel * 0.60, t + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    // Light saturation (not the 380-amount distortion that was too harsh)
    const ws = ctx.createWaveShaper(); ws.curve = this._distCurve(40);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    o.connect(ws); ws.connect(lp); lp.connect(this.drumBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _lead(t, freq, dur, vel = 0.4) {
    // Sine-based lead — silky smooth, no square wave harshness
    if (!this.padBus || !this.convolver) return;
    vel = Math.min(vel, 0.28); // hard cap, lead is ambient not dominant
    const ctx = this.ctx;
    // Two detuned sines for warmth
    for (let v = 0; v < 2; v++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * (v === 0 ? 1.0 : 2.0); // fundamental + octave
      o.detune.value = v === 0 ? -2 : 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * (v === 0 ? 0.10 : 0.045), t + 0.04);
      g.gain.setValueAtTime(vel * (v === 0 ? 0.08 : 0.035), t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 900; filt.Q.value = 0.5;
      o.connect(filt); filt.connect(this.padBus);
      if (v === 0) filt.connect(this.convolver);
      o.start(t); o.stop(t + dur + 0.08);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BAR SCHEDULER
  ═══════════════════════════════════════════════════════════════════════ */
  _scheduleBar(startTime, barIndex) {
    const b   = this._beatSec;
    const e   = this._energy;
    const bar = barIndex % 8;

    // Kick — simplified, fewer overlapping kicks
    this._kick(startTime,         1.0);
    this._kick(startTime + b * 2, 0.75);
    if (bar % 2 === 1) this._kick(startTime + b * 3.5, 0.50);
    // Fill on bar 7 — only 2 extra kicks, not 3
    if (bar === 7) {
      this._kick(startTime + b * 3.0, 0.55);
      this._kick(startTime + b * 3.5, 0.45);
    }

    // Snare
    this._snare(startTime + b,     0.85);
    this._snare(startTime + b * 3, 0.90);
    if (e > 0.45) {
      this._snare(startTime + b * 1.75, 0.18);
    }

    // Hi-hats — 8th note grid only, no 16th burst
    for (let i = 0; i < 8; i++) {
      const open = (i === 2 || i === 6) && e > 0.5;
      this._hihat(startTime + b * i * 0.5, open, i % 2 === 0 ? 0.45 : 0.25);
    }
    // 16th-note hats: only 4 notes (not 8), very quiet, only at very high energy
    if (e > 0.82) {
      for (let i = 1; i < 8; i += 2) {
        this._hihat(startTime + b * i * 0.25, false, 0.06 * e);
      }
    }

    // 808 bass
    const bassA = [{f:55,t:0,d:1.5},{f:49,t:1.5,d:0.5},{f:65.4,t:2,d:1.0},{f:73.4,t:3,d:0.7}];
    const bassB = [{f:55,t:0,d:0.75},{f:55,t:0.75,d:0.25},{f:41.2,t:1,d:1},{f:49,t:2,d:0.5},{f:65.4,t:2.5,d:0.5},{f:73.4,t:3,d:1}];
    const bp = (bar < 2 || (bar >= 4 && bar < 6)) ? bassA : bassB;
    bp.forEach(n => this._bass808(startTime + b * n.t, n.f, b * n.d, 0.65 + e * 0.25));

    // Lead melody — only above 0.55 energy, very subtle
    if (e > 0.55) {
      const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
      const mels = [
        [{i:4,t:0,d:0.5},{i:6,t:0.5,d:0.5},{i:5,t:1,d:1},{i:3,t:2,d:0.5},{i:4,t:2.5,d:1.5}],
        [{i:6,t:0,d:0.25},{i:7,t:0.25,d:0.25},{i:6,t:0.5,d:0.5},{i:5,t:1,d:0.5},{i:4,t:1.5,d:0.5},{i:2,t:2,d:2}],
        [{i:5,t:0,d:0.5},{i:4,t:0.5,d:0.25},{i:3,t:0.75,d:0.25},{i:4,t:1,d:1},{i:6,t:2,d:0.5},{i:7,t:2.5,d:1.25}],
        [{i:7,t:0,d:0.25},{i:6,t:0.25,d:0.25},{i:5,t:0.5,d:0.75},{i:3,t:1.5,d:0.5},{i:4,t:2,d:0.5},{i:2,t:2.5,d:1.5}],
      ];
      mels[bar % 4].forEach(n =>
        this._lead(startTime + b * n.t, scale[n.i], b * n.d, (e - 0.55) * 0.9)
      );
    }
  }

  _schedulerTick() {
    if (!this.playing || !this.ctx) return;
    const lookahead = this.ctx.currentTime + 0.15;
    while (this._nextBeat < lookahead) {
      if (this._beatIndex % 4 === 0) {
        this._scheduleBar(this._nextBeat, this._barIndex);
        this._barIndex++;
      }
      this._nextBeat += this._beatSec;
      this._beatIndex++;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════════════ */
  async start() {
    if (!this.inited) await this.init();
    if (!this.masterGain) { console.warn('[AudioSpaceSynth] nodes not ready'); return; }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return;
    this.playing     = true;
    this._nextBeat   = this.ctx.currentTime + 0.15;
    this._beatIndex  = 0;
    this._barIndex   = 0;
    this._schedulerTimer = setInterval(() => this._schedulerTick(), 40);
  }

  stop() {
    this.playing = false;
    if (this._schedulerTimer) { clearInterval(this._schedulerTimer); this._schedulerTimer = null; }
  }

  togglePlay() {
    if (this.playing) { this.stop(); return false; }
    else              { this.start(); return true; }
  }

  playScratch(velocity) {
    if (!this.ctx || !this.scratchGain) return;
    const abs  = Math.min(Math.abs(velocity), 12);
    const gain = Math.min(abs * 0.04, 0.40);  // capped at 0.40
    const freq = 300 + abs * 140 + (velocity > 0 ? 0 : -80);
    const now  = this.ctx.currentTime;
    this.scratchBpf.frequency.setTargetAtTime(Math.max(200, freq), now, 0.01);
    this.scratchGain.gain.cancelScheduledValues(now);
    this.scratchGain.gain.setValueAtTime(gain, now);
    this.scratchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    // Open hihat accent on fast scratch
    if (abs > 4 && this.playing) {
      this._hihat(now + 0.015, true, Math.min(0.5, abs * 0.05));
    }
  }

  /**
   * Llamado cada frame desde el bucle de animación.
   * @param {number} angularVelocity   rad/s del plato
   * @param {number} energy            0.0 → 1.0
   */
  update(angularVelocity, energy) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this._energy          = energy;
    this._angularVelocity = angularVelocity;
    const absVel = Math.abs(angularVelocity);

    /* 1. WaveShaper en noiseBus: distorsión en reposo, limpio en creación */
    const distAmt = Math.max(0, (1 - energy) * 180); // was 380 — much softer
    this.noiseShaper.curve = this._distCurve(distAmt);

    /* 2. Master LowPass: 200Hz → 16kHz con energía (curva exponencial) */
    const targetFreq = 200 * Math.pow(80, Math.max(0.01, energy)); // 200→16000Hz
    this.masterLPF.frequency.setTargetAtTime(targetFreq, now, 0.12);

    /* 3. Master volume — NUNCA supera 0.72
       Fórmula: 0 cuando absVel=0 y energy=0, crece suavemente */
    const velContrib    = Math.min(absVel * 0.08, 0.22);  // max contribución velocidad: 0.22
    const energyContrib = energy * 0.50;                   // max contribución energía: 0.50
    const targetVol     = Math.min(0.72, velContrib + energyContrib);
    this.masterGain.gain.setTargetAtTime(targetVol, now, 0.10);

    /* 4. Glitch noise: fuerte en reposo, silencioso al despertar */
    if (this.glitchGain) {
      const gvol = Math.max(0.02, (1 - energy) * 0.55);
      this.glitchGain.gain.setTargetAtTime(gvol, now, 0.12);
    }

    /* 5. Crackle: desaparece gradualmente con energía */
    if (this.crackleGain) {
      const cvol = Math.max(0.005, (1 - energy) * 0.20);
      this.crackleGain.gain.setTargetAtTime(cvol, now, 0.15);
    }

    /* 6. Reverb send: crece a partir de energía 0.3 */
    if (this.reverbSend) {
      const rvol = Math.max(0, (energy - 0.3) / 0.7) * 0.35;
      this.reverbSend.gain.setTargetAtTime(rvol, now, 0.18);
    }

    /* 7. Pad: entra suavemente desde energía 0.25 — techo más bajo */
    if (this.padGain) {
      const padVol = Math.max(0, (energy - 0.25) / 0.75) * 0.52; // was 0.75 — capped softer
      this.padGain.gain.setTargetAtTime(padVol, now, 0.25);

      // Chord change every ~8s
      this._padChordTimer += 0.016;
      if (this._padChordTimer >= this._padChordDur) {
        this._padChordTimer = 0;
        this._padChordIdx = (this._padChordIdx + 1) % this._padChords.length;
        this._spawnPadChord(this._padChords[this._padChordIdx]);
      }
    }

    /* 8. Tempo: BPM sigue velocidad angular, suavizado para evitar jumps */
    const velNorm  = Math.max(0.15, Math.min(2.5, absVel));
    const rawBPM   = 90 * (velNorm / 0.55);
    const clampBPM = Math.max(50, Math.min(175, rawBPM));
    // Smooth BPM change — only update if difference > 5 BPM
    if (Math.abs(clampBPM - this._lastBPM) > 5) {
      this._lastBPM = clampBPM;
      this._beatSec = 60 / clampBPM;
    }
  }
}
