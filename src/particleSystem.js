import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// GLSL Vertex Shader
// Bypasses the projection matrix entirely — places the quad in clip space
// filling the screen at the far plane (z = 0.999).
// ─────────────────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Bypass model/view/projection — quad always fills clip space
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GLSL Fragment Shader
// ─────────────────────────────────────────────────────────────────────────────
const fragmentShader = /* glsl */`
  precision highp float;

  uniform float u_time;
  uniform float u_energy;
  uniform vec2  u_resolution;

  varying vec2 vUv;

  // ── Hash & noise ──────────────────────────────────────────────────────────

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Smooth value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Fractal Brownian Motion — octave count scales with energy
  float fbm(vec2 p, int octaves) {
    float val  = 0.0;
    float amp  = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      val  += amp  * noise(p * freq);
      amp  *= 0.5;
      freq *= 2.0;
    }
    return val;
  }

  // Inigo Quilez domain-warped FBM (2 passes)
  float warpedFBM(vec2 p, float t, float energy) {
    int oct = 2 + int(energy * 5.0); // 2 at energy=0, 7 at energy=1

    // First warp offset
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.15, oct),
      fbm(p + vec2(5.2, 1.3) + t * 0.15, oct)
    );

    // Second warp offset (deeper)
    float warpAmt = 0.5 + energy * 2.5;
    vec2 r = vec2(
      fbm(p + warpAmt * q + vec2(1.7, 9.2) + t * 0.2 * energy, oct),
      fbm(p + warpAmt * q + vec2(8.3, 2.8) + t * 0.2 * energy, oct)
    );

    float finalWarp = 1.0 + energy * 3.0;
    return fbm(p + finalWarp * r, oct);
  }

  // ── Inigo Quilez cosine palette ───────────────────────────────────────────
  vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318530718 * (c * t + d));
  }

  // Vivid iridescent palette: magentas, cyans, golds
  vec3 vividPalette(float t) {
    return iqPalette(t,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 1.0, 1.0),
      vec3(0.00, 0.33, 0.67)
    );
  }

  // Ash / glitch palette: desaturated grays
  vec3 ashPalette(float t) {
    return iqPalette(t,
      vec3(0.08, 0.08, 0.09),
      vec3(0.05, 0.05, 0.05),
      vec3(1.0,  1.0,  1.0),
      vec3(0.0,  0.0,  0.0)
    );
  }

  // ── Voronoi for neural veins ──────────────────────────────────────────────
  float voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 8.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 point    = hash2(i + neighbor);
        // Animate the Voronoi points gently
        point = 0.5 + 0.5 * sin(u_time * (0.3 + u_energy * 0.7) + 6.2831 * point);
        float d = length(neighbor + point - f);
        minDist = min(minDist, d);
      }
    }
    return minDist;
  }

  // ── Pixel sorting simulation ──────────────────────────────────────────────
  // Sample horizontal neighbors; bias toward brighter ones as energy drops
  vec3 pixelSort(vec2 uv, vec3 baseColor, float energy) {
    if (energy > 0.4) return baseColor; // No sorting in vivid mode

    float sortStrength = 1.0 - energy / 0.4; // 1.0 at energy=0, 0.0 at energy=0.4

    // Band the effect into horizontal strips
    float bandH     = 0.03 + hash(vec2(floor(uv.y * 28.0), floor(u_time * 3.0))) * 0.06;
    float inBand    = step(fract(uv.y / bandH), 0.85);
    if (inBand < 0.5) return baseColor;

    // Aspect-corrected pixel step
    vec2 pixelStep = 1.0 / u_resolution;

    // Sample a few horizontal neighbors
    vec3 c0 = baseColor;
    vec3 c1 = baseColor; // We can only compute the base in a fragment shader
    // Simulate sorting: shift channels by luminance threshold
    float lum    = dot(baseColor, vec3(0.299, 0.587, 0.114));
    float lumOff = dot(baseColor, vec3(0.299, 0.587, 0.114));

    // Displace UVs by a sorted offset scaled to sort strength
    float shiftX = (lum - 0.5) * sortStrength * 0.08;
    vec2 sortedUV = vec2(clamp(uv.x + shiftX, 0.0, 1.0), uv.y);

    // Read the "sorted" position as a warp of the underlying pattern
    // (approximation since GLSL can't reorder pixels)
    float sortedF = warpedFBM(sortedUV * 4.0, u_time * 0.05, 0.0);
    vec3  sortedColor = ashPalette(sortedF);

    return mix(baseColor, sortedColor, sortStrength * 0.7);
  }

  // ── RGB shift / chromatic aberration ─────────────────────────────────────
  vec3 rgbShift(vec2 uv, float energy) {
    float shiftAmt = (1.0 - energy) * 0.015;
    // Add random jitter that changes fast at low energy
    float jitter = hash(vec2(floor(u_time * 20.0), floor(uv.y * 60.0))) * 2.0 - 1.0;
    shiftAmt *= (1.0 + abs(jitter) * 0.5);

    vec2 pixelNorm = 1.0 / u_resolution;
    float shiftPx  = shiftAmt + jitter * pixelNorm.x * 8.0 * (1.0 - energy);

    // Compute reaction-diffusion pattern at shifted UVs for R and B channels
    float fR = warpedFBM((uv + vec2(shiftPx, 0.0)) * 4.0, u_time * 0.05, energy);
    float fG = warpedFBM(uv * 4.0,                         u_time * 0.05, energy);
    float fB = warpedFBM((uv - vec2(shiftPx, 0.0)) * 4.0, u_time * 0.05, energy);

    vec3 colR = ashPalette(fR);
    vec3 colG = ashPalette(fG);
    vec3 colB = ashPalette(fB);

    return vec3(colR.r, colG.g, colB.b);
  }

  // ── CRT grain / static noise ──────────────────────────────────────────────
  float crtGrain(vec2 fragCoord) {
    return fract(sin(dot(fragCoord + u_time, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // ─────────────────────────────────────────────────────────────────────────
  void main() {
    vec2 uv = vUv;

    // ── Compute warp scale: slow at 0, fast at 1 ──────────────────────────
    float timeScale = 0.05 + u_energy * 0.45; // 0.05 → 0.50
    float uvScale   = 3.0 + u_energy * 2.5;   // 3.0 → 5.5

    // ── Core reaction-diffusion-like warpedFBM ────────────────────────────
    float f = warpedFBM(uv * uvScale, u_time * timeScale, u_energy);

    // ── Voronoi neural veins (scales in with energy) ──────────────────────
    float voro      = voronoi(uv * (4.0 + u_energy * 6.0));
    float veinMask  = smoothstep(0.12, 0.0, voro) * u_energy;

    // ── Base color: blend ash ↔ vivid ────────────────────────────────────
    vec3 ashCol   = ashPalette(f);
    vec3 vividCol = vividPalette(f + u_time * 0.02);

    // Extra layer: soap-bubble iridescence (layered palette offset)
    float f2         = warpedFBM(uv * uvScale + vec2(3.7, 8.1), u_time * timeScale * 1.3, u_energy);
    vec3 soapLayer   = iqPalette(f2,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 0.7, 0.4),
      vec3(0.00, 0.15, 0.20)
    );

    // Blend vivid + soap for layered iridescence
    vec3 fullVivid = mix(vividCol, soapLayer, 0.4 + 0.3 * sin(u_time * 0.5 + f * 6.28));

    // Add veins in vivid mode
    vec3 veinColor = vec3(1.0, 0.85, 1.0) * veinMask;
    fullVivid += veinColor * u_energy;

    // ── Glitch state: pixel sort + RGB shift ─────────────────────────────
    // In low-energy mode, the base color is dominated by rgbShift
    vec3 glitchCol = rgbShift(uv, u_energy);
    glitchCol      = pixelSort(uv, glitchCol, u_energy);

    // ── CRT static noise (strong at energy=0, gone at energy=1) ──────────
    float grain     = crtGrain(gl_FragCoord.xy);
    float grainAmt  = (1.0 - u_energy) * (1.0 - u_energy) * 0.35;
    // Scanline darkening at low energy
    float scanline  = 0.85 + 0.15 * sin(gl_FragCoord.y * 3.0);
    float crtEffect = (grain * 2.0 - 1.0) * grainAmt;

    // ── Final blend: glitch (energy=0) ↔ vivid (energy=1) ────────────────
    float t = smoothstep(0.0, 1.0, u_energy);
    vec3 color = mix(glitchCol, fullVivid, t);

    // Apply CRT noise
    color += crtEffect;

    // Scanline only in glitch mode
    color *= mix(scanline, 1.0, t);

    // Clamp
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// ParticleSystem — public API matches the old implementation exactly.
// `count` is accepted but ignored (kept for backward compatibility).
// ─────────────────────────────────────────────────────────────────────────────
export class ParticleSystem {
  constructor(scene, count) {
    this.scene = scene;

    // Uniforms shared with the shader
    this._uniforms = {
      u_time:       { value: 0.0 },
      u_energy:     { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(
        window.innerWidth,
        window.innerHeight
      )},
    };

    // Update resolution on resize
    this._onResize = () => {
      this._uniforms.u_resolution.value.set(
        window.innerWidth,
        window.innerHeight
      );
    };
    window.addEventListener('resize', this._onResize);

    // Fullscreen quad — PlaneGeometry(2,2) in NDC via vertex shader trick
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms:   this._uniforms,
      depthWrite: false,
      depthTest:  false,
      transparent: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = -999;

    scene.add(this.mesh);
  }

  // ── update — called every frame by the host app ──────────────────────────
  // Signature kept identical to the old ParticleSystem for drop-in replacement.
  update(delta, energy, time, angularVelocity) {
    energy = Math.max(0.0, Math.min(1.0, energy || 0.0));

    this._uniforms.u_time.value   = time   || 0.0;
    this._uniforms.u_energy.value = energy;
  }
}
