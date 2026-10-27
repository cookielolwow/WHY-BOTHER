import * as THREE from 'three';

/**
 * VinylTurntable — Real DJ Turntable with Scratch / Spin Physics
 * Supports: spin-up, spin-down, scratch, nudge, spinback
 */
export class VinylTurntable {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.platter = new THREE.Group(); // spinning part

    // ── Physics state ───────────────────────────────────────────────────────
    this.rotationAngle   = 0;
    this.angularVelocity = 0;   // rad/s (positive = forward)
    this.targetVelocity  = 0;
    this.friction        = 0.985; // platter coasts
    this.motorStrength   = 0.04;  // acceleration toward natural speed
    this.naturalSpeed    = 0.55;  // rad/s at 33⅓ RPM

    // ── Drag state ─────────────────────────────────────────────────────────
    this.isDragging        = false;
    this.lastPointerAngle  = 0;
    this.prevVelocity      = 0;   // for scratch detection
    this.dragVelocity      = 0;

    // ── Refs for animation ─────────────────────────────────────────────────
    this.vinylMat       = null;
    this.vinylShaderMat = null;
    this.labelTex   = null;
    this.ledMat     = null;
    this.hitDisc    = null;
    this.faderKnob  = null;
    this.needleGroup = null;

    this._build();
    this.scene.add(this.group);
  }

  // ── IRIDESCENT VINYL SHADER MATERIAL ─────────────────────────────────────
  _makeVinylShader() {
    const vinylVert = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        vNormal  = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const vinylFrag = `
      precision highp float;
      uniform float u_energy;
      uniform float u_time;
      uniform float u_rotation;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
        return a + b * cos(6.28318 * (c * t + d));
      }
      vec3 vinylRainbow(float t) {
        return iqPalette(t,
          vec3(0.5,0.5,0.5), vec3(0.5,0.5,0.5),
          vec3(1.0,1.0,1.0), vec3(0.00,0.33,0.67));
      }

      void main() {
        vec2 centered = vUv - 0.5;
        float r   = length(centered) * 2.0;          // 0=center 1=edge
        float theta = atan(centered.y, centered.x);   // angle -PI..PI

        /* Groove rings — dense concentric lines */
        float groove = sin(r * 220.0) * 0.5 + 0.5;

        /* Fresnel — bright at grazing angles */
        float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.8);

        /* Iridescent angle: rainbow shifts with rotation */
        float hue = (theta + u_rotation) / 6.28318 + r * 0.25 + u_time * 0.018;
        vec3  iri = vinylRainbow(hue);

        /* Label area: solid black center */
        float isLabel = smoothstep(0.37, 0.35, r);

        /* Dark vinyl base with iridescent groove shimmer */
        vec3 darkBase = vec3(0.03, 0.025, 0.04);
        float iridAmt = groove * fresnel * (0.25 + u_energy * 0.75);
        vec3  col = mix(darkBase, iri, iridAmt);

        /* At high energy, grooves emit light (bloom bait) */
        float emissive = groove * u_energy * u_energy * 1.8 * fresnel;
        col += iri * emissive;

        /* Black label region */
        col = mix(col, darkBase, isLabel);

        gl_FragColor = vec4(col, 1.0);
      }
    `;
    return new THREE.ShaderMaterial({
      uniforms: {
        u_energy:   { value: 0.0 },
        u_time:     { value: 0.0 },
        u_rotation: { value: 0.0 },
      },
      vertexShader:   vinylVert,
      fragmentShader: vinylFrag,
      side: THREE.DoubleSide,
    });
  }

  // ── LABEL CANVAS TEXTURE ──────────────────────────────────────────────────
  _makeLabel() {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    // Deep black base
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, S, S);

    // Iridescent radial gradient (soap bubble / prism reference)
    const g = ctx.createRadialGradient(S/2, S/2, 20, S/2, S/2, S/2);
    g.addColorStop(0.0,  'rgba(255,255,255,0.9)');
    g.addColorStop(0.08, 'rgba(255,0,128,0.7)');
    g.addColorStop(0.18, 'rgba(0,245,212,0.6)');
    g.addColorStop(0.30, 'rgba(255,214,0,0.55)');
    g.addColorStop(0.42, 'rgba(121,40,202,0.5)');
    g.addColorStop(0.55, 'rgba(0,87,255,0.45)');
    g.addColorStop(0.68, 'rgba(255,0,85,0.4)');
    g.addColorStop(0.80, 'rgba(0,245,212,0.3)');
    g.addColorStop(1.0,  'rgba(5,5,10,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // Concentric decorative rings
    for (let r = 60; r < 500; r += 24) {
      ctx.beginPath();
      ctx.arc(S/2, S/2, r, 0, Math.PI * 2);
      const alpha = 0.04 + (r / 500) * 0.12;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = r % 72 === 0 ? 2.5 : 1;
      ctx.stroke();
    }

    // Center hole
    ctx.fillStyle = '#05050a';
    ctx.beginPath();
    ctx.arc(S/2, S/2, 38, 0, Math.PI * 2);
    ctx.fill();

    // WHY BOTHER text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 70px Impact, Arial Black, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 18;
    ctx.fillText('WHY BOTHER?', S/2, 260);

    ctx.font = '700 32px "Courier New", monospace';
    ctx.fillStyle = '#ffd600';
    ctx.shadowColor = '#ffd600';
    ctx.shadowBlur = 12;
    ctx.fillText('COMUNA 13 · MEDELLÍN', S/2, 340);

    ctx.font = 'italic 600 24px sans-serif';
    ctx.fillStyle = 'rgba(224,224,224,0.85)';
    ctx.shadowBlur = 0;
    ctx.fillText('"Soltó las armas, agarró las barras"', S/2, 660);

    ctx.font = '700 28px monospace';
    ctx.fillStyle = '#00f5d4';
    ctx.fillText('SIDE A · 33⅓ RPM · STEREO', S/2, 720);

    return new THREE.CanvasTexture(cv);
  }

  // ── GROOVE TEXTURE ────────────────────────────────────────────────────────
  _makeGrooves() {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    ctx.fillStyle = '#09090e';
    ctx.fillRect(0, 0, S, S);

    // Dense microgrooves
    for (let r = 240; r < 500; r += 1.6) {
      const alpha = 0.05 + Math.random() * 0.12;
      ctx.strokeStyle = `rgba(200,200,220,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(S/2, S/2, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    return new THREE.CanvasTexture(cv);
  }

  _build() {
    const cx = -0.8; // offset so human figure can be centered

    // ── PLINTH (base cabinet) ────────────────────────────────────────────────
    const plinthGeo = new THREE.BoxGeometry(11, 0.75, 9.5);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x121218, roughness: 0.3, metalness: 0.75,
    });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(cx, -0.42, 0);
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // Top panel
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24, roughness: 0.2, metalness: 0.88,
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.07, 9.3), panelMat);
    panel.position.set(cx, -0.02, 0);
    this.group.add(panel);

    // ── PITCH FADER ──────────────────────────────────────────────────────────
    const faderTrack = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.04, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.9 })
    );
    faderTrack.position.set(cx + 4.3, 0.03, 1.2);
    this.group.add(faderTrack);

    const faderKnobMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8, metalness: 0.92, roughness: 0.15,
    });
    this.faderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.18, 0.38), faderKnobMat);
    this.faderKnob.position.set(cx + 4.3, 0.1, 1.2);
    this.group.add(this.faderKnob);

    // ── STATUS LED ───────────────────────────────────────────────────────────
    this.ledMat = new THREE.MeshStandardMaterial({
      color: 0xff0044,
      emissive: 0xff0044,
      emissiveIntensity: 0.9,
      roughness: 0.05,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), this.ledMat);
    led.position.set(cx - 4.4, 0.15, -3.5);
    this.group.add(led);

    const ledBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.44, 0.35, 20),
      new THREE.MeshStandardMaterial({ color: 0x0f0f16, metalness: 0.8 })
    );
    ledBase.position.set(cx - 4.4, 0.13, -3.5);
    this.group.add(ledBase);

    // ── SPINNING PLATTER ─────────────────────────────────────────────────────
    this.platter.position.set(cx, 0.06, 0);

    // Aluminum platter base
    const platterMat = new THREE.MeshStandardMaterial({
      color: 0x7a7a88, metalness: 0.95, roughness: 0.2,
    });
    this.group.add(this.platter);
    const platterDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.85, 3.85, 0.22, 72),
      platterMat
    );
    platterDisc.position.y = 0.1;
    this.platter.add(platterDisc);

    // ── VINYL DISC ────────────────────────────────────────────────────────────
    const grooveTex = this._makeGrooves();
    this.vinylMat = new THREE.MeshStandardMaterial({
      color: 0x0c0c10,
      roughness: 0.18,
      metalness: 0.82,
      bumpMap: grooveTex,
      bumpScale: 0.025,
    });
    // Iridescent shader disc on top
    this.vinylShaderMat = this._makeVinylShader();
    const vinyl = new THREE.Mesh(
      new THREE.CylinderGeometry(3.72, 3.72, 0.042, 72),
      this.vinylShaderMat  // use iridescent shader
    );
    vinyl.position.y = 0.23;
    this.platter.add(vinyl);

    // ── IRIDESCENT SHADER VINYL (sits on top of groove vinyl) ────────────────
    this.vinylShaderMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        u_energy:   { value: 0 },
        u_time:     { value: 0 },
        u_rotation: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vUv    = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir   = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float u_energy;
        uniform float u_time;
        uniform float u_rotation;
        varying vec2  vUv;
        varying vec3  vNormal;
        varying vec3  vViewDir;

        /* IQ cosine palette */
        vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
          return a + b * cos(6.28318 * (c * t + d));
        }

        void main() {
          /* radial distance from disc centre */
          float r = length(vUv - 0.5) * 2.0;

          /* groove rings — tight concentric lines */
          float groove = sin(r * 180.0) * 0.5 + 0.5;

          /* angular position + rotation offset */
          float theta = atan(vUv.y - 0.5, vUv.x - 0.5) + u_rotation;

          /* Fresnel rim */
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.0);

          /* Rainbow shimmer via IQ palette */
          float t_pal = theta / 6.28318 + r * 0.3 + u_time * 0.02;
          vec3 iridColor = iqPalette(
            t_pal,
            vec3(0.5, 0.5, 0.5),
            vec3(0.5, 0.5, 0.5),
            vec3(1.0, 1.0, 1.0),
            vec3(0.00, 0.33, 0.67)
          );

          /* Dark base */
          vec3 base = vec3(0.020, 0.020, 0.063); // #050510

          /* Mix factor: groove ridges + fresnel rim, boosted by energy */
          float mix_f = groove * fresnel * (0.3 + u_energy * 0.7);

          /* Emissive glow at high energy */
          vec3 emissive = iridColor * u_energy * groove * 1.5;

          vec3 col = mix(base, iridColor, mix_f) + emissive;

          /* Fade toward centre (label area) and edge */
          float mask = smoothstep(0.38, 0.42, r) * smoothstep(1.02, 0.96, r);
          col = mix(vec3(0.0), col, mask);

          gl_FragColor = vec4(col, mask > 0.01 ? 1.0 : 0.0);
        }
      `,
      transparent: true,
    });

    const vinylShaderDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.72, 3.72, 0.001, 72),
      this.vinylShaderMat
    );
    vinylShaderDisc.position.y = 0.253; // sits just above groove vinyl
    this.platter.add(vinylShaderDisc);

    // ── LABEL ─────────────────────────────────────────────────────────────────
    this.labelTex = this._makeLabel();
    const labelMat = new THREE.MeshStandardMaterial({
      map: this.labelTex, roughness: 0.3, metalness: 0.1,
    });
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(1.38, 1.38, 0.046, 56),
      labelMat
    );
    label.position.y = 0.232;
    this.platter.add(label);

    // Spindle
    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0xddddee, metalness: 0.96, roughness: 0.08 })
    );
    spindle.position.y = 0.45;
    this.platter.add(spindle);

    // ── INVISIBLE HIT DISC (raycasting target) ──────────────────────────────
    const hitGeo = new THREE.CylinderGeometry(3.72, 3.72, 0.05, 48);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.hitDisc = new THREE.Mesh(hitGeo, hitMat);
    this.hitDisc.position.y = 0.26;
    this.platter.add(this.hitDisc);

    // ── TONEARM ───────────────────────────────────────────────────────────────
    this._buildTonearm(cx);
  }

  _buildTonearm(cx) {
    this.tonearmGroup = new THREE.Group();
    this.tonearmGroup.position.set(cx + 4.0, 0.22, -2.8);

    // Pivot base
    const pivMat = new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.9 });
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.6, 20), pivMat);
    this.tonearmGroup.add(pivot);

    // Arm pivot group (rotates for rest vs. play position)
    this.armPivot = new THREE.Group();
    this.armPivot.position.y = 0.5;

    // Counterweight
    const cwMat = new THREE.MeshStandardMaterial({ color: 0x1e1e28, metalness: 0.88 });
    const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.5, 20), cwMat);
    cw.rotation.x = Math.PI / 2;
    cw.position.z = -0.5;
    this.armPivot.add(cw);

    // Arm rod
    const armMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.96, roughness: 0.08 });
    const armRod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5.0, 12), armMat);
    armRod.rotation.x = Math.PI / 2;
    armRod.position.set(-0.35, 0, 2.2);
    this.armPivot.add(armRod);

    // Headshell
    this.needleGroup = new THREE.Group();
    this.needleGroup.position.set(-0.35, -0.12, 4.7);
    const headshell = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.48),
      new THREE.MeshStandardMaterial({ color: 0xff0044, roughness: 0.4 })
    );
    this.needleGroup.add(headshell);

    // Needle
    const needleGeo = new THREE.ConeGeometry(0.018, 0.14, 8);
    needleGeo.rotateX(Math.PI);
    const needle = new THREE.Mesh(
      needleGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95 })
    );
    needle.position.y = -0.12;
    this.needleGroup.add(needle);
    this.armPivot.add(this.needleGroup);

    this.armPivot.rotation.y = 0.38;
    this.tonearmGroup.add(this.armPivot);
    this.group.add(this.tonearmGroup);
  }

  // ── Interaction helpers ────────────────────────────────────────────────────
  _getAngle(worldPoint) {
    const lx = worldPoint.x - (this.group.position.x + this.platter.position.x);
    const lz = worldPoint.z - (this.group.position.z + this.platter.position.z);
    return Math.atan2(lz, lx);
  }

  startDrag(worldPoint) {
    this.isDragging = true;
    this.lastPointerAngle = this._getAngle(worldPoint);
    this.prevVelocity = this.angularVelocity;
  }

  drag(worldPoint) {
    if (!this.isDragging) return 0;
    const current = this._getAngle(worldPoint);
    let delta = current - this.lastPointerAngle;
    if (delta >  Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.lastPointerAngle = current;
    this.dragVelocity = delta * 55; // convert to rad/s estimate
    this.angularVelocity = this.dragVelocity;
    this.rotationAngle += delta;
    this.platter.rotation.y = this.rotationAngle;
    return this.dragVelocity;
  }

  endDrag() {
    this.isDragging = false;
    // Release: keep current velocity (the user "threw" the record)
  }

  nudge(amt = 2.8) {
    this.angularVelocity += amt;
  }

  // ── Per-frame update ────────────────────────────────────────────────────────
  update(delta, energy) {
    if (!this.isDragging) {
      // Motor drives toward natural speed proportional to energy
      const motor = this.naturalSpeed * (0.15 + energy * 1.85);
      if (this.angularVelocity < motor) {
        this.angularVelocity += (motor - this.angularVelocity) * this.motorStrength;
      } else {
        this.angularVelocity *= this.friction;
      }
      this.rotationAngle += this.angularVelocity * delta;
      this.platter.rotation.y = this.rotationAngle;
    }

    // ── LED pulse ──
    if (this.ledMat) {
      this.ledMat.emissiveIntensity = 0.5 + energy * 3.0;
      this.ledMat.emissive.setHSL(energy > 0.6 ? 0.5 : 0.0, 1, 0.5);
    }

    // ── Needle vibration ──
    if (this.needleGroup) {
      const wobble = Math.sin(Date.now() * 0.025) * 0.003 * Math.min(1, Math.abs(this.angularVelocity));
      this.needleGroup.position.y = -0.12 + wobble;
    }

    // ── Vinyl iridescence with energy ──
    if (this.vinylMat) {
      const shine = 0.82 - energy * 0.2;
      this.vinylMat.metalness = shine;
    }

    // ── Iridescent shader uniforms ──
    if (this.vinylShaderMat) {
      this.vinylShaderMat.uniforms.u_energy.value   = energy;
      this.vinylShaderMat.uniforms.u_time.value     += delta;
      this.vinylShaderMat.uniforms.u_rotation.value  = this.rotationAngle;
    }

    // ── Fader position ──
    if (this.faderKnob) {
      this.faderKnob.position.z = 1.2 - (energy - 0.5) * 1.8;
    }
  }
}
