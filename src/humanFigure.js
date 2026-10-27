import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   HUMAN SHADER — Carbón/Obsidiana → Ser de Luz con Fresnel + Plasma
   Vertex displacement con ruido 3D cuando energy es alto
   Compatible con UnrealBloomPass (emissive explota en alta energía)
   ══════════════════════════════════════════════════════════════════════════ */

const humanVert = `
uniform float u_energy;
uniform float u_time;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

/* ── 3D Value Noise for vertex displacement ── */
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i),           hash3(i+vec3(1,0,0)), u.x),
        mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),u.x), u.y),
    mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),u.x),
        mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),u.x), u.y), u.z
  );
}

void main() {
  vUv = uv;

  vec4 worldPos  = modelMatrix * vec4(position, 1.0);
  vWorldPos      = worldPos.xyz;
  vViewDir       = normalize(cameraPosition - worldPos.xyz);
  vNormal        = normalize(mat3(modelMatrix) * normal);

  /* ── Vertex displacement: plasma pulsation at high energy ── */
  float disp    = noise3(vWorldPos * 2.8 + u_time * 0.9) * 2.0 - 1.0;
  float dispAmt = u_energy * u_energy * 0.16;
  vec3 displaced = position + normal * disp * dispAmt;

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(displaced, 1.0);
}
`;

const humanFrag = `
precision highp float;

uniform float u_energy;
uniform float u_time;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

/* ── Inigo Quilez cosine palette ── */
vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 rainbowColor(float t) {
  return iqPalette(t,
    vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 1.0), vec3(0.00, 0.33, 0.67)
  );
}

/* ── Hash / noise ── */
float hash(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3f(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}

float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3f(i),hash3f(i+vec3(1,0,0)),u.x),
                 mix(hash3f(i+vec3(0,1,0)),hash3f(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(hash3f(i+vec3(0,0,1)),hash3f(i+vec3(1,0,1)),u.x),
                 mix(hash3f(i+vec3(0,1,1)),hash3f(i+vec3(1,1,1)),u.x),u.y),u.z);
}

void main() {
  /* ── Fresnel ── */
  float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
  fresnel = pow(fresnel, 2.2);

  /* ── Vertical emanation: chest + hands ── */
  float chest    = smoothstep(0.2, 1.8, vWorldPos.y);
  float fromHead = smoothstep(2.2, 3.6, vWorldPos.y);
  float emanation = chest + fromHead * 0.75;

  /* ── Surface noise ── */
  float nz  = noise(vUv * 9.0 + u_time * 0.25);
  float nz3 = noise3(vWorldPos * 3.0 + u_time * 0.4);

  /* ── LOW ENERGY: Obsidian / cracked coal ── */
  /* Fracture lines: thin bright cracks in dark stone */
  float fracture  = smoothstep(0.47, 0.5, noise(vUv * 14.0 + u_time * 0.015));
  float fracture2 = smoothstep(0.47, 0.5, noise(vUv * 7.0  - u_time * 0.01 + vec2(3.7, 1.1)));
  float cracks    = max(fracture, fracture2);
  vec3 obsidian   = mix(vec3(0.03, 0.025, 0.04), vec3(0.14, 0.12, 0.18), cracks);
  float roughLit  = max(0.0, dot(vNormal, normalize(vec3(0.5, 1.0, 0.8))));
  vec3 lowState   = obsidian * (0.35 + roughLit * 0.4) + vec3(0.06, 0.04, 0.08) * cracks * (1.0 - u_energy);

  /* ── HIGH ENERGY: Rainbow Fresnel + Plasma field ── */
  float hue      = emanation * 0.65 + fresnel * 0.35 + u_time * 0.07;
  vec3  rainbow  = rainbowColor(hue);

  /* Body surface: iridescent skin */
  float bodyHue  = nz3 + u_time * 0.04;
  vec3  bodySurf = rainbowColor(bodyHue) * (0.25 + roughLit * 0.55);

  /* Fresnel edge glow */
  vec3 edgeGlow  = rainbow * fresnel * 5.0;

  /* Plasma energy lines flowing through the body */
  float plasma   = sin(vWorldPos.y * 9.0 + u_time * 5.0) * 0.5 + 0.5;
  plasma        *= sin(vWorldPos.x * 7.0 - u_time * 3.5) * 0.5 + 0.5;
  plasma        *= sin(vWorldPos.z * 6.0 + u_time * 4.0) * 0.5 + 0.5;
  plasma         = pow(plasma, 2.0);
  vec3 plasmaCol = rainbowColor(plasma + u_time * 0.08) * u_energy * 3.2;

  /* Emanation rays from chest/hands */
  float rayPulse = 0.65 + 0.35 * sin(u_time * 7.0 + vWorldPos.y * 3.5);
  vec3  rayGlow  = rainbowColor(hue + 0.3) * emanation * rayPulse * 4.0;

  vec3 highState = bodySurf + edgeGlow + rayGlow + plasmaCol;

  /* ── Emissive for bloom — controlled so bloom doesn't blind ── */
  float emStr = u_energy * u_energy * 2.2;  // was 7.5
  vec3  emissive = (edgeGlow * 0.6 + plasmaCol * 0.3) * emStr;

  /* ── Blend ── */
  vec3 finalColor = mix(lowState, highState, u_energy);
  finalColor += emissive;
  finalColor += obsidian * 0.04;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   HumanFigure
   ══════════════════════════════════════════════════════════════════════════ */
export class HumanFigure {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(-0.8, 0.25, 0);

    this.orbitRings  = [];
    this.ribbons     = [];
    this.lightRays   = [];
    this.energyOrbs  = [];
    this.leftArm     = null;
    this.rightArm    = null;
    this.headGroup   = null;
    this.crownHalo   = null;
    this.glitchAccum = 0;

    // Inner lights (attached to group — the being IS the light source)
    this.innerLight1 = null;
    this.innerLight2 = null;
    this.innerLight3 = null;

    // Shared ShaderMaterial
    this.uniforms = {
      u_energy: { value: 0.0 },
      u_time:   { value: 0.0 },
    };
    this.shaderMat = new THREE.ShaderMaterial({
      uniforms:       this.uniforms,
      vertexShader:   humanVert,
      fragmentShader: humanFrag,
      side:           THREE.FrontSide,
    });

    this._buildBody();
    this._buildOrbitRings();
    this._buildLightRays();
    this._buildRibbons();
    this._buildCrown();
    this._buildEnergyOrbs();
    this._buildInnerLights();

    this.scene.add(this.group);
  }

  _sm(geo) { return new THREE.Mesh(geo, this.shaderMat); }

  _buildBody() {
    /* TORSO */
    const torso = this._sm(new THREE.CylinderGeometry(0.62, 0.42, 1.85, 14, 8));
    torso.position.y = 1.1;
    this.group.add(torso);

    /* SHOULDERS */
    const shoulders = this._sm(new THREE.BoxGeometry(2.1, 0.3, 0.58));
    shoulders.position.y = 1.92;
    this.group.add(shoulders);

    /* NECK */
    const neck = this._sm(new THREE.CylinderGeometry(0.22, 0.26, 0.48, 10));
    neck.position.y = 2.12;
    this.group.add(neck);

    /* HEAD */
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 2.66, 0);
    const head = this._sm(new THREE.IcosahedronGeometry(0.62, 4));
    this.headGroup.add(head);

    this.headWireMat = new THREE.MeshBasicMaterial({
      color: 0x330044, wireframe: true, transparent: true, opacity: 0.14,
    });
    const headWire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.64, 4), this.headWireMat);
    this.headGroup.add(headWire);
    this.group.add(this.headGroup);

    /* ARMS */
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-1.1, 1.92, 0);
    const lUpper = this._sm(new THREE.CylinderGeometry(0.11, 0.09, 0.85, 10, 4));
    lUpper.position.y = -0.42;
    this.leftArm.add(lUpper);
    const lFore = this._sm(new THREE.CylinderGeometry(0.09, 0.07, 0.75, 10, 4));
    lFore.position.y = -1.05;
    this.leftArm.add(lFore);
    const lHand = this._sm(new THREE.IcosahedronGeometry(0.15, 3));
    lHand.position.y = -1.48;
    this.leftArm.add(lHand);
    this.group.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(1.1, 1.92, 0);
    const rUpper = this._sm(new THREE.CylinderGeometry(0.11, 0.09, 0.85, 10, 4));
    rUpper.position.y = -0.42;
    this.rightArm.add(rUpper);
    const rFore = this._sm(new THREE.CylinderGeometry(0.09, 0.07, 0.75, 10, 4));
    rFore.position.y = -1.05;
    this.rightArm.add(rFore);
    const rHand = this._sm(new THREE.IcosahedronGeometry(0.15, 3));
    rHand.position.y = -1.48;
    this.rightArm.add(rHand);
    this.group.add(this.rightArm);

    /* PELVIS / LEGS */
    const pelvis = this._sm(new THREE.CylinderGeometry(0.42, 0.35, 0.55, 12, 3));
    pelvis.position.y = 0.1;
    this.group.add(pelvis);

    const lLeg = this._sm(new THREE.CylinderGeometry(0.18, 0.14, 1.4, 10, 4));
    lLeg.position.set(-0.28, -0.9, 0);
    this.group.add(lLeg);
    const rLeg = this._sm(new THREE.CylinderGeometry(0.18, 0.14, 1.4, 10, 4));
    rLeg.position.set( 0.28, -0.9, 0);
    this.group.add(rLeg);
  }

  _buildOrbitRings() {
    const cfgs = [
      { r:1.05, tube:0.016, color:0xff0055, speed:0.9,  tilt:0.3,  thresh:0.2  },
      { r:1.55, tube:0.013, color:0x00f5d4, speed:-0.7, tilt:1.1,  thresh:0.38 },
      { r:2.1,  tube:0.011, color:0xffd600, speed:1.3,  tilt:0.7,  thresh:0.52 },
      { r:2.7,  tube:0.009, color:0x7928ca, speed:-1.1, tilt:1.55, thresh:0.67 },
      { r:3.2,  tube:0.007, color:0x00aaff, speed:0.6,  tilt:0.45, thresh:0.8  },
    ];
    for (const c of cfgs) {
      const mat = new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(c.r, c.tube, 10, 90), mat);
      ring.rotation.x = c.tilt; ring.rotation.z = c.tilt * 0.5;
      ring.position.set(0, 1.4, 0);
      this.orbitRings.push({ mesh: ring, mat, cfg: c });
      this.group.add(ring);
    }
  }

  _buildLightRays() {
    const colors = [0xff0000,0xff6600,0xffff00,0x00ff44,0x0099ff,0xaa00ff,0xff0088,0x00ffff];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const mat   = new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0 });
      const ray   = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, 1.0, 4), mat);
      ray.position.set(Math.cos(angle) * 0.15, 1.35, Math.sin(angle) * 0.15);
      const spread = 0.75;
      ray.rotation.z = Math.cos(angle) * spread;
      ray.rotation.x = Math.sin(angle) * spread;
      this.lightRays.push({ mesh: ray, mat, angle, i });
      this.group.add(ray);
    }
  }

  _buildRibbons() {
    for (let r = 0; r < 6; r++) {
      const count     = 100;
      const positions = new Float32Array(count * 3);
      const geo       = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color().setHSL(r / 6, 1.0, 0.6),
        transparent: true, opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.ribbons.push({ line, mat, positions, geo, seed: r * 137.5 });
      this.group.add(line);
    }
  }

  _buildCrown() {
    this.crownMat = new THREE.MeshBasicMaterial({ color: 0xffd600, transparent: true, opacity: 0 });
    this.crownHalo = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.022, 10, 64), this.crownMat);
    this.crownHalo.position.set(0, 3.4, 0);
    this.crownHalo.rotation.x = Math.PI / 2;
    this.group.add(this.crownHalo);

    // Second outer crown ring
    this.crownMat2 = new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0 });
    const crownOuter = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.014, 10, 64), this.crownMat2);
    crownOuter.position.set(0, 3.38, 0);
    crownOuter.rotation.x = Math.PI / 2;
    this.group.add(crownOuter);
  }

  _buildEnergyOrbs() {
    const configs = [
      { r:0.85, y:1.4, speed:1.8,  thresh:0.3,  size:0.08 },
      { r:1.2,  y:2.1, speed:-1.3, thresh:0.35, size:0.07 },
      { r:1.5,  y:0.9, speed:2.2,  thresh:0.4,  size:0.065},
      { r:0.7,  y:2.8, speed:-2.5, thresh:0.45, size:0.06 },
      { r:1.85, y:1.6, speed:1.1,  thresh:0.5,  size:0.055},
      { r:1.1,  y:0.4, speed:-1.6, thresh:0.55, size:0.05 },
      { r:2.1,  y:2.4, speed:3.0,  thresh:0.6,  size:0.045},
      { r:0.95, y:3.1, speed:-0.9, thresh:0.65, size:0.055},
      { r:1.7,  y:1.1, speed:2.8,  thresh:0.7,  size:0.04 },
      { r:2.4,  y:1.9, speed:-1.4, thresh:0.75, size:0.045},
      { r:1.3,  y:2.6, speed:1.9,  thresh:0.8,  size:0.05 },
      { r:0.6,  y:1.7, speed:-3.2, thresh:0.85, size:0.06 },
    ];
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(i / configs.length, 1.0, 0.75),
        transparent: true, opacity: 0,
      });
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(cfg.size, 1), mat);
      orb.userData = { angle: Math.random() * Math.PI * 2, ...cfg, mat };
      this.energyOrbs.push(orb);
      this.group.add(orb);
    }
  }

  _buildInnerLights() {
    // Lights attached to the group — the being emits light at high energy
    this.innerLight1 = new THREE.PointLight(0xff0055, 0, 9);
    this.innerLight1.position.set(0, 1.4, 0.35);
    this.group.add(this.innerLight1);

    this.innerLight2 = new THREE.PointLight(0x00f5d4, 0, 7);
    this.innerLight2.position.set(0, 2.9, 0);
    this.group.add(this.innerLight2);

    this.innerLight3 = new THREE.PointLight(0xffd600, 0, 11);
    this.innerLight3.position.set(0, 0.8, 0.2);
    this.group.add(this.innerLight3);
  }

  /* ══════════════════════════════════════════════════════════════════════
     UPDATE — called every frame
  ══════════════════════════════════════════════════════════════════════ */
  update(delta, energy, time) {
    const e = Math.max(0, Math.min(1, energy));

    this.uniforms.u_energy.value = e;
    this.uniforms.u_time.value   = time;

    /* Arm raise */
    const raise = THREE.MathUtils.lerp(1.3, -1.55, e);
    if (this.leftArm)  this.leftArm.rotation.z  =  raise;
    if (this.rightArm) this.rightArm.rotation.z = -raise;

    /* Head pose */
    if (this.headGroup) {
      const pitch = THREE.MathUtils.lerp(-0.4, 0.2, e);
      this.headGroup.rotation.x += (pitch - this.headGroup.rotation.x) * 0.07;
      const breath = Math.sin(time * THREE.MathUtils.lerp(1.2, 6.5, e));
      this.headGroup.position.y = 2.66 + breath * 0.05 * e;
    }

    /* Head wireframe */
    if (this.headWireMat) {
      this.headWireMat.color.setHSL(((time * 0.1) % 1.0 + 0.2) % 1.0, 1.0, 0.7);
      this.headWireMat.opacity = THREE.MathUtils.lerp(0.06, 0.85, e);
    }

    const hue = (time * 0.1) % 1.0;

    /* Orbit rings */
    for (const { mesh, mat, cfg } of this.orbitRings) {
      mesh.rotation.y += delta * cfg.speed * (0.5 + e * 2.2);
      mesh.rotation.x += delta * cfg.speed * 0.28;
      const alpha = Math.max(0, (e - cfg.thresh) / (1 - cfg.thresh)) * 0.92;
      mat.opacity = alpha;
      mat.color.setHSL((hue + cfg.thresh) % 1.0, 1.0, 0.65);
      const pulse = 1 + Math.sin(time * 4.5 + cfg.thresh * 8) * 0.07 * e;
      mesh.scale.setScalar(pulse);
    }

    /* Light rays */
    for (const { mesh, mat, i } of this.lightRays) {
      const rayE = Math.max(0, (e - 0.45) / 0.55);
      mat.opacity = rayE * 0.95;
      mesh.scale.y = 0.3 + rayE * 3.2;
      const pulse = 1 + Math.sin(time * 8 + i * 0.9) * 0.25 * e;
      mesh.scale.x = mesh.scale.z = pulse;
      mat.color.setHSL((i / this.lightRays.length + hue) % 1.0, 1.0, 0.75);
    }

    /* Rainbow ribbons */
    for (const { line, mat, positions, geo, seed } of this.ribbons) {
      const rE = Math.max(0, (e - 0.22) / 0.78);
      mat.opacity = rE * 0.9;
      mat.color.setHSL((seed * 0.01 + hue + time * 0.035) % 1.0, 1.0, 0.65);
      const count = positions.length / 3;
      const oY = 1.85 + (seed % 3) * 0.3;
      const oX = seed % 2 === 0 ? -0.9 : 0.9;
      const phase = time * 2.8 + seed * 1.15;
      for (let v = 0; v < count; v++) {
        const t2 = v / count;
        positions[v*3]   = oX + Math.sin(t2 * 6.5 + phase) * t2 * 1.5 * rE;
        positions[v*3+1] = oY + t2 * (2.0 + rE * 3.2);
        positions[v*3+2] = Math.cos(t2 * 5.5 + phase + seed) * t2 * 1.0 * rE;
      }
      geo.attributes.position.needsUpdate = true;
    }

    /* Crown */
    if (this.crownHalo && this.crownMat) {
      const cE = Math.max(0, (e - 0.65) / 0.35);
      this.crownMat.opacity  = cE * 0.95;
      if (this.crownMat2) this.crownMat2.opacity = cE * 0.7;
      this.crownMat.color.setHSL(hue, 1.0, 0.75);
      if (this.crownMat2) this.crownMat2.color.setHSL((hue + 0.5) % 1.0, 1.0, 0.75);
      this.crownHalo.rotation.z += delta * (0.8 + e * 2.5);
    }

    /* Energy orbs */
    for (const orb of this.energyOrbs) {
      const od = orb.userData;
      od.angle += delta * od.speed * (0.4 + e * 2.5);
      const yBob = Math.sin(od.angle * 2.1 + time * 0.7) * 0.28;
      orb.position.set(
        Math.cos(od.angle) * od.r,
        od.y + yBob,
        Math.sin(od.angle) * od.r
      );
      const orbE = Math.max(0, (e - od.thresh) / (1 - od.thresh));
      od.mat.opacity = orbE * 0.88;
      od.mat.color.setHSL((hue + od.thresh * 0.5) % 1.0, 1.0, 0.8);
      const orbScale = 0.5 + orbE * 1.2 + Math.sin(time * 4 + od.thresh * 10) * 0.15 * orbE;
      orb.scale.setScalar(orbScale);
    }

    /* Inner lights — intensities capped so they don't wash out the scene */
    if (this.innerLight1) {
      const lHue = (time * 0.14) % 1.0;
      const pulse = 0.85 + 0.15 * Math.sin(time * 5.5);
      this.innerLight1.intensity = e * e * 3.5 * pulse;  // was 9.0 — now max ~3.5
      this.innerLight2.intensity = e * e * 2.2;           // was 5.5
      this.innerLight3.intensity = e * 1.4;               // was 3.5
      this.innerLight1.color.setHSL(lHue, 1.0, 0.6);
      this.innerLight2.color.setHSL((lHue + 0.33) % 1.0, 1.0, 0.6);
      this.innerLight3.color.setHSL((lHue + 0.67) % 1.0, 1.0, 0.6);
      // Oscillate light positions slightly
      this.innerLight1.position.x = Math.sin(time * 2.2) * 0.3;
      this.innerLight2.position.x = Math.cos(time * 1.8) * 0.2;
    }

    /* Glitch at high energy */
    this.glitchAccum += delta;
    if (e > 0.8 && this.glitchAccum > 3.0 + Math.random() * 4.0) {
      this.glitchAccum = 0;
      const ox = this.group.position.x;
      this.group.position.x += (Math.random() - 0.5) * 0.28 * e;
      this.group.scale.setScalar(1 + (Math.random() - 0.5) * 0.08 * e);
      setTimeout(() => {
        this.group.position.x = ox;
        this.group.scale.setScalar(1);
      }, 60);
    }
  }
}
