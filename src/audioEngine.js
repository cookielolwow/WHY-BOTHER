/**
 * AudioEngine — Why Bother? · Comuna 13  v2
 * ─────────────────────────────────────────────────────────────────────────
 * Fusión: Hip-Hop boom-bap underground + pads espaciales Interstellar
 *
 * CADENA DE SEÑAL:
 *   Drums ──┐
 *   Vinyl ──┤→ masterFilter(LPF) → Distortion → Limiter → Destination
 *   Pads  ──┘  (Reverb+Chorus internos al pad bus)
 *
 * u_energy (0→1) controla:
 *   masterFilter : 150 Hz → 12 000 Hz  (asfixia → libertad)
 *   distortion   : wet 1.0 → 0.0       (mugre → limpieza)
 *   Transport.bpm: 12 → 90 BPM         (tape-stop → groove)
 *   padBus.gain  : 0 → 0.85            (silencio → clímax cósmico)
 *   vinylCrackle : fuerte → tenue
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as Tone from 'tone';

/* ── ACORDES melancólicos & épicos ─────────────────────────────────── */
const CHORDS = [
  ['F2',  'C3',  'Eb3', 'Ab3', 'G4'],  // Fm9
  ['Eb2', 'Bb2', 'D3',  'G3',  'F4'],  // Ebmaj7
  ['Db2', 'Ab2', 'C3',  'F3',  'Eb4'], // Dbmaj7
  ['Bb1', 'F2',  'Ab2', 'D3',  'C4'],  // Bbm9
];

/* ── BOOM-BAP PATTERN (16 pasos) ───────────────────────────────────── */
const KICK_STEPS  = [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0];
const SNARE_STEPS = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1];
const HAT_STEPS   = [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,0];
const HAT_OPEN    = [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0];
const BASS_STEPS  = [
  { step:0,  note:'F1',  dur:'4n',  vel:0.88 },
  { step:8,  note:'Eb1', dur:'8n',  vel:0.72 },
  { step:6,  note:'Ab1', dur:'16n', vel:0.55 },
  { step:12, note:'Db1', dur:'8n',  vel:0.60 },
];

/* ═══════════════════════════════════════════════════════════════════════
   AudioEngine
   ═══════════════════════════════════════════════════════════════════════ */
export class AudioEngine {
  constructor() {
    this.inited  = false;
    this.playing = false;
    this._energy = 0;
    this._angVel = 0;
    this._chordIdx   = 0;
    this._chordTimer = 0;
    this.sequences   = [];

    // Nodos — se crean en init()
    this.masterFilter  = null;
    this.distortion    = null;
    this.limiter       = null;
    this.drumBus       = null;
    this.padBus        = null;
    this.vinylBus      = null;
    this._vinylGain    = null;
    this.padSynth      = null;
    this._scratchFilter = null;
    this._scratchGain   = null;
    this._scratchNoise  = null;

    // Para el visualizer externo
    this._analyserNode = null;
  }

  /* ─────────────────────────────────────────────────────────────────
     INIT — lazy, requiere gesto del usuario
  ───────────────────────────────────────────────────────────────────*/
  async init() {
    if (this.inited) return;
    this.inited = true;

    try {
      await Tone.start();
    } catch (e) {
      console.warn('[AudioEngine] Tone.start() failed:', e);
    }

    Tone.Transport.bpm.value = 90;
    Tone.Transport.swing     = 0.08;

    /* ── MASTER CHAIN ─────────────────────────────────────────────
       masterFilter → distortion → limiter → Destination
    ────────────────────────────────────────────────────────────── */
    this.limiter = new Tone.Limiter(-1).toDestination();

    this.distortion = new Tone.Distortion({
      distortion: 0.5,
      wet: 1.0,
      oversample: '4x',
    }).connect(this.limiter);

    // Analyser para el visualizer — tap via raw AudioContext
    try {
      const rawCtx = Tone.getContext().rawContext;
      this._analyserNode = rawCtx.createAnalyser();
      this._analyserNode.fftSize = 256;
      this._analyserNode.smoothingTimeConstant = 0.80;
      const destInput = Tone.getDestination().input;
      if (destInput) destInput.connect(this._analyserNode);
    } catch (e) {
      console.warn('[AudioEngine] analyser tap failed:', e);
      this._analyserNode = null;
    }

    this.masterFilter = new Tone.Filter({
      type:      'lowpass',
      frequency:  150,
      rolloff:   -24,
      Q:          0.7,
    }).connect(this.distortion);

    /* ── BUSES ───────────────────────────────────────────────────── */
    this.drumBus  = new Tone.Gain(0.65).connect(this.masterFilter);
    this.vinylBus = new Tone.Gain(0.50).connect(this.masterFilter);
    this.padBus   = new Tone.Gain(0.0).connect(this.masterFilter);

    /* ── CONSTRUIR FUENTES ───────────────────────────────────────── */
    this._buildDrums();
    await this._buildPad();     // Reverb es async — necesita await
    this._buildVinylCrackle();
    this._buildScratch();
    this._buildSequences();
  }

  /* ─────────────────────────────────────────────────────────────────
     DRUMS
  ───────────────────────────────────────────────────────────────────*/
  _buildDrums() {
    /* Kick — boom profundo */
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 8,
      envelope: { attack: 0.002, decay: 0.42, sustain: 0, release: 0.1 },
    }).connect(this.drumBus);
    this.kick.volume.value = -3;

    /* Snare — ruido filtrado */
    const snareBPF = new Tone.Filter({ type: 'bandpass', frequency: 2800, Q: 1.1 })
      .connect(this.drumBus);
    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.03 },
    }).connect(snareBPF);
    this.snare.volume.value = -9;

    /* Snare tonal body */
    this._snareTone = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
    }).connect(this.drumBus);
    this._snareTone.volume.value = -15;

    /* HiHat cerrado */
    this.hihat = new Tone.MetalSynth({
      frequency: 400,
      envelope: { attack: 0.001, decay: 0.022, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).connect(this.drumBus);
    this.hihat.volume.value = -20;

    /* HiHat abierto */
    this.hihatOpen = new Tone.MetalSynth({
      frequency: 380,
      envelope: { attack: 0.001, decay: 0.13, release: 0.07 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4200,
      octaves: 1.5,
    }).connect(this.drumBus);
    this.hihatOpen.volume.value = -23;

    /* 808 sub-bass */
    const bassLP = new Tone.Filter({ type: 'lowpass', frequency: 300 })
      .connect(this.drumBus);
    this.bass808 = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.55, sustain: 0.10, release: 0.28 },
    }).connect(bassLP);
    this.bass808.volume.value = -5;
  }

  /* ─────────────────────────────────────────────────────────────────
     PAD — PolySynth → Filter → Chorus → Reverb → padBus
     ⚠ Tone.Reverb.generate() es async
  ───────────────────────────────────────────────────────────────────*/
  async _buildPad() {
    /* Reverb masivo — AWAIT obligatorio */
    const reverb = await new Tone.Reverb({
      decay:    8.5,
      preDelay: 0.06,
      wet:      0.70,
    }).generate();
    reverb.connect(this.padBus);
    this._padReverb = reverb;

    /* Chorus expansivo */
    const chorus = new Tone.Chorus({
      frequency:  0.35,
      delayTime:  4.5,
      depth:      0.60,
      spread:     180,
      wet:        0.55,
    }).connect(reverb);
    chorus.start();

    /* Filtro cálido antes del chorus */
    const padFilt = new Tone.Filter({ type: 'lowpass', frequency: 1600, Q: 0.35 })
      .connect(chorus);

    /* PolySynth — triángulos suaves */
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack:  3.2,
        decay:   1.5,
        sustain: 0.72,
        release: 6.0,
      },
      volume: -12,
    }).connect(padFilt);

    // Toca el primer acorde silenciosamente — se abrirá con la energía
    this.padSynth.triggerAttack(CHORDS[0], Tone.now() + 0.1);
  }

  _nextChord() {
    this._chordIdx = (this._chordIdx + 1) % CHORDS.length;
    try { this.padSynth.releaseAll(); } catch (_) {}
    setTimeout(() => {
      try { this.padSynth.triggerAttack(CHORDS[this._chordIdx], Tone.now()); }
      catch (_) {}
    }, 200);
  }

  /* ─────────────────────────────────────────────────────────────────
     VINYL CRACKLE — pink noise + BPF + modulación lenta
  ───────────────────────────────────────────────────────────────────*/
  _buildVinylCrackle() {
    // Ruido rosa → BPF → HPF → gain modulado → vinylBus
    const bpf = new Tone.Filter({ type: 'bandpass', frequency: 3200, Q: 0.55 });
    const hpf = new Tone.Filter({ type: 'highpass', frequency: 1600 });

    this._vinylGain = new Tone.Gain(0.6).connect(this.vinylBus);

    // LFO válido (sine) para modular el crackle
    this._crackLFO = new Tone.LFO({ frequency: 2.2, amplitude: 0.3, type: 'sine' });
    this._crackLFO.connect(this._vinylGain.gain);
    this._crackLFO.start();

    this._vinylNoise = new Tone.Noise({ type: 'pink', volume: -22 });
    this._vinylNoise.chain(bpf, hpf, this._vinylGain);
    this._vinylNoise.start();
  }

  /* ─────────────────────────────────────────────────────────────────
     SCRATCH
  ───────────────────────────────────────────────────────────────────*/
  _buildScratch() {
    this._scratchFilter = new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 3.5 });
    const scratchLP     = new Tone.Filter({ type: 'lowpass',  frequency: 8000 });
    this._scratchGain   = new Tone.Gain(0).connect(this.masterFilter);

    this._scratchNoise = new Tone.Noise({ type: 'white', volume: -8 });
    this._scratchNoise.chain(this._scratchFilter, scratchLP, this._scratchGain);
    this._scratchNoise.start();
  }

  /* ─────────────────────────────────────────────────────────────────
     SEQUENCES — Tone.Sequence para el beat boom-bap
  ───────────────────────────────────────────────────────────────────*/
  _buildSequences() {
    const steps = Array.from({ length: 16 }, (_, i) => i);

    /* Kick + 808 */
    const kickSeq = new Tone.Sequence((time, step) => {
      if (KICK_STEPS[step]) {
        const vel = step === 0 ? 0.92 : step === 8 ? 0.80 : 0.62;
        this.kick.triggerAttackRelease('C1', '16n', time, vel);
      }
      // 808 bass line
      const bassNote = BASS_STEPS.find(b => b.step === step);
      if (bassNote) {
        this.bass808.triggerAttackRelease(bassNote.note, bassNote.dur, time, bassNote.vel);
      }
    }, steps, '16n');

    /* Snare */
    const snareSeq = new Tone.Sequence((time, step) => {
      if (!SNARE_STEPS[step]) return;
      const vel = step === 15 ? 0.42 : 0.76; // ghost en el último paso
      this.snare.triggerAttackRelease('16n', time, vel);
      this._snareTone.triggerAttackRelease('A3', '32n', time, vel * 0.55);
    }, steps, '16n');

    /* HiHat */
    const hatSeq = new Tone.Sequence((time, step) => {
      if (HAT_OPEN[step]) {
        this.hihatOpen.triggerAttackRelease('16n', time, 0.42);
      } else if (HAT_STEPS[step]) {
        const vel = step % 2 === 0 ? 0.52 : 0.24;
        this.hihat.triggerAttackRelease('32n', time, vel);
      }
    }, steps, '16n');

    this.sequences = [kickSeq, snareSeq, hatSeq];
  }

  /* ─────────────────────────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────────────────────────────*/
  async start() {
    if (!this.inited) await this.init();
    if (this.playing) return;
    this.playing = true;
    this.sequences.forEach(s => s.start(0));
    Tone.Transport.start();
  }

  stop() {
    this.playing = false;
    this.sequences.forEach(s => s.stop());
    Tone.Transport.stop();
  }

  togglePlay() {
    if (this.playing) { this.stop(); return false; }
    else              { this.start(); return true;  }
  }

  playScratch(velocity) {
    if (!this.inited || !this._scratchGain) return;
    const abs  = Math.min(Math.abs(velocity), 14);
    const freq = 350 + abs * 120 + (velocity > 0 ? 0 : -80);
    this._scratchFilter.frequency.rampTo(Math.max(200, freq), 0.01);
    this._scratchGain.gain.cancelScheduledValues(Tone.now());
    this._scratchGain.gain.rampTo(abs * 0.028, 0.01);
    this._scratchGain.gain.rampTo(0, 0.10);
  }

  /* ─────────────────────────────────────────────────────────────────
     UPDATE — llamado cada frame desde main.js
  ───────────────────────────────────────────────────────────────────*/
  update(angularVelocity, energy) {
    if (!this.inited) return;

    this._energy = energy;
    this._angVel = angularVelocity;

    const absV = Math.min(Math.abs(angularVelocity), 5);
    const e    = Math.max(0, Math.min(1, energy));

    /* 1. TAPE-STOP — BPM sigue la velocidad del vinilo */
    const rawBPM    = 90 * (Math.max(0.04, absV) / 0.55);
    const targetBPM = Math.max(10, Math.min(110, rawBPM));
    Tone.Transport.bpm.rampTo(targetBPM, 0.3);

    /* 2. MASTER FILTER — 150 Hz tapado → 12 kHz abierto */
    const filterFreq = 150 * Math.pow(80, e); // 150→12000 Hz curva exponencial
    this.masterFilter.frequency.rampTo(Math.min(15000, filterFreq), 0.2);

    /* 3. DISTORTION — sucio en inercia, limpio en creación */
    const distWet = Math.max(0, 1.0 - e * 1.8);
    this.distortion.wet.rampTo(Math.min(1, distWet), 0.18);

    /* 4. PAD — entra desde energy > 0.25 */
    if (this.padBus) {
      const padVol = Math.max(0, (e - 0.25) / 0.75) * 0.82;
      this.padBus.gain.rampTo(padVol, 0.4);

      // Cambio de acorde cada ~32 segundos
      this._chordTimer += 0.016;
      if (this._chordTimer >= 32 && e > 0.22) {
        this._chordTimer = 0;
        this._nextChord();
      }
    }

    /* 5. VINYL CRACKLE — fuerte en inercia, desvanece con energía */
    if (this._vinylGain) {
      const crackVol = 0.08 + Math.max(0, (1 - e)) * 0.65;
      this._vinylGain.gain.rampTo(crackVol, 0.25);
    }

    /* 6. DRUM BUS — emergen con la velocidad del vinilo */
    if (this.drumBus) {
      const drumVol = 0.12 + Math.min(0.55, absV * 0.38);
      this.drumBus.gain.rampTo(drumVol, 0.15);
    }

    /* 7. VINYL BUS — crackle general */
    if (this.vinylBus) {
      this.vinylBus.gain.rampTo(0.28 + (1 - e) * 0.38, 0.2);
    }
  }

  /* Para el visualizer en main.js */
  get analyserNode() { return this._analyserNode; }
}
