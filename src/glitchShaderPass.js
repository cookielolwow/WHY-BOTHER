import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/* ══════════════════════════════════════════════════════════════════════════
   GLSL SHADER
   Estado 0 (u_energy ≈ 0): Datamosh, pixel sorting, CRT scanlines, RGB shift
   Estado 1 (u_energy ≈ 1): Todo desaparece, limpio para bloom
   ══════════════════════════════════════════════════════════════════════════ */
const glitchVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const glitchFrag = `
precision highp float;

uniform sampler2D tDiffuse;
uniform float u_energy;
uniform float u_time;
uniform vec2  u_resolution;

varying vec2 vUv;

/* ── Hash / Pseudo-random ── */
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/* ── CRT scanline ── */
float scanline(vec2 uv, float t) {
  float line = sin(uv.y * u_resolution.y * 1.5 + t * 60.0) * 0.5 + 0.5;
  return 1.0 - line * 0.08;
}

/* ── RGB Chromatic Aberration ── */
vec3 rgbShift(sampler2D tex, vec2 uv, float amount) {
  vec2 dir   = normalize(uv - 0.5);
  float r = texture2D(tex, uv + dir * amount).r;
  float g = texture2D(tex, uv).g;
  float b = texture2D(tex, uv - dir * amount).b;
  return vec3(r, g, b);
}

/* ── Glitch block displacement ── */
vec2 blockDisplace(vec2 uv, float t, float intensity) {
  // Divide screen into horizontal strips
  float stripH   = 0.04 + hash(floor(t * 8.0) * 3.7) * 0.12;
  float stripRow = floor(uv.y / stripH);
  float rand     = hash(stripRow + floor(t * 14.0) * 7.13);

  // Only displace some strips
  if (rand > (1.0 - intensity * 0.6)) {
    float shift = (hash(stripRow * 1.3 + t * 0.7) - 0.5) * intensity * 0.25;
    uv.x = fract(uv.x + shift);
  }
  return uv;
}

/* ── Pixel sort (simulate by sampling a shifted column) ── */
vec3 pixelSort(sampler2D tex, vec2 uv, float t, float intensity) {
  float col    = floor(uv.x * u_resolution.x / 4.0);
  float thresh = hash(col + floor(t * 6.0));
  vec3 result  = texture2D(tex, uv).rgb;
  if (thresh > (1.0 - intensity * 0.5)) {
    float yShift = (hash(col * 2.3 + t * 1.1) - 0.3) * intensity * 0.15;
    result = texture2D(tex, vec2(uv.x, fract(uv.y + yShift))).rgb;
  }
  return result;
}

/* ── Grain ── */
float grain(vec2 uv, float t) {
  return (hash2(uv * 312.0 + t * 17.0) - 0.5) * 0.12;
}

/* ── Data-block color glitch ── */
vec3 dataBlock(vec2 uv, float t, float intensity, out bool hit) {
  hit = false;
  vec3 result = texture2D(tDiffuse, uv).rgb;
  float bx = floor(uv.x / 0.085);
  float by = floor(uv.y / 0.11);
  float r  = hash(bx * 7.1 + by * 13.3 + floor(t * 7.0) * 3.7);
  if (r > 1.0 - intensity * 0.45) {
    hit = true;
    result = mix(texture2D(tDiffuse, uv).rgb,
                 vec3(r, hash(r + 1.0), hash(r + 2.0)),
                 intensity * 0.5);
  }
  return result;
}

void main() {
  // Let the datamosh blocks return as energy fades, without overwhelming the scene.
  float glitch = clamp(1.0 - u_energy, 0.0, 1.0);
  glitch = glitch * glitch * 0.65;

  vec2 uv = vUv;

  /* ── Block displacement ── */
  if (glitch > 0.01) {
    uv = blockDisplace(uv, u_time, glitch);
  }

  /* ── RGB Shift (chromatic aberration) ── */
  float rgbAmt = glitch * 0.007;
  vec3 col     = rgbShift(tDiffuse, uv, rgbAmt);

  /* ── Pixel sorting ── */
  if (glitch > 0.05) {
    col = mix(col, pixelSort(tDiffuse, uv, u_time, glitch), glitch * 0.2);
  }

  /* ── TV grain ── */
  col += grain(uv, u_time) * glitch * 0.08;

  /* ── Data-block color glitch ── */
  if (glitch > 0.1) {
    bool dbHit;
    vec3 db = dataBlock(uv, u_time, glitch, dbHit);
    if (dbHit) col = mix(col, db, glitch * 0.45);
  }

  /* ── CRT scanlines (only at low energy) ── */
  col *= mix(1.0, scanline(uv, u_time), glitch * 0.7);

  /* ── CRT vignette ── */
  vec2 vpos  = uv * 2.0 - 1.0;
  float vig  = 1.0 - dot(vpos * vec2(0.5, 0.7), vpos * vec2(0.5, 0.7));
  vig        = pow(max(0.0, vig), 0.4 + (1.0 - glitch) * 0.4);
  col       *= mix(vig, 1.0, u_energy * 0.7);

  /* ── Colour tint: desaturate at low energy ── */
  float lum  = dot(col, vec3(0.299, 0.587, 0.114));
  col        = mix(vec3(lum) * 0.6, col, 0.2 + u_energy * 0.8);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   PASS CLASS
   ══════════════════════════════════════════════════════════════════════════ */
export class GlitchShaderPass extends Pass {
  constructor() {
    super();

    this.uniforms = {
      tDiffuse:     { value: null },
      u_energy:     { value: 0.0 },
      u_time:       { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms:       this.uniforms,
      vertexShader:   glitchVert,
      fragmentShader: glitchFrag,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  setSize(w, h) {
    this.uniforms.u_resolution.value.set(w, h);
  }

  /** Call each frame: update(energy, time) */
  update(energy, time) {
    this.uniforms.u_energy.value = energy;
    this.uniforms.u_time.value   = time;
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
