// Why Bother? · Comuna 13 — Main Scene Orchestration v5
import * as THREE from 'three';
import { OrbitControls }   from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/examples/jsm/postprocessing/OutputPass.js';

import { AudioEngine }    from './audioEngine.js';
import { VinylTurntable }  from './vinylTurntable.js';
import { HumanFigure }     from './humanFigure.js';
import { ParticleSystem }  from './particleSystem.js';
import { GlitchShaderPass } from './glitchShaderPass.js';
import { BackgroundShader } from './backgroundShader.js';

class App {
  constructor() {
    this.container    = document.getElementById('canvas-container');
    this.energy       = 0.0;
    this.targetEnergy = 0.0;
    this.isContinuous = false;
    this.isInteracting = false;
    this.hasStarted   = false;  // true after first user interaction
    this.startTime    = performance.now();
    this.lastTime     = this.startTime;
    this._decayTimer  = 0;

    // Cinematic camera state
    this._camAutoAngle  = 0;      // auto-orbit angle
    this._camAutoActive = true;   // auto-orbit until first interaction
    this._camIdleTimer  = 0;      // seconds since last user camera move
    this._camUserMoved  = false;

    this.quotes = [
      { text: '"Un barrio que agarró las barras y soltó las armas." El arte transforma la herida en identidad viva.', source: 'Comuna 13 · Medellín' },
      { text: '¿Para qué tomarte el trabajo? Para adueñarte de tu historia en vez de ser un consumidor pasivo.', source: 'Why Bother? · Resistencia Creativa' },
      { text: 'Una máquina genera un resultado en segundos; el humano encuentra su alma en el proceso.', source: 'El Valor del Esfuerzo' },
      { text: 'La creación no es un atajo: es sudor, ritmo, práctica y decisión personal.', source: 'Hip Hop & Memoria Colectiva' },
      { text: 'Cuando dejamos de usar la mente y crear, nos automatizamos a nosotros mismos.', source: 'Despertar Creativo' },
      { text: 'El scratch no es ruido — es el momento exacto en que el cuerpo habla antes que la mente.', source: 'DJ Culture · Resistencia Sonora' },
    ];
    this.quoteIndex = 0;

    try { this._initScene();       } catch(e) { console.error('[Scene]', e); }
    try { this._initPostFX();      } catch(e) { console.error('[PostFX]', e); }
    try { this._initComponents();  } catch(e) { console.error('[Components]', e); }
    try { this._initInteraction(); } catch(e) { console.error('[Interaction]', e); }
    try { this._initUI();          } catch(e) { console.error('[UI]', e); }
    try { this._initVisualizer();  } catch(e) { console.error('[Viz]', e); }
    this._initSplash(); // Siempre corre — primer punto de contacto del usuario
    this._animate();
  }

  /* ══════════════════════════════════════════════════════════
     SCENE
  ══════════════════════════════════════════════════════════ */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 120);
    this.camera.position.set(-0.8, 5.5, 11.5);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance   = 3;
    this.controls.maxDistance   = 20;
    this.controls.target.set(-0.8, 1.8, 0);
    this.controls.autoRotate    = false;

    // Detect when user moves camera manually
    this.controls.addEventListener('start', () => {
      this._camUserMoved   = true;
      this._camAutoActive  = false;
      this._camIdleTimer   = 0;
    });
    this.controls.addEventListener('end', () => {
      this._camIdleTimer = 0; // reset idle timer on release
    });

    // Lights
    this.ambientLight = new THREE.AmbientLight(0x10101c, 0.35);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    this.dirLight.position.set(4, 10, 6);
    this.scene.add(this.dirLight);

    // Rim lights — intensities capped low so they don't wash out the background
    this.rimA = new THREE.PointLight(0xff0055, 1.2, 16);
    this.rimA.position.set(-6, 3.5, -3);
    this.scene.add(this.rimA);

    this.rimB = new THREE.PointLight(0x00f5d4, 1.2, 16);
    this.rimB.position.set(5, 3.5, -2);
    this.scene.add(this.rimB);

    this.rimC = new THREE.PointLight(0xffd600, 0.7, 12);
    this.rimC.position.set(0, 6.5, 0);
    this.scene.add(this.rimC);

    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
      this.glitchPass.setSize(innerWidth, innerHeight);
      // Resize visualizer
      const vc = document.getElementById('vizCanvas');
      if (vc) { vc.width = innerWidth; vc.height = 80; }
    });
  }

  /* ══════════════════════════════════════════════════════════
     POST-FX
  ══════════════════════════════════════════════════════════ */
  _initPostFX() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.glitchPass = new GlitchShaderPass();
    this.composer.addPass(this.glitchPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.25, 0.55, 0.85
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /* ══════════════════════════════════════════════════════════
     COMPONENTS
  ══════════════════════════════════════════════════════════ */
  _initComponents() {
    this.audio     = new AudioEngine();
    this.bg        = new BackgroundShader(this.scene);
    this.turntable = new VinylTurntable(this.scene);
    this.human     = new HumanFigure(this.scene);
    this.particles = new ParticleSystem(this.scene, 12000);

    this.raycaster = new THREE.Raycaster();
    this.pointer   = new THREE.Vector2();
  }

  /* ══════════════════════════════════════════════════════════
     INTERACTION
  ══════════════════════════════════════════════════════════ */
  _initInteraction() {
    const canvas = this.renderer.domElement;

    const hitPoint = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX ?? (e.touches?.[0]?.clientX);
      const clientY = e.clientY ?? (e.touches?.[0]?.clientY);
      this.pointer.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
      this.pointer.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObject(this.turntable.hitDisc, true);
      return hits.length ? hits[0].point : null;
    };

    const onDown = async (e) => {
      // Si el raycast toca el disco → drag completo
      // Si no toca → igual arrancar audio (primer gesto del usuario)
      const pt = hitPoint(e);
      if (pt) {
        this.isInteracting    = true;
        this.controls.enabled = false;
        this._camAutoActive   = false;
        try { this.turntable.startDrag(pt); } catch (_) {}
      }
      // Audio siempre arranca en el primer toque (aunque no sea en el disco)
      if (!this.hasStarted) {
        this.hasStarted = true;
        this._hideSplash();
        if (this.audio) this.audio.start().catch(e => console.warn('[Audio]', e));
      }
    };

    const onMove = (e) => {
      if (!this.isInteracting) return;
      const pt = hitPoint(e);
      if (pt) {
        const vel    = this.turntable.drag(pt);
        const absVel = Math.abs(vel);
        this.audio.playScratch(vel);

        // Energy: turbo multiplier — faster scratch = exponentially more energy
        const effort = absVel * 0.028 * (1.0 + absVel * 0.012);
        this.targetEnergy = Math.min(1.0, this.targetEnergy + effort);
        this._decayTimer = 0;

      }
    };

    const onUp = () => {
      if (!this.isInteracting) return;
      this.turntable.endDrag();
      this.controls.enabled = true;
      this.isInteracting    = false;
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);

    // Touch support
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(e); }, { passive: false });
    window.addEventListener('touchmove',  (e) => { e.preventDefault(); onMove(e); }, { passive: false });
    window.addEventListener('touchend',   () => onUp());

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        try { this.turntable?.nudge(5.5); } catch (_) {}
        this.targetEnergy = Math.min(1.0, this.targetEnergy + 0.28);
        this._decayTimer  = 0;
        if (!this.hasStarted) { this.hasStarted = true; this._hideSplash(); }
        if (this.audio) this.audio.start().catch(() => {});
      }
      if (e.code === 'KeyS') {
        try { this.turntable?.nudge(-9.0); } catch (_) {}
        try { this.audio?.playScratch(-9.0); } catch (_) {}
        this.targetEnergy = Math.min(1.0, this.targetEnergy + 0.12);
      }
      if (e.code === 'KeyF') { this._toggleFullscreen(); }
      if (e.code === 'KeyH') { try { this._toggleHUD(); } catch (_) {} }
    });
  }

  /* ══════════════════════════════════════════════════════════
     SPLASH SCREEN
  ══════════════════════════════════════════════════════════ */
  _initSplash() {
    const doStart = () => {
      // 1. Ocultar splash inmediatamente — no esperar audio
      this._hideSplash();

      // 2. Dar impulso visual al vinilo
      try { this.turntable?.nudge(3.0); } catch (_) {}
      this.targetEnergy = 0.25;
      this.hasStarted   = true;

      // 3. Arrancar audio en background (no bloquea nada)
      if (this.audio) {
        this.audio.start().catch(e => console.warn('[Audio start]', e));
      }
    };

    // Click works for mouse, touch, and keyboard activation.
    const btn = document.getElementById('splashBtn');
    btn?.addEventListener('click', doStart, { once: true });
  }

  _hideSplash() {
    const splash = document.getElementById('splash');
    if (splash && !splash.classList.contains('hidden')) {
      splash.classList.add('hidden');
    }
  }

  /* ══════════════════════════════════════════════════════════
     AUDIO VISUALIZER (AnalyserNode → canvas bars)
  ══════════════════════════════════════════════════════════ */
  _initVisualizer() {
    this.vizCanvas  = document.getElementById('vizCanvas');
    this.vizCtx     = this.vizCanvas?.getContext('2d');
    this.analyser   = null;
    this.vizData    = null;

    if (this.vizCanvas) {
      this.vizCanvas.width  = innerWidth;
      this.vizCanvas.height = 80;
    }
  }

  _ensureAnalyser() {
    if (this.analyser) return;
    // AudioEngine expone _analyserNode ya conectado al master chain
    if (this.audio.analyserNode) {
      this.analyser = this.audio.analyserNode;
      this.vizData  = new Uint8Array(this.analyser.frequencyBinCount);
    }
  }

  _drawVisualizer(energy) {
    if (!this.vizCtx || !this.analyser) return;
    const ctx = this.vizCtx;
    const W   = this.vizCanvas.width;
    const H   = this.vizCanvas.height;

    this.analyser.getByteFrequencyData(this.vizData);

    ctx.clearRect(0, 0, W, H);

    const bars = this.vizData.length;
    const bw   = W / bars;
    const hue  = ((performance.now() / 1000) * 0.08) % 1.0;

    for (let i = 0; i < bars; i++) {
      const val  = this.vizData[i] / 255;
      const bh   = val * H * 0.9;
      const x    = i * bw;
      const h    = (hue + i / bars * 0.35) % 1.0;
      const sat  = 0.7 + energy * 0.3;
      const lit  = 0.4 + energy * 0.25;
      ctx.fillStyle = `hsla(${Math.round(h * 360)}, ${Math.round(sat*100)}%, ${Math.round(lit*100)}%, ${0.5 + energy * 0.5})`;
      ctx.fillRect(x, H - bh, bw - 1, bh);
    }

    // Oscilloscope line on top
    const waveData = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(waveData);
    ctx.beginPath();
    ctx.strokeStyle = `hsla(${Math.round(hue * 360)}, 100%, 75%, ${energy * 0.6})`;
    ctx.lineWidth   = 1.5;
    const sliceW = W / waveData.length;
    for (let i = 0; i < waveData.length; i++) {
      const v = (waveData[i] / 128.0) - 1.0;
      const y = (v * H * 0.4) + H * 0.5;
      i === 0 ? ctx.moveTo(i * sliceW, y) : ctx.lineTo(i * sliceW, y);
    }
    ctx.stroke();
  }

  /* ══════════════════════════════════════════════════════════
     UI
  ══════════════════════════════════════════════════════════ */
  _initUI() {
    this.updateUIEnergy(0);

    // SVG melt filter nodes — scale drives the dripping distortion on .title
    this._meltDisplace = document.querySelector('#melt feDisplacementMap');
    this._meltTurb     = document.querySelector('#melt feTurbulence');

    this.uiEnergyVal     = document.getElementById('energyValue');
    this.uiEnergyFill    = document.getElementById('energyFill');
    this.uiStateLabel    = document.getElementById('stateLabel');
    this.uiRPM           = document.getElementById('rpmValue');
    this.uiNarrativeTxt  = document.getElementById('narrativeText');
    this.uiAudioBtn      = document.getElementById('audioToggleBtn');
    this.uiNudgeBtn      = document.getElementById('nudgeBtn');
    this.uiContinuousBtn = document.getElementById('continuousBtn');
    this.uiContinuousTxt = document.getElementById('continuousBtnText');
    this.uiFullscreenBtn = document.getElementById('fullscreenBtn');
    this.uiHideBtn       = document.getElementById('hudHideBtn');
    this.uiRevealBtn     = document.getElementById('hudRevealBtn');
    this.uiScreenControls = document.querySelector('.screen-controls');
    this.uiHudEl         = document.getElementById('hud');
    this._hudVisible     = true;

    // Narrative phrases that evolve with energy — part of the story
    this._narrativeLines = [
      { thresh: 0.00, text: 'Gira el vinilo — despierta al ser.' },
      { thresh: 0.20, text: 'La chispa nace en el esfuerzo.' },
      { thresh: 0.45, text: 'El cuerpo habla antes que la mente.' },
      { thresh: 0.65, text: 'Un barrio que tomó las barras y soltó las armas.' },
      { thresh: 0.85, text: 'La mente humana no se puede automatizar.' },
    ];
    this._lastNarrativeIdx = -1;

    this.uiAudioBtn?.addEventListener('click', async () => {
      const playing = this.audio.togglePlay();
      this.uiAudioBtn.classList.toggle('is-active', playing);
      if (this.uiAudioBtn) this.uiAudioBtn.textContent = playing ? 'Pausa' : 'Beat';
      if (playing) { this.hasStarted = true; this._hideSplash(); }
    });

    this.uiNudgeBtn?.addEventListener('click', async () => {
      this.turntable.nudge(4.5);
      this.targetEnergy = Math.min(1.0, this.targetEnergy + 0.35);
      this._decayTimer  = 0;
      await this.audio.start();
      this.audio.playScratch(5.0);
      this.hasStarted = true;
      this._hideSplash();
    });

    this.uiContinuousBtn?.addEventListener('click', async () => {
      this.isContinuous = !this.isContinuous;
      this.uiContinuousBtn.classList.toggle('is-active', this.isContinuous);
      if (this.uiContinuousTxt)
        this.uiContinuousTxt.textContent = this.isContinuous ? 'Motor' : 'Manual';
      if (this.isContinuous) {
        this.targetEnergy = Math.max(0.72, this.targetEnergy);
        await this.audio.start();
        this.hasStarted = true;
        this._hideSplash();
      }
    });

    this.uiFullscreenBtn?.addEventListener('click', () => this._toggleFullscreen());

    // Hide / show HUD
    this.uiHideBtn?.addEventListener('click',   () => this._toggleHUD());
    this.uiRevealBtn?.addEventListener('click', () => this._toggleHUD());
  }

  _toggleHUD() {
    this._hudVisible = !this._hudVisible;
    this.uiHudEl?.classList.toggle('hidden', !this._hudVisible);
    this.uiRevealBtn?.classList.toggle('visible', !this._hudVisible);
    this.uiScreenControls?.classList.toggle('hud-hidden', !this._hudVisible);
  }

  updateUIEnergy(energy) {
    const e = Math.max(0, Math.min(1, energy));
    const r = document.documentElement;
    r.style.setProperty('--energy',           e.toFixed(3));
    r.style.setProperty('--glitch-intensity', (1 - e).toFixed(3));
    r.style.setProperty('--panel-blur',    (e * 16).toFixed(1) + 'px');
    r.style.setProperty('--border-alpha',  (0.06 + e * 0.18).toFixed(3));
    r.style.setProperty('--glow-spread',   (e * 30).toFixed(1) + 'px');
    r.style.setProperty('--bg-alpha',      (0.92 - e * 0.86).toFixed(3));
    r.style.setProperty('--border-radius', (2 + e * 10).toFixed(1) + 'px');
    document.body.classList.toggle('state-alive',  energy > 0.5);
    document.body.classList.toggle('state-glitch', energy < 0.3);
    document.body.setAttribute('data-energy', e.toFixed(3));

    // SVG melt filter: at low energy = crudo/corrompido, at high = liquid drip
    if (this._meltDisplace) {
      // Low energy: subtle glitch noise. High energy: vertical melt drip
      const meltAmt = e < 0.4
        ? (1 - e / 0.4) * 4      // 0→4 as energy drops to 0 (glitch at low)
        : (e - 0.4) / 0.6 * 22;  // 0→22 as energy rises (melt drip at high)
      this._meltDisplace.setAttribute('scale', meltAmt.toFixed(1));
      // Animate the turbulence seed offset slightly for organic movement
      if (this._meltTurb && e > 0.35) {
        const bf = 0.012 + e * 0.008;
        this._meltTurb.setAttribute('baseFrequency', `${bf.toFixed(4)} ${(0.22 + e * 0.18).toFixed(3)}`);
      }
    }
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  /* ══════════════════════════════════════════════════════════
     ENERGY UPDATE
  ══════════════════════════════════════════════════════════ */
  _updateEnergy(delta) {
    if (this.isContinuous) {
      this.targetEnergy = Math.max(0.75, this.targetEnergy);
      this.turntable.nudge(0.42 * delta);
    }

    // Decay ramps from 0.02 → 0.14 over ~6 seconds of inactivity
    this._decayTimer += delta;
    if (this.isInteracting) this._decayTimer = 0;
    const decayRate = this.isInteracting
      ? 0.01
      : Math.min(0.14, 0.018 + this._decayTimer * 0.02);
    this.targetEnergy = Math.max(0, this.targetEnergy - decayRate * delta);

    // Lerp — faster snap up, slower fall
    const lerpSpd = this.targetEnergy > this.energy ? 0.16 : 0.065;
    this.energy += (this.targetEnergy - this.energy) * lerpSpd;

    const pct = Math.round(this.energy * 100);
    if (this.uiEnergyVal)  this.uiEnergyVal.textContent  = `${pct}%`;
    if (this.uiEnergyFill) this.uiEnergyFill.style.width = `${pct}%`;

    // RPM display
    if (this.uiRPM) {
      const rpm = Math.abs(this.turntable.angularVelocity) * (60 / (Math.PI * 2));
      this.uiRPM.textContent = `${rpm.toFixed(0)} RPM`;
      this.uiRPM.style.color = rpm > 30 ? '#00f5d4' : rpm > 10 ? '#ffd600' : '#5a5a6e';
    }

    if (this.uiStateLabel) {
      if (this.energy < 0.25) {
        this.uiStateLabel.textContent = 'APATÍA · MENTE AUTOMATIZADA';
        this.uiStateLabel.style.color = '#5a5a6e';
      } else if (this.energy < 0.6) {
        this.uiStateLabel.textContent = 'DESPERTANDO · CHISPA EN MOVIMIENTO';
        this.uiStateLabel.style.color = '#ffd600';
      } else {
        this.uiStateLabel.textContent = '⚡ CATARSIS CREATIVA · PODER HUMANO ⚡';
        this.uiStateLabel.style.color = '#00f5d4';
      }
    }

    // Narrative text evolves with energy
    if (this.uiNarrativeTxt && this._narrativeLines) {
      let idx = 0;
      for (let i = 0; i < this._narrativeLines.length; i++) {
        if (this.energy >= this._narrativeLines[i].thresh) idx = i;
      }
      if (idx !== this._lastNarrativeIdx) {
        this._lastNarrativeIdx = idx;
        this.uiNarrativeTxt.style.opacity = '0';
        setTimeout(() => {
          if (this.uiNarrativeTxt) {
            this.uiNarrativeTxt.textContent = this._narrativeLines[idx].text;
            this.uiNarrativeTxt.style.opacity = '1';
          }
        }, 300);
      }
    }

    // Bloom — muy controlado, nunca ciega las visuales del fondo
    this.bloomPass.strength  = THREE.MathUtils.lerp(0.08, 0.72, this.energy);
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.92, 0.42, this.energy);
    this.bloomPass.radius    = THREE.MathUtils.lerp(0.25, 0.55, this.energy);

    this.updateUIEnergy(this.energy);
  }

  /* ══════════════════════════════════════════════════════════
     CINEMATIC CAMERA
  ══════════════════════════════════════════════════════════ */
  _updateCamera(delta, time, energy) {
    // After 8s idle, slowly resume gentle auto-orbit
    if (this._camUserMoved && !this.isInteracting) {
      this._camIdleTimer += delta;
      if (this._camIdleTimer > 8.0) {
        this._camAutoActive = true;
      }
    }

    if (this._camAutoActive && !this.isInteracting) {
      // Slow cinematic orbit
      const orbitSpeed = 0.025 + energy * 0.04;
      this._camAutoAngle += delta * orbitSpeed;

      const radius = 11.5 - energy * 1.8; // camera pulls closer at high energy
      const height = 5.5 - energy * 1.2;  // camera drops lower at high energy

      const targetX = -0.8 + Math.sin(this._camAutoAngle) * radius;
      const targetZ =        Math.cos(this._camAutoAngle) * radius;

      // Smooth lerp camera position (don't snap)
      this.camera.position.x += (targetX - this.camera.position.x) * 0.008;
      this.camera.position.y += (height  - this.camera.position.y) * 0.008;
      this.camera.position.z += (targetZ - this.camera.position.z) * 0.008;

      // Subtle camera shake at very high energy
      if (energy > 0.85) {
        const shake = (energy - 0.85) * 0.04;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     ANIMATION LOOP
  ══════════════════════════════════════════════════════════ */
  _animate() {
    requestAnimationFrame(() => this._animate());

    const now   = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    const time  = (now - this.startTime) / 1000;
    this.lastTime = now;

    this._updateEnergy(delta);

    const vel = this.turntable.angularVelocity;
    const e   = this.energy;

    // Update all modules
    this.turntable.update(delta, e);
    this.human.update(delta, e, time);
    this.particles.update(delta, e, time, vel);
    this.audio.update(vel, e);
    this.bg.update(e, time);
    this.glitchPass.update(e, time);

    // Dynamic rim lights — max intensity capped to keep background visible
    const hue = (time * 0.07) % 1.0;
    const li  = 0.6 + e * 1.8;  // was 0.8 + e*5.5 — now max 2.4 instead of 6.3
    this.rimA.intensity = li;
    this.rimB.intensity = li;
    this.rimC.intensity = 0.3 + e * 1.0;  // was 0.4 + e*3.2
    this.rimA.color.setHSL(hue, 1.0, 0.55);
    this.rimB.color.setHSL((hue + 0.5) % 1.0, 1.0, 0.55);
    this.rimC.color.setHSL((hue + 0.3) % 1.0, 1.0, 0.55);
    this.rimA.position.x = -6 + Math.sin(time * 0.55) * 2.2;
    this.rimB.position.x =  5 + Math.cos(time * 0.48) * 2.2;
    this.rimA.position.z = -3 + Math.cos(time * 0.3 ) * 1.5;
    this.rimB.position.z = -2 + Math.sin(time * 0.35) * 1.5;

    // Ambient reacts to energy — stays subtle so background stays dark
    this.ambientLight.intensity = 0.15 + e * 0.35;
    this.ambientLight.color.setHSL((hue + 0.25) % 1.0, 0.3 + e * 0.4, 0.06 + e * 0.08);

    // Cinematic camera
    this._updateCamera(delta, time, e);

    // Audio visualizer (only if audio started)
    if (this.hasStarted) {
      this._ensureAnalyser();
      this._drawVisualizer(e);
    }

    this.controls.update();
    this.composer.render();
  }
}

new App();
