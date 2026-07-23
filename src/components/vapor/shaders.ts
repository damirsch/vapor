// Classic Ashima simplex noise + curl noise, shared by the particle shader.
const NOISE_CHUNK = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec3 snoiseVec3(vec3 x){
  float s  = snoise(x);
  float s1 = snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2));
  float s2 = snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4));
  return vec3(s, s1, s2);
}

vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 p_x0 = snoiseVec3(p - dx);
  vec3 p_x1 = snoiseVec3(p + dx);
  vec3 p_y0 = snoiseVec3(p - dy);
  vec3 p_y1 = snoiseVec3(p + dy);
  vec3 p_z0 = snoiseVec3(p - dz);
  vec3 p_z1 = snoiseVec3(p + dz);
  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + 1e-5);
}
`

export const PARTICLE_VERTEX = /* glsl */ `
#define TRAIL_MAX 16
uniform float uProgress;
uniform float uTime;
uniform float uStrength;
uniform float uTurbulence;
uniform float uLifetime;
uniform float uSize;
uniform float uPixelRatio;
uniform float uHoverRadius;
uniform float uHoverForce;
uniform vec2 uDirection;
uniform vec2 uDrift;
// Cursor path: xy = position (local space), zw = velocity (units/sec).
uniform vec4 uTrail[TRAIL_MAX];
// Seconds since each sample was recorded (>= uTrailLife means inactive).
uniform float uTrailAge[TRAIL_MAX];
uniform float uTrailLife;

attribute vec3 aColor;
attribute vec2 aCoord;
attribute vec3 aRnd;

varying vec3 vColor;
varying float vAlpha;
varying float vD;

${NOISE_CHUNK}

void main() {
  vColor = aColor;

  // The sweep ignites a particle when uProgress crosses its threshold. Its
  // life then runs over uLifetime — independent of the sweep speed — so the
  // sweep can be fast while particles linger and fully fade out (life -> 1).
  float threshold = dot(aCoord, uDirection) + 0.5;
  float life = clamp((uProgress - threshold) / max(uLifetime, 0.001), 0.0, 1.0);
  vD = life;

  vec3 pos = position;

  // Dissolve into drifting smoke. An evolving curl-noise field gives coherent,
  // swirling wisps that move in many directions; a gentle per-particle drift
  // gives a soft overall bias without everything sliding as one slab.
  vec3 np = pos * uTurbulence + aRnd * 6.0
          + vec3(uTime * 0.18, uTime * 0.12, uTime * 0.22);
  vec3 cn = curlNoise(np);

  // Per-particle drift direction wobble so wisps fan out instead of going
  // strictly one way.
  vec2 driftVar = uDrift + vec2(aRnd.y, aRnd.x) * 0.4;

  float age = life * life;
  vec3 disp = cn * uStrength * (0.8 + aRnd.z * 0.6) * life
            + vec3(driftVar, 0.02) * age * 1.4;
  pos += disp;

  // Cursor wake — dragging the pointer through the smoke shoves particles
  // along the direction of motion (scaled by speed) and gathers them toward
  // the path. Each recorded sample fades as it ages, so the streak lingers
  // briefly then relaxes, leaving a thin, speed-dependent tail. Only reacts
  // once a particle has become smoke.
  float react = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.85, 1.0, life));
  if (react > 0.0) {
    vec2 wake = vec2(0.0);
    float wakeZ = 0.0;
    for (int i = 0; i < TRAIL_MAX; i++) {
      float a = uTrailAge[i];
      if (a >= uTrailLife) continue;
      vec4 t = uTrail[i];
      vec2 rel = pos.xy - t.xy;
      float fall = smoothstep(uHoverRadius, 0.0, length(rel));
      if (fall <= 0.0) continue;
      float ageFade = 1.0 - a / uTrailLife;
      ageFade *= ageFade;
      float speed = length(t.zw);
      vec2 dir = t.zw / max(speed, 0.0001);
      float w = fall * ageFade;
      wake += dir * w * min(speed, 3.0) * uHoverForce;   // drag along motion
      wake -= rel * w * 0.35 * uHoverForce;              // gather onto the path
      wakeZ += w * min(speed, 3.0) * 0.04;
    }
    pos.xy += wake * react;
    pos.z += wakeZ * react;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Puffs expand as they age and vary in size, so overlapping soft sprites
  // blend into a continuous, blurry haze instead of reading as dots.
  float sizeVar = 0.75 + aRnd.z * 0.6;
  gl_PointSize = uSize * uPixelRatio * sizeVar * (1.0 + life * 1.4) * (3.0 / -mv.z);

  // Fade in on ignition, fully gone by the end of life.
  vAlpha = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.7, 1.0, life));
}
`

export const PARTICLE_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uOpacity;

varying vec3 vColor;
varying float vAlpha;
varying float vD;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  // Smooth gaussian puff with a feathered edge — reads as a blurry wisp, so
  // overlapping sprites melt together into continuous smoke instead of dots.
  float mask = exp(-r * r * 6.0) * smoothstep(0.5, 0.3, r);
  if (mask < 0.004) discard;

  vec3 col = vColor + vD * 0.06;
  gl_FragColor = vec4(col, mask * vAlpha * 0.55 * uOpacity);
}
`

export const PLANE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Cigarette burn: the paper is consumed by a union of expanding ignition
 * "seeds". For each fragment we find how far it lies *inside* the nearest
 * seed's front (`depth`); a domain-warped noise makes that front ragged. The
 * depth then drives the look: a hot ember rim right at the front → charring →
 * a burned-through hole. Intact paper (depth < 0) shows the image untouched.
 */
export const BURN_FRAGMENT = /* glsl */ `
precision highp float;

#define MAX_SEEDS 64

uniform sampler2D uTex;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uSeeds[MAX_SEEDS];   // xy = center (image uv), z = birth time (s)
uniform int uSeedCount;
uniform float uAspect;            // width / height, keeps the front circular
uniform float uSpread;            // front radius growth (uv height units / s)
uniform float uRagged;            // noise displacement of the front
uniform float uNoiseScale;
uniform float uEmberW;            // ember glow band width
uniform float uEmberPeak;         // depth (behind the black front) of the glow
uniform float uEmberLag;          // extra noise depth so the ember lags at times
uniform float uCharW;             // depth over which paper darkens (scorch)
uniform float uHoleW;             // depth at which it burns through
uniform float uEmberIntensity;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec4 tex = texture2D(uTex, vUv);

  // Domain-warped noise → an organic, ragged burn edge.
  vec2 w = vec2(fbm(vUv * uNoiseScale), fbm(vUv * uNoiseScale + 5.2));
  float n = fbm(vUv * uNoiseScale + w * 1.5);

  // How far inside the nearest seed's advancing front this fragment sits.
  float depth = -1.0;
  for (int i = 0; i < MAX_SEEDS; i++) {
    if (i >= uSeedCount) break;
    vec3 s = uSeeds[i];
    float age = uTime - s.z;
    if (age <= 0.0) continue;
    float radius = uSpread * age;
    vec2 dpt = vUv - s.xy;
    dpt.x *= uAspect;
    depth = max(depth, radius - length(dpt));
  }
  depth += (n - 0.5) * uRagged;

  // Intact paper — a dark scorch grows into the paper ahead of the front,
  // reaching LEAD_MAX (0.8) right at the edge (depth = 0).
  if (depth < 0.0) {
    float a = tex.a * uOpacity;
    if (a < 0.01) discard;
    float lead = smoothstep(-uCharW * 0.7, 0.0, depth);
    vec3 rgb = mix(tex.rgb, vec3(0.02), lead * 0.8);
    gl_FragColor = vec4(rgb, a);
    return;
  }

  // Burned through.
  float hole = smoothstep(uHoleW * 0.85, uHoleW, depth);
  if (hole >= 0.999) discard;

  // Continue darkening from the leading scorch's 0.8 (at depth = 0) up to fully
  // black — starting at 0.8, not 0, so there's no bright image ring at the seam.
  float darken = mix(0.8, 1.0, smoothstep(0.0, uCharW, depth));
  vec3 charred = mix(tex.rgb, vec3(0.02), darken);

  // Crisp red→yellow ember, sitting BEHIND the black front at uEmberPeak. A slow
  // low-frequency noise pushes it deeper here and there so it periodically lags
  // further behind the char instead of tracking the edge at a constant offset.
  float pn = fbm(vUv * uNoiseScale * 1.4 + vec2(uTime * 0.3, uTime * -0.2));
  float peak = uEmberPeak + pn * uEmberLag;
  float dd = depth - peak;
  float ember = exp(-dd * dd / (uEmberW * uEmberW));
  float flick = 0.85 + 0.15 * vnoise(vUv * 36.0 + uTime * 7.0);
  ember *= flick;

  // Red at the cooler fringe → a warm orange-yellow only at the hottest core.
  // Biased toward red: less yellow overall, yellow reserved for peak intensity.
  vec3 emberCol = mix(vec3(1.0, 0.10, 0.0), vec3(1.0, 0.62, 0.12),
                      smoothstep(0.3, 0.92, ember));
  vec3 col = charred + emberCol * ember * uEmberIntensity;

  float a = tex.a * uOpacity * (1.0 - hole);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`

export const PLANE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uTex;
uniform float uProgress;
uniform float uEdge;
uniform float uOpacity;
uniform vec2 uDirection;

varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uTex, vUv);
  float threshold = dot(vUv - 0.5, uDirection) + 0.5;
  float d = smoothstep(threshold, threshold + uEdge, uProgress);
  if (d >= 1.0) discard;

  // Keep the image opaque well into the swept band, then cut. The fluid smoke
  // (drawn on top) is what makes it "dissolve", so we must NOT fade the plane
  // to transparent early — otherwise the dark background shows through before
  // the smoke fills in. The bright sweep line is no longer baked in here; it is
  // drawn as a separate crisp "scanner" quad (see ScannerLine in ParticleImage).
  float body = 1.0 - smoothstep(0.6, 0.95, d);
  float a = tex.a * body * uOpacity;
  if (a < 0.01) discard;

  gl_FragColor = vec4(tex.rgb, a);
}
`
