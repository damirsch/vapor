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
`;

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
`;

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
`;

export const PLANE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLANE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uTex;
uniform float uProgress;
uniform float uEdge;
uniform float uOpacity;
uniform vec2 uDirection;
uniform vec3 uEdgeColor;

varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uTex, vUv);
  float threshold = dot(vUv - 0.5, uDirection) + 0.5;
  float d = smoothstep(threshold, threshold + uEdge, uProgress);
  if (d >= 1.0) discard;

  // Keep the image opaque well into the swept band, then cut. The fluid smoke
  // (drawn on top) is what makes it "dissolve", so we must NOT fade the plane
  // to transparent early — otherwise the dark background shows through before
  // the smoke fills in, reading as a black line ahead of the white edge.
  float body = 1.0 - smoothstep(0.6, 0.95, d);
  // A single bright sweep line, placed a bit into the swept region (lower, in
  // the direction of travel) rather than right at the leading boundary.
  float edge = smoothstep(0.06, 0.13, d) * (1.0 - smoothstep(0.13, 0.28, d));

  vec3 col = tex.rgb + uEdgeColor * edge * 0.6;
  float a = max(tex.a * body, tex.a * edge);
  a *= uOpacity;
  if (a < 0.01) discard;

  gl_FragColor = vec4(col, a);
}
`;
