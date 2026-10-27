import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   BACKGROUND FULLSCREEN SHADER
   Reaction-Diffusion simulada + FBM Domain Warping + Pixel Sorting GLSL
   Paleta de Inigo Quilez cosine-based
   Estado 0 → materia muerta, pixel sort, RGB shift, CRT noise
   Estado 1 → fluidos iridiscentes, redes neurales, burbuja de jabón
   ══════════════════════════════════════════════════════════════════════════ */

const bgVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Bypass projection — place quad at clip-space far plane, fullscreen always
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

const bgFrag = `
precision highp float;

uniform float u_energy;
uniform float u_time;
uniform vec2  u_resolution;

varying vec2 vUv;

/* ─────────────────────────────────────────────
   MATH UTILITIES
───────────────────────────────────────────── */
float hash(float n) { return fract(sin(n) * 43758.5453123); }

float hash2f(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2f(i + vec2(0,0)), hash2f(i + vec2(1,0)), u.x),
    mix(hash2f(i + vec2(0,1)), hash2f(i + vec2(1,1)), u.x),
    u.y
  );
}

/* FBM — Fractal Brownian Motion */
float fbm(vec2 p, int octaves) {
  float v   = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    v   += amp * noise(p * freq);
    freq *= 2.1;
    amp  *= 0.48;
  }
  return v;
}

/* Domain Warping (Inigo Quilez technique) */
float warpedFBM(vec2 p, float t, float energy) {
  float speed   = mix(0.03, 0.7, energy);
  int   octaves = int(mix(2.0, 7.0, energy));

  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * speed, octaves),
    fbm(p + vec2(5.2, 1.3) + t * speed * 0.9, octaves)
  );
  vec2 r = vec2(
    fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * speed * 0.7, octaves),
    fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * speed * 0.6, octaves)
  );
  return fbm(p + 4.0 * r, octaves);
}

/* Inigo Quilez cosine palette */
vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

/* Dark ash palette → vivid iridescent palette */
vec3 cosmicPalette(float t, float energy) {
  vec3 aD = vec3(0.07, 0.07, 0.09);
  vec3 bD = vec3(0.04, 0.04, 0.05);
  vec3 cD = vec3(0.5,  0.5,  0.5);
  vec3 dD = vec3(0.0,  0.1,  0.2);

  vec3 aB = vec3(0.5,  0.5,  0.5);
  vec3 bB = vec3(0.5,  0.5,  0.5);
  vec3 cB = vec3(1.0,  1.0,  1.0);
  vec3 dB = vec3(0.00, 0.33, 0.67);

  vec3 dark    = iqPalette(t, aD, bD, cD, dD);
  vec3 vibrant = iqPalette(t, aB, bB, cB, dB);
  return mix(dark, vibrant, energy);
}

/* Voronoi neural veins */
float neuralLines(vec2 uv, float t, float energy) {
  vec2 cell = floor(uv * 7.0);
  vec2 fr   = fract(uv * 7.0);
  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 nb    = vec2(float(x), float(y));
      vec2 point = hash2f(cell + nb + floor(t * 0.15)) * vec2(1.0) + nb;
      float dist = length(point - fr);
      minDist = min(minDist, dist);
    }
  }
  return 1.0 - smoothstep(0.0, 0.055 + (1.0 - energy) * 0.04, minDist);
}

/* ─────────────────────────────────────────────
   GLITCH EFFECTS (high at energy=0, gone at 1)
───────────────────────────────────────────── */

/* Pixel sorting — simulate by shifting rows by luminance */
vec3 pixelSort(vec2 uv, float t, float intensity, float fbmVal) {
  if (intensity < 0.02) return vec3(-1.0); // sentinel: skip
  float row   = floor(uv.x * u_resolution.x / 3.0);
  float thresh = hash(row + floor(t * 5.0) * 2.3);
  if (thresh > (1.0 - intensity * 0.55)) {
    float yShift = (hash(row * 1.7 + t * 0.9) - 0.35) * intensity * 0.22;
    // The "sorted" value is a shifted FBM sample in the sorted column
    float shifted = fbm(vec2(uv.x, fract(uv.y + yShift)) * 2.5 + t * 0.03, 3);
    return cosmicPalette(shifted, 0.0) * mix(0.3, 1.0, thresh);
  }
  return vec3(-1.0);
}

/* Block displacement */
vec2 blockDisplace(vec2 uv, float t, float intensity) {
  float stripH   = 0.035 + hash(floor(t * 7.0) * 3.7) * 0.1;
  float stripRow = floor(uv.y / stripH);
  float rand     = hash(stripRow + floor(t * 13.0) * 5.17);
  if (rand > (1.0 - intensity * 0.5)) {
    float shift = (hash(stripRow * 1.4 + t * 0.6) - 0.5) * intensity * 0.18;
    uv.x = fract(uv.x + shift);
  }
  return uv;
}

/* TV/static grain */
float staticGrain(vec2 uv, float t) {
  return (hash2f(uv * 487.3 + t * 23.1) - 0.5);
}

/* CRT scanlines */
float scanLine(vec2 uv, float t) {
  float sl = sin(uv.y * u_resolution.y * 1.2 + t * 55.0) * 0.5 + 0.5;
  return 1.0 - sl * 0.07;
}

/* ─────────────────────────────────────────────
   REACTION-DIFFUSION APPROXIMATION
   Simulated with multi-pass FBM + interference
───────────────────────────────────────────── */
vec3 reactionDiffusion(vec2 uv, float t, float energy) {
  /* Two chemical fields — A and B — approximate with FBM at different scales */
  float speed = mix(0.025, 0.8, energy);

  /* Field A: slow large structures */
  float A = fbm(uv * 1.8 + vec2(t * speed * 0.6, t * speed * 0.4), int(mix(2.0, 6.0, energy)));

  /* Field B: fast fine patterns — simulate diffusion rate difference */
  float B = fbm(uv * 4.5 + vec2(t * speed, -t * speed * 0.7) + vec2(3.1, 7.4), int(mix(2.0, 7.0, energy)));

  /* Gray-Scott-like: where A-B creates spots/labyrinths */
  float reaction = A * (1.0 - B) - B * 0.05;
  reaction = fract(reaction * 2.3 + t * 0.012);

  /* Domain-warped version for organic fluid look */
  float warped = warpedFBM(uv * 2.2, t, energy);

  /* Blend: at low energy → pure reaction patterns (dead), at high → fluid warp */
  float f = mix(reaction, warped, energy);

  /* Color */
  vec3 col = cosmicPalette(f + t * 0.035, energy);

  /* Neural veins overlay */
  float veins  = neuralLines(uv, t, energy);
  float veins2 = neuralLines(uv * 0.45 + vec2(t * 0.008, 0.0), t * 0.6, energy);
  vec3 vCol1   = cosmicPalette(f + 0.28 + t * 0.055, energy);
  vec3 vCol2   = cosmicPalette(f + 0.62 + t * 0.09,  energy);
  col += vCol1 * veins  * (0.12 + energy * 0.88);
  col += vCol2 * veins2 * (0.06 + energy * 0.42);

  return col;
}

/* ─────────────────────────────────────────────
   MAIN
───────────────────────────────────────────── */
void main() {
  vec2 uv = vUv;
  float glitch = (1.0 - u_energy);
  glitch = glitch * glitch; // quadratic falloff

  /* Block displacement at low energy */
  vec2 warpedUV = uv;
  if (glitch > 0.01) {
    warpedUV = blockDisplace(uv, u_time, glitch);
  }

  /* Base reaction-diffusion color */
  vec3 col = reactionDiffusion(warpedUV * 1.0 - vec2(0.5), u_time, u_energy);

  /* RGB shift (chromatic aberration) at low energy */
  float rgbAmt = glitch * 0.022;
  if (rgbAmt > 0.001) {
    vec2 dir = normalize(warpedUV - 0.5);
    vec3 rdR = reactionDiffusion((warpedUV + dir * rgbAmt) * 1.0 - vec2(0.5), u_time, u_energy);
    vec3 rdB = reactionDiffusion((warpedUV - dir * rgbAmt) * 1.0 - vec2(0.5), u_time, u_energy);
    col = vec3(rdR.r, col.g, rdB.b);
  }

  /* Pixel sorting at low energy */
  if (glitch > 0.04) {
    float fVal = fbm(warpedUV * 2.5 + u_time * 0.03, 3);
    vec3 sorted = pixelSort(warpedUV, u_time, glitch, fVal);
    if (sorted.r >= 0.0) {
      col = mix(col, sorted, glitch * 0.7);
    }
  }

  /* Static grain overlay */
  float gr = staticGrain(uv, u_time);
  col += gr * glitch * 0.13;

  /* CRT scanlines */
  col *= mix(1.0, scanLine(uv, u_time), glitch * 0.65);

  /* Vignette */
  vec2 vpos = uv * 2.0 - 1.0;
  float vig = 1.0 - dot(vpos * vec2(0.48, 0.68), vpos * vec2(0.48, 0.68));
  vig = pow(max(0.0, vig), 0.35 + u_energy * 0.35);
  col *= mix(vig * 0.55, vig, u_energy * 0.85 + 0.15);

  /* Overall brightness */
  float brightness = mix(0.11, 1.0, u_energy);
  col *= brightness;

  /* Saturation boost */
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum) * 0.5, col, 0.35 + u_energy * 0.65);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class BackgroundShader {
  constructor(scene) {
    this.uniforms = {
      u_energy:     { value: 0.0 },
      u_time:       { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    };

    // Fullscreen quad — vertex shader bypasses projection, always covers screen
    const geo = new THREE.PlaneGeometry(2, 2);

    this.material = new THREE.ShaderMaterial({
      uniforms:       this.uniforms,
      vertexShader:   bgVert,
      fragmentShader: bgFrag,
      depthWrite:     false,
      depthTest:      false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder    = -998; // renders ON TOP of particleSystem (-999) as a blended overlay
    this.mesh.frustumCulled  = false;
    this.material.transparent = true;
    this.material.blending = THREE.AdditiveBlending;
    scene.add(this.mesh);

    window.addEventListener('resize', () => {
      this.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
    });
  }

  /** Call each frame */
  update(energy, time) {
    this.uniforms.u_energy.value = energy;
    this.uniforms.u_time.value   = time;
    // Blend opacity: at low energy this overlay is nearly invisible (particleSystem dominates)
    // At high energy add a vivid neural vein layer on top
    this.material.opacity = energy * 0.55;
  }
}
