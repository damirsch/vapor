/**
 * Ported from Pavel Dobryakov's WebGL Fluid Simulation (MIT), trimmed to the
 * core Navier–Stokes passes and extended with two emission passes that inject
 * an image's pixels as dye (plus buoyancy) along a moving sweep band — so a
 * dissolving image "becomes" flowing fluid smoke in its own colors.
 *
 * Runs on its own WebGL2 context / canvas so it never fights three.js over GL
 * state. The canvas is transparent and meant to be overlaid on the 3D scene.
 */

interface FBO {
	texture: WebGLTexture
	fbo: WebGLFramebuffer
	width: number
	height: number
	texelX: number
	texelY: number
	attach: (id: number) => number
}

interface DoubleFBO {
	width: number
	height: number
	texelX: number
	texelY: number
	read: FBO
	write: FBO
	swap: () => void
}

export interface ImageTex {
	texture: WebGLTexture
	attach: (id: number) => number
}

export interface FluidConfig {
	SIM_RESOLUTION: number
	DYE_RESOLUTION: number
	DENSITY_DISSIPATION: number
	VELOCITY_DISSIPATION: number
	PRESSURE_DISSIPATION: number
	PRESSURE_ITERATIONS: number
	CURL: number
	SPLAT_RADIUS: number
	/** Normal-based diffuse lighting on the dye (the reference's volumetric look). */
	SHADING: boolean
	/** Master switch for the bloom glow pass. */
	BLOOM: boolean
	BLOOM_ITERATIONS: number
	BLOOM_RESOLUTION: number
	/** Brightness of the internal bloom accumulation. */
	BLOOM_INTENSITY: number
	/** Amount of bloom added back over the smoke on display (glow strength). */
	BLOOM_GLOW: number
	/** Only dye brighter than this glows. */
	BLOOM_THRESHOLD: number
	BLOOM_SOFT_KNEE: number
}

export const DEFAULT_FLUID_CONFIG: FluidConfig = {
	SIM_RESOLUTION: 128,
	// Higher dye resolution → crisper, higher-quality smoke that holds the
	// image's detail/colour instead of smearing into a low-res blur.
	DYE_RESOLUTION: 1024,
	// Dye fades fairly quickly so the smoke stays wispy, but a touch slower than
	// the reference so mid-tones (e.g. a plain grey) linger long enough to read
	// as smoke of the same colour before dissolving.
	DENSITY_DISSIPATION: 0.975,
	// Matches the reference: smooth coasting swirls, no over-persistent velocity.
	VELOCITY_DISSIPATION: 0.98,
	PRESSURE_DISSIPATION: 0.8,
	PRESSURE_ITERATIONS: 20,
	// Reference uses 0: swirls come from the incompressible flow itself, not from
	// vorticity confinement (which looks busy/mushy).
	CURL: 0,
	// Slightly tighter than the reference's 0.5 so the cursor swirls read smaller.
	SPLAT_RADIUS: 0.3,
	// Normal-based diffuse shading — THE defining look of the reference smoke.
	SHADING: true,
	// Reference has a constant bloom glow on the coloured fluid.
	BLOOM: true,
	BLOOM_ITERATIONS: 8,
	BLOOM_RESOLUTION: 256,
	BLOOM_INTENSITY: 0.8,
	// Constant glow (not speed-driven) to match the reference — no flicker.
	BLOOM_GLOW: 1,
	BLOOM_THRESHOLD: 0.6,
	BLOOM_SOFT_KNEE: 0.7,
}

const baseVertex = `
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;
  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const clearShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
`

const displayShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  void main () {
    vec3 C = texture2D(uTexture, vUv).rgb;
    float a = max(C.r, max(C.g, C.b));
    gl_FragColor = vec4(C, a);
  }
`

const splatShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`

// Radial outward velocity around the cursor — blows nearby smoke away so a void
// forms under the pointer, independent of how fast the cursor is moving.
const punchVelShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec2 point;
  uniform float radius;
  uniform float strength;
  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    float d2 = dot(p, p);
    float f = exp(-d2 / radius);
    vec2 dir = p / (sqrt(d2) + 0.0001);
    vec2 base = texture2D(uTarget, vUv).xy;
    gl_FragColor = vec4(base + dir * strength * f, 0.0, 1.0);
  }
`

// Carve the dye directly under the cursor so the centre is always clear (the
// incompressible solver would otherwise refill any hole made by velocity alone).
const punchDyeShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec2 point;
  uniform float radius;
  uniform float amount;
  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    float f = exp(-dot(p, p) / radius);
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base * (1.0 - clamp(f * amount, 0.0, 1.0)), 1.0);
  }
`

// Inject image pixels as dye inside the band the sweep is currently crossing.
const emitDyeShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform sampler2D uImage;
  uniform vec4 uRect;       // x0,y0,x1,y1 in screen uv (y up)
  uniform vec2 uDir;
  uniform float uProgress;
  uniform float uEdge;
  uniform float uAmount;
  uniform float uBrightness; // scales the image dye so its bloom/glow can be dialed down
  void main () {
    vec3 base = texture2D(uTarget, vUv).rgb;
    vec2 t = (vUv - uRect.xy) / max(uRect.zw - uRect.xy, vec2(0.0001));
    vec3 add = vec3(0.0);
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      vec4 tex = texture2D(uImage, vec2(t.x, 1.0 - t.y));
      float threshold = dot(t - vec2(0.5), uDir) + 0.5;
      float d = uProgress - threshold;
      float band = smoothstep(0.0, uEdge, d) * (1.0 - smoothstep(uEdge, uEdge * 2.5, d));
      // Approach the image color rather than adding: dye saturates at the true
      // color (never blows out to white) and reaches full brightness no matter
      // how fast or slow the sweep passes over a given pixel.
      vec3 target = tex.rgb * tex.a * uBrightness;
      add = max(target - base, 0.0) * band * uAmount;
    }
    gl_FragColor = vec4(base + add, 1.0);
  }
`

// Add buoyant (upward) velocity inside the same band so the dye rises.
const emitVelocityShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform sampler2D uImage;
  uniform vec4 uRect;
  uniform vec2 uDir;
  uniform float uProgress;
  uniform float uEdge;
  uniform float uRise;
  uniform float uJitter;
  void main () {
    vec2 base = texture2D(uTarget, vUv).xy;
    vec2 t = (vUv - uRect.xy) / max(uRect.zw - uRect.xy, vec2(0.0001));
    vec2 add = vec2(0.0);
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      vec4 tex = texture2D(uImage, vec2(t.x, 1.0 - t.y));
      float threshold = dot(t - vec2(0.5), uDir) + 0.5;
      float d = uProgress - threshold;
      float band = smoothstep(0.0, uEdge, d) * (1.0 - smoothstep(uEdge, uEdge * 2.5, d));
      float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      add = vec2(n * uJitter, uRise) * band * tex.a;
    }
    gl_FragColor = vec4(base + add, 0.0, 1.0);
  }
`

// Shared value-noise fbm for the cigarette burn front (matches the paper
// shader's raggedness so smoke rises from the same organic edge).
const burnNoiseChunk = `
  float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = bHash(i);
    float b = bHash(i + vec2(1.0, 0.0));
    float c = bHash(i + vec2(0.0, 1.0));
    float d = bHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float bFbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * bNoise(p); p *= 2.0; a *= 0.5; }
    return s;
  }
  // Signed depth inside the nearest seed's advancing burn front (ragged).
  float burnDepth(vec2 t) {
    vec2 w = vec2(bFbm(t * uNoiseScale), bFbm(t * uNoiseScale + 5.2));
    float n = bFbm(t * uNoiseScale + w * 1.5);
    float depth = -1.0;
    for (int i = 0; i < 64; i++) {
      if (i >= uSeedCount) break;
      vec3 s = uSeeds[i];
      float age = uTime - s.z;
      if (age <= 0.0) continue;
      float radius = uSpread * age;
      vec2 dpt = t - s.xy;
      dpt.x *= uAspect;
      depth = max(depth, radius - length(dpt));
    }
    return depth + (n - 0.5) * uRagged;
  }
`

// Inject faint grey dye along the active combustion band of the burn front.
const emitBurnDyeShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform vec4 uRect;        // image rect in screen uv (y up)
  uniform vec3 uSeeds[64];
  uniform int uSeedCount;
  uniform float uTime;
  uniform float uAspect;
  uniform float uSpread;
  uniform float uFront;      // width of the smoke-emitting band
  uniform float uRagged;
  uniform float uNoiseScale;
  uniform vec3 uColor;
  uniform float uAmount;
  ${burnNoiseChunk}
  void main () {
    vec3 base = texture2D(uTarget, vUv).rgb;
    vec2 t = (vUv - uRect.xy) / max(uRect.zw - uRect.xy, vec2(0.0001));
    vec3 add = vec3(0.0);
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      float depth = burnDepth(t);
      float band = smoothstep(0.0, uFront * 0.5, depth) *
                   (1.0 - smoothstep(uFront * 0.5, uFront, depth));
      add = uColor * band * uAmount;
    }
    gl_FragColor = vec4(base + add, 1.0);
  }
`

// Push upward buoyancy (+ jitter) along the same band so the smoke rises.
const emitBurnVelShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform vec4 uRect;
  uniform vec3 uSeeds[64];
  uniform int uSeedCount;
  uniform float uTime;
  uniform float uAspect;
  uniform float uSpread;
  uniform float uFront;
  uniform float uRagged;
  uniform float uNoiseScale;
  uniform float uRise;
  uniform float uJitter;
  ${burnNoiseChunk}
  void main () {
    vec2 base = texture2D(uTarget, vUv).xy;
    vec2 t = (vUv - uRect.xy) / max(uRect.zw - uRect.xy, vec2(0.0001));
    vec2 add = vec2(0.0);
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      float depth = burnDepth(t);
      float band = smoothstep(0.0, uFront * 0.5, depth) *
                   (1.0 - smoothstep(uFront * 0.5, uFront, depth));
      float j = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      add = vec2(j * uJitter, uRise) * band;
    }
    gl_FragColor = vec4(base + add, 0.0, 1.0);
  }
`

// Continuously push the velocity field with a constant wind plus an evolving
// curl-noise field. This is what makes the smoke feel alive instead of static:
// even after the sweep is gone, the dye keeps drifting and swirling with "wind".
const forceShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uWind;      // constant wind (velocity units)
  uniform float uTurb;     // curl-noise amplitude
  uniform float uScale;    // spatial frequency of the noise
  uniform float uTime;     // animates the field over time
  uniform float uAspect;   // keep the noise isotropic
  uniform float uDt;

  vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
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
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  // Divergence-free 2D flow from the curl of an animated noise potential.
  vec2 curlNoise(vec2 p, float t) {
    float e = 0.1;
    float n1 = snoise(vec3(p.x, p.y + e, t));
    float n2 = snoise(vec3(p.x, p.y - e, t));
    float n3 = snoise(vec3(p.x + e, p.y, t));
    float n4 = snoise(vec3(p.x - e, p.y, t));
    float dx = (n1 - n2) / (2.0 * e);
    float dy = (n3 - n4) / (2.0 * e);
    return vec2(dy, -dx);
  }

  void main () {
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vec2 p = vec2(vUv.x * uAspect, vUv.y) * uScale;
    vec2 turbF = curlNoise(p, uTime) * uTurb;
    vec2 force = uWind + turbF;
    gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
  }
`

const advectionShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  void main () {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    gl_FragColor = dissipation * texture2D(uSource, coord);
    gl_FragColor.a = 1.0;
  }
`

const divergenceShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`

const curlShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`

const vorticityShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
  }
`

const pressureShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`

const gradientSubtractShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

// --- Bloom (glow) pipeline, ported from Pavel Dobryakov's fluid sim ---

// Keep only the bright parts of the dye (soft-knee threshold) to bloom.
const bloomPrefilterShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec3 curve;
  uniform float threshold;
  void main () {
    vec3 c = texture2D(uTexture, vUv).rgb;
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - curve.x, 0.0, curve.y);
    rq = curve.z * rq * rq;
    c *= max(rq, br - threshold) / max(br, 0.0001);
    gl_FragColor = vec4(c, 0.0);
  }
`

// 4-tap box blur used for both the down- and up-sample passes.
const bloomBlurShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uTexture;
  void main () {
    vec4 sum = vec4(0.0);
    sum += texture2D(uTexture, vL);
    sum += texture2D(uTexture, vR);
    sum += texture2D(uTexture, vT);
    sum += texture2D(uTexture, vB);
    sum *= 0.25;
    gl_FragColor = sum;
  }
`

const bloomFinalShader = `
  precision mediump float;
  precision mediump sampler2D;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uTexture;
  uniform float intensity;
  void main () {
    vec4 sum = vec4(0.0);
    sum += texture2D(uTexture, vL);
    sum += texture2D(uTexture, vR);
    sum += texture2D(uTexture, vT);
    sum += texture2D(uTexture, vB);
    sum *= 0.25;
    gl_FragColor = sum * intensity;
  }
`

// Composite the dye with its bloom for a glowing look.
const displayBloomShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform sampler2D uBloom;
  uniform float intensity;
  void main () {
    vec3 C = texture2D(uTexture, vUv).rgb;
    vec3 bloom = texture2D(uBloom, vUv).rgb;
    bloom = pow(bloom, vec3(1.0 / 2.2));
    C += bloom * intensity;
    float a = max(C.r, max(C.g, C.b));
    gl_FragColor = vec4(C, a);
  }
`

// Reference "shading" display: derive a surface normal from the dye's local
// gradient and light it with a simple headlight. This is what gives the smoke
// its soft, embossed, volumetric look (SHADING: true in the reference).
const displayShadingShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uTexture;
  uniform vec2 texelSize;
  void main () {
    vec3 L = texture2D(uTexture, vL).rgb;
    vec3 R = texture2D(uTexture, vR).rgb;
    vec3 T = texture2D(uTexture, vT).rgb;
    vec3 B = texture2D(uTexture, vB).rgb;
    vec3 C = texture2D(uTexture, vUv).rgb;
    float dx = length(R) - length(L);
    float dy = length(T) - length(B);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    vec3 l = vec3(0.0, 0.0, 1.0);
    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    C *= diffuse;
    float a = max(C.r, max(C.g, C.b));
    gl_FragColor = vec4(C, a);
  }
`

// Shading + bloom combined (reference's displayBloomShading, minus the optional
// dithering term which only reduces banding).
const displayBloomShadingShader = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uTexture;
  uniform sampler2D uBloom;
  uniform float intensity;
  uniform vec2 texelSize;
  void main () {
    vec3 L = texture2D(uTexture, vL).rgb;
    vec3 R = texture2D(uTexture, vR).rgb;
    vec3 T = texture2D(uTexture, vT).rgb;
    vec3 B = texture2D(uTexture, vB).rgb;
    vec3 C = texture2D(uTexture, vUv).rgb;
    float dx = length(R) - length(L);
    float dy = length(T) - length(B);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    vec3 l = vec3(0.0, 0.0, 1.0);
    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    C *= diffuse;
    vec3 bloom = texture2D(uBloom, vUv).rgb;
    bloom = pow(bloom, vec3(1.0 / 2.2));
    C += bloom * intensity;
    float a = max(C.r, max(C.g, C.b));
    gl_FragColor = vec4(C, a);
  }
`

class Program {
	program: WebGLProgram
	uniforms: Record<string, WebGLUniformLocation | null> = {}
	private gl: WebGL2RenderingContext

	constructor(gl: WebGL2RenderingContext, vs: WebGLShader, fsSource: string) {
		this.gl = gl
		const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource)
		const program = gl.createProgram()!
		gl.attachShader(program, vs)
		gl.attachShader(program, fs)
		// The shared fullscreen quad binds its vertices to attribute location 0.
		gl.bindAttribLocation(program, 0, "aPosition")
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS))
			throw new Error(gl.getProgramInfoLog(program) || "link failed")
		this.program = program
		const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
		for (let i = 0; i < count; i++) {
			const name = gl.getActiveUniform(program, i)!.name
			this.uniforms[name] = gl.getUniformLocation(program, name)
		}
	}

	bind() {
		this.gl.useProgram(this.program)
	}
}

/**
 * Upgrade a GLSL ES 1.00 shader to 3.00. WebGL2 on some platforms (notably
 * macOS/ANGLE-Metal) refuses to compile version-less ES 1.00 shaders, so we
 * translate the handful of tokens that differ instead of maintaining two sets.
 */
function toGLSL3(source: string, isVertex: boolean): string {
	let s = source.trim()
	if (isVertex) {
		s = s.replace(/\battribute\b/g, "in").replace(/\bvarying\b/g, "out")
	} else {
		s = s.replace(/\bvarying\b/g, "in")
		// Declare the fragment output after the precision statements.
		s = s.replace(/\bvoid\s+main\b/, "out vec4 pc_fragColor;\nvoid main")
		s = s.replace(/\bgl_FragColor\b/g, "pc_fragColor")
	}
	s = s.replace(/\btexture2D\b/g, "texture")
	return `#version 300 es\n${s}\n`
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)!
	gl.shaderSource(shader, toGLSL3(source, type === gl.VERTEX_SHADER))
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
		throw new Error(gl.getShaderInfoLog(shader) || "compile failed")
	return shader
}

export class FluidSim {
	private canvas: HTMLCanvasElement
	private gl: WebGL2RenderingContext
	private config: FluidConfig
	private linearFilter: boolean

	private programs!: {
		clear: Program
		display: Program
		splat: Program
		punchVel: Program
		punchDye: Program
		emitDye: Program
		emitVel: Program
		emitBurnDye: Program
		emitBurnVel: Program
		force: Program
		advection: Program
		divergence: Program
		curl: Program
		vorticity: Program
		pressure: Program
		gradient: Program
		bloomPrefilter: Program
		bloomBlur: Program
		bloomFinal: Program
		displayBloom: Program
		displayShading: Program
		displayBloomShading: Program
	}

	private density!: DoubleFBO
	private velocity!: DoubleFBO
	private divergence!: FBO
	private curl!: FBO
	private pressure!: DoubleFBO
	private bloom!: FBO
	private bloomFramebuffers: FBO[] = []

	private simW = 0
	private simH = 0
	private dyeW = 0
	private dyeH = 0

	constructor(canvas: HTMLCanvasElement, config = DEFAULT_FLUID_CONFIG) {
		this.canvas = canvas
		this.config = { ...config }
		const gl = canvas.getContext("webgl2", {
			alpha: true,
			depth: false,
			stencil: false,
			antialias: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
		})
		if (!gl) throw new Error("WebGL2 not supported")
		this.gl = gl
		gl.getExtension("EXT_color_buffer_float")
		this.linearFilter = !!gl.getExtension("OES_texture_float_linear")
		gl.clearColor(0, 0, 0, 0)

		// If anything below fails, release the context we just created so a failed
		// init can never leak a WebGL context (browsers cap live contexts at ~16).
		try {
			this.setupQuad()
			const vs = compile(gl, gl.VERTEX_SHADER, baseVertex)
			this.programs = {
				clear: new Program(gl, vs, clearShader),
				display: new Program(gl, vs, displayShader),
				splat: new Program(gl, vs, splatShader),
				punchVel: new Program(gl, vs, punchVelShader),
				punchDye: new Program(gl, vs, punchDyeShader),
				emitDye: new Program(gl, vs, emitDyeShader),
				emitVel: new Program(gl, vs, emitVelocityShader),
				emitBurnDye: new Program(gl, vs, emitBurnDyeShader),
				emitBurnVel: new Program(gl, vs, emitBurnVelShader),
				force: new Program(gl, vs, forceShader),
				advection: new Program(gl, vs, advectionShader),
				divergence: new Program(gl, vs, divergenceShader),
				curl: new Program(gl, vs, curlShader),
				vorticity: new Program(gl, vs, vorticityShader),
				pressure: new Program(gl, vs, pressureShader),
				gradient: new Program(gl, vs, gradientSubtractShader),
				bloomPrefilter: new Program(gl, vs, bloomPrefilterShader),
				bloomBlur: new Program(gl, vs, bloomBlurShader),
				bloomFinal: new Program(gl, vs, bloomFinalShader),
				displayBloom: new Program(gl, vs, displayBloomShader),
				displayShading: new Program(gl, vs, displayShadingShader),
				displayBloomShading: new Program(gl, vs, displayBloomShadingShader),
			}
			this.initFramebuffers()
		} catch (e) {
			gl.getExtension("WEBGL_lose_context")?.loseContext()
			throw e
		}
	}

	private setupQuad() {
		const gl = this.gl
		const buffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
		const elem = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		gl.enableVertexAttribArray(0)
	}

	private blit(target: FBO | null) {
		const gl = this.gl
		if (target) {
			gl.viewport(0, 0, target.width, target.height)
			gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
		} else {
			gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
			gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		}
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
	}

	private getResolution(resolution: number) {
		const gl = this.gl
		let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight
		if (aspect < 1) aspect = 1 / aspect
		const max = Math.round(resolution * aspect)
		const min = Math.round(resolution)
		return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max }
	}

	private createFBO(w: number, h: number, param: number): FBO {
		const gl = this.gl
		gl.activeTexture(gl.TEXTURE0)
		const texture = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)

		const fbo = gl.createFramebuffer()!
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
		gl.viewport(0, 0, w, h)
		gl.clear(gl.COLOR_BUFFER_BIT)

		return {
			texture,
			fbo,
			width: w,
			height: h,
			texelX: 1 / w,
			texelY: 1 / h,
			attach(id: number) {
				gl.activeTexture(gl.TEXTURE0 + id)
				gl.bindTexture(gl.TEXTURE_2D, texture)
				return id
			},
		}
	}

	private createDoubleFBO(w: number, h: number, param: number): DoubleFBO {
		let fbo1 = this.createFBO(w, h, param)
		let fbo2 = this.createFBO(w, h, param)
		return {
			width: w,
			height: h,
			texelX: 1 / w,
			texelY: 1 / h,
			get read() {
				return fbo1
			},
			set read(v: FBO) {
				fbo1 = v
			},
			get write() {
				return fbo2
			},
			set write(v: FBO) {
				fbo2 = v
			},
			swap() {
				const t = fbo1
				fbo1 = fbo2
				fbo2 = t
			},
		}
	}

	private initFramebuffers() {
		const simRes = this.getResolution(this.config.SIM_RESOLUTION)
		const dyeRes = this.getResolution(this.config.DYE_RESOLUTION)
		this.simW = simRes.width
		this.simH = simRes.height
		this.dyeW = dyeRes.width
		this.dyeH = dyeRes.height
		const filtering = this.linearFilter ? this.gl.LINEAR : this.gl.NEAREST

		this.density = this.createDoubleFBO(this.dyeW, this.dyeH, filtering)
		this.velocity = this.createDoubleFBO(this.simW, this.simH, filtering)
		this.divergence = this.createFBO(this.simW, this.simH, this.gl.NEAREST)
		this.curl = this.createFBO(this.simW, this.simH, this.gl.NEAREST)
		this.pressure = this.createDoubleFBO(this.simW, this.simH, this.gl.NEAREST)
		this.initBloomFramebuffers()
	}

	private initBloomFramebuffers() {
		const gl = this.gl
		// Free any framebuffers from a previous size before reallocating.
		if (this.bloom) {
			gl.deleteTexture(this.bloom.texture)
			gl.deleteFramebuffer(this.bloom.fbo)
		}
		for (const f of this.bloomFramebuffers) {
			gl.deleteTexture(f.texture)
			gl.deleteFramebuffer(f.fbo)
		}
		this.bloomFramebuffers = []

		const res = this.getResolution(this.config.BLOOM_RESOLUTION)
		const filtering = this.linearFilter ? gl.LINEAR : gl.NEAREST
		this.bloom = this.createFBO(res.width, res.height, filtering)
		for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
			const w = res.width >> (i + 1)
			const h = res.height >> (i + 1)
			if (w < 2 || h < 2) break
			this.bloomFramebuffers.push(this.createFBO(w, h, filtering))
		}
	}

	/**
	 * Extract the bright dye, blur it down and back up, and accumulate it into
	 * `destination`. This is what produces the soft glow around the smoke.
	 */
	private applyBloom(source: FBO, destination: FBO) {
		if (this.bloomFramebuffers.length < 2) return
		const gl = this.gl
		let last = destination

		gl.disable(gl.BLEND)

		const pre = this.programs.bloomPrefilter
		pre.bind()
		const knee = this.config.BLOOM_THRESHOLD * this.config.BLOOM_SOFT_KNEE + 0.0001
		gl.uniform3f(pre.uniforms.curve, this.config.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee)
		gl.uniform1f(pre.uniforms.threshold, this.config.BLOOM_THRESHOLD)
		gl.uniform1i(pre.uniforms.uTexture, source.attach(0))
		this.blit(last)

		const blur = this.programs.bloomBlur
		blur.bind()
		for (let i = 0; i < this.bloomFramebuffers.length; i++) {
			const dest = this.bloomFramebuffers[i]
			gl.uniform2f(blur.uniforms.texelSize, last.texelX, last.texelY)
			gl.uniform1i(blur.uniforms.uTexture, last.attach(0))
			this.blit(dest)
			last = dest
		}

		gl.blendFunc(gl.ONE, gl.ONE)
		gl.enable(gl.BLEND)
		for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
			const baseTex = this.bloomFramebuffers[i]
			gl.uniform2f(blur.uniforms.texelSize, last.texelX, last.texelY)
			gl.uniform1i(blur.uniforms.uTexture, last.attach(0))
			this.blit(baseTex)
			last = baseTex
		}
		gl.disable(gl.BLEND)

		const fin = this.programs.bloomFinal
		fin.bind()
		gl.uniform2f(fin.uniforms.texelSize, last.texelX, last.texelY)
		gl.uniform1i(fin.uniforms.uTexture, last.attach(0))
		gl.uniform1f(fin.uniforms.intensity, this.config.BLOOM_INTENSITY)
		this.blit(destination)
	}

	/** Resize the drawing buffer + reallocate framebuffers to match. */
	resize(cssWidth: number, cssHeight: number, dpr: number) {
		const w = Math.max(1, Math.floor(cssWidth * dpr))
		const h = Math.max(1, Math.floor(cssHeight * dpr))
		if (this.canvas.width === w && this.canvas.height === h) return
		this.canvas.width = w
		this.canvas.height = h
		this.initFramebuffers()
	}

	/** Load an HTMLImageElement into this context as a sampleable texture. */
	createImageTexture(image: HTMLImageElement): ImageTex {
		const gl = this.gl
		const texture = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
		return {
			texture,
			attach(id: number) {
				gl.activeTexture(gl.TEXTURE0 + id)
				gl.bindTexture(gl.TEXTURE_2D, texture)
				return id
			},
		}
	}

	disposeImageTexture(tex: ImageTex) {
		this.gl.deleteTexture(tex.texture)
	}

	/** Clear all dye + velocity (called when switching images). */
	reset() {
		const gl = this.gl
		for (const d of [this.density, this.velocity, this.pressure]) {
			for (const f of [d.read, d.write]) {
				gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo)
				gl.clear(gl.COLOR_BUFFER_BIT)
			}
		}
	}

	/** Splat velocity (+optional dye color) at screen pixel coords. */
	splat(
		x: number,
		y: number,
		dx: number,
		dy: number,
		color?: [number, number, number],
		radiusMul = 1
	) {
		const gl = this.gl
		const p = this.programs.splat
		p.bind()
		const aspect = this.canvas.width / this.canvas.height
		gl.uniform1f(p.uniforms.aspectRatio, aspect)
		gl.uniform2f(p.uniforms.point, x / this.canvas.width, 1 - y / this.canvas.height)
		gl.uniform1f(p.uniforms.radius, (this.config.SPLAT_RADIUS * radiusMul) / 100)

		gl.uniform1i(p.uniforms.uTarget, this.velocity.read.attach(0))
		gl.uniform3f(p.uniforms.color, dx, -dy, 0)
		this.blit(this.velocity.write)
		this.velocity.swap()

		if (color) {
			gl.uniform1i(p.uniforms.uTarget, this.density.read.attach(0))
			gl.uniform3f(p.uniforms.color, color[0], color[1], color[2])
			this.blit(this.density.write)
			this.density.swap()
		}
	}

	/**
	 * Keep a clear void under the cursor: pushes surrounding smoke radially
	 * outward (velocity) and carves the dye at the centre (density). Applied
	 * every frame while the pointer is over the canvas, so it works even when
	 * the cursor is still or moving very slowly.
	 */
	punch(x: number, y: number, radius: number, strength: number, clear: number) {
		const gl = this.gl
		const aspect = this.canvas.width / this.canvas.height
		const px = x / this.canvas.width
		const py = 1 - y / this.canvas.height
		const r = radius / 100

		const v = this.programs.punchVel
		v.bind()
		gl.uniform1f(v.uniforms.aspectRatio, aspect)
		gl.uniform2f(v.uniforms.point, px, py)
		gl.uniform1f(v.uniforms.radius, r)
		gl.uniform1f(v.uniforms.strength, strength)
		gl.uniform1i(v.uniforms.uTarget, this.velocity.read.attach(0))
		this.blit(this.velocity.write)
		this.velocity.swap()

		const d = this.programs.punchDye
		d.bind()
		gl.uniform1f(d.uniforms.aspectRatio, aspect)
		gl.uniform2f(d.uniforms.point, px, py)
		gl.uniform1f(d.uniforms.radius, r)
		gl.uniform1f(d.uniforms.amount, clear)
		gl.uniform1i(d.uniforms.uTarget, this.density.read.attach(0))
		this.blit(this.density.write)
		this.density.swap()
	}

	/**
	 * Emit dye + buoyancy from an image along the sweep band.
	 * `rect` is the image's on-screen rectangle in uv (y up): [x0, y0, x1, y1].
	 */
	emit(
		image: ImageTex,
		rect: [number, number, number, number],
		dir: [number, number],
		progress: number,
		edge: number,
		amount: number,
		rise: number,
		jitter: number,
		brightness = 1
	) {
		const gl = this.gl

		const dye = this.programs.emitDye
		dye.bind()
		gl.uniform1i(dye.uniforms.uTarget, this.density.read.attach(0))
		gl.uniform1i(dye.uniforms.uImage, image.attach(1))
		gl.uniform4f(dye.uniforms.uRect, rect[0], rect[1], rect[2], rect[3])
		gl.uniform2f(dye.uniforms.uDir, dir[0], dir[1])
		gl.uniform1f(dye.uniforms.uProgress, progress)
		gl.uniform1f(dye.uniforms.uEdge, edge)
		gl.uniform1f(dye.uniforms.uAmount, amount)
		gl.uniform1f(dye.uniforms.uBrightness, brightness)
		this.blit(this.density.write)
		this.density.swap()

		const vel = this.programs.emitVel
		vel.bind()
		gl.uniform1i(vel.uniforms.uTarget, this.velocity.read.attach(0))
		gl.uniform1i(vel.uniforms.uImage, image.attach(1))
		gl.uniform4f(vel.uniforms.uRect, rect[0], rect[1], rect[2], rect[3])
		gl.uniform2f(vel.uniforms.uDir, dir[0], dir[1])
		gl.uniform1f(vel.uniforms.uProgress, progress)
		gl.uniform1f(vel.uniforms.uEdge, edge)
		gl.uniform1f(vel.uniforms.uRise, rise)
		gl.uniform1f(vel.uniforms.uJitter, jitter)
		this.blit(this.velocity.write)
		this.velocity.swap()
	}

	/**
	 * Emit faint grey smoke + upward buoyancy along the cigarette burn front.
	 * `seeds` is a flat vec3 array (xy = image uv, z = birth time), `count` its
	 * active length. `rect` is the image's on-screen rectangle in uv (y up).
	 */
	emitBurn(
		rect: [number, number, number, number],
		seeds: Float32Array,
		count: number,
		time: number,
		aspect: number,
		spread: number,
		front: number,
		ragged: number,
		noiseScale: number,
		color: [number, number, number],
		amount: number,
		rise: number,
		jitter: number
	) {
		if (count <= 0) return
		const gl = this.gl

		const dye = this.programs.emitBurnDye
		dye.bind()
		gl.uniform1i(dye.uniforms.uTarget, this.density.read.attach(0))
		gl.uniform4f(dye.uniforms.uRect, rect[0], rect[1], rect[2], rect[3])
		gl.uniform3fv(dye.uniforms["uSeeds[0]"], seeds)
		gl.uniform1i(dye.uniforms.uSeedCount, count)
		gl.uniform1f(dye.uniforms.uTime, time)
		gl.uniform1f(dye.uniforms.uAspect, aspect)
		gl.uniform1f(dye.uniforms.uSpread, spread)
		gl.uniform1f(dye.uniforms.uFront, front)
		gl.uniform1f(dye.uniforms.uRagged, ragged)
		gl.uniform1f(dye.uniforms.uNoiseScale, noiseScale)
		gl.uniform3f(dye.uniforms.uColor, color[0], color[1], color[2])
		gl.uniform1f(dye.uniforms.uAmount, amount)
		this.blit(this.density.write)
		this.density.swap()

		const vel = this.programs.emitBurnVel
		vel.bind()
		gl.uniform1i(vel.uniforms.uTarget, this.velocity.read.attach(0))
		gl.uniform4f(vel.uniforms.uRect, rect[0], rect[1], rect[2], rect[3])
		gl.uniform3fv(vel.uniforms["uSeeds[0]"], seeds)
		gl.uniform1i(vel.uniforms.uSeedCount, count)
		gl.uniform1f(vel.uniforms.uTime, time)
		gl.uniform1f(vel.uniforms.uAspect, aspect)
		gl.uniform1f(vel.uniforms.uSpread, spread)
		gl.uniform1f(vel.uniforms.uFront, front)
		gl.uniform1f(vel.uniforms.uRagged, ragged)
		gl.uniform1f(vel.uniforms.uNoiseScale, noiseScale)
		gl.uniform1f(vel.uniforms.uRise, rise)
		gl.uniform1f(vel.uniforms.uJitter, jitter)
		this.blit(this.velocity.write)
		this.velocity.swap()
	}

	/**
	 * Push the whole velocity field with a constant wind plus an evolving
	 * curl-noise field, so the smoke keeps drifting and swirling on its own.
	 */
	applyForce(dt: number, wind: [number, number], turb: number, scale: number, time: number) {
		const gl = this.gl
		const p = this.programs.force
		p.bind()
		gl.uniform1i(p.uniforms.uVelocity, this.velocity.read.attach(0))
		gl.uniform2f(p.uniforms.uWind, wind[0], wind[1])
		gl.uniform1f(p.uniforms.uTurb, turb)
		gl.uniform1f(p.uniforms.uScale, scale)
		gl.uniform1f(p.uniforms.uTime, time)
		gl.uniform1f(p.uniforms.uAspect, this.simW / this.simH)
		gl.uniform1f(p.uniforms.uDt, dt)
		this.blit(this.velocity.write)
		this.velocity.swap()
	}

	/** Live-tune simulation dynamics from UI settings (called per frame). */
	setDynamics(d: { curl?: number; velocityDissipation?: number; densityDissipation?: number }) {
		if (d.curl !== undefined) this.config.CURL = d.curl
		if (d.velocityDissipation !== undefined) this.config.VELOCITY_DISSIPATION = d.velocityDissipation
		if (d.densityDissipation !== undefined) this.config.DENSITY_DISSIPATION = d.densityDissipation
	}

	/** Advance the simulation by dt seconds. */
	step(dt: number) {
		const gl = this.gl
		gl.disable(gl.BLEND)

		const p = this.programs
		const setTexel = (prog: Program, tx: number, ty: number) => gl.uniform2f(prog.uniforms.texelSize, tx, ty)

		p.curl.bind()
		setTexel(p.curl, this.velocity.texelX, this.velocity.texelY)
		gl.uniform1i(p.curl.uniforms.uVelocity, this.velocity.read.attach(0))
		this.blit(this.curl)

		p.vorticity.bind()
		setTexel(p.vorticity, this.velocity.texelX, this.velocity.texelY)
		gl.uniform1i(p.vorticity.uniforms.uVelocity, this.velocity.read.attach(0))
		gl.uniform1i(p.vorticity.uniforms.uCurl, this.curl.attach(1))
		gl.uniform1f(p.vorticity.uniforms.curl, this.config.CURL)
		gl.uniform1f(p.vorticity.uniforms.dt, dt)
		this.blit(this.velocity.write)
		this.velocity.swap()

		p.divergence.bind()
		setTexel(p.divergence, this.velocity.texelX, this.velocity.texelY)
		gl.uniform1i(p.divergence.uniforms.uVelocity, this.velocity.read.attach(0))
		this.blit(this.divergence)

		p.clear.bind()
		gl.uniform1i(p.clear.uniforms.uTexture, this.pressure.read.attach(0))
		gl.uniform1f(p.clear.uniforms.value, this.config.PRESSURE_DISSIPATION)
		this.blit(this.pressure.write)
		this.pressure.swap()

		p.pressure.bind()
		setTexel(p.pressure, this.velocity.texelX, this.velocity.texelY)
		gl.uniform1i(p.pressure.uniforms.uDivergence, this.divergence.attach(0))
		for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
			gl.uniform1i(p.pressure.uniforms.uPressure, this.pressure.read.attach(1))
			this.blit(this.pressure.write)
			this.pressure.swap()
		}

		p.gradient.bind()
		setTexel(p.gradient, this.velocity.texelX, this.velocity.texelY)
		gl.uniform1i(p.gradient.uniforms.uPressure, this.pressure.read.attach(0))
		gl.uniform1i(p.gradient.uniforms.uVelocity, this.velocity.read.attach(1))
		this.blit(this.velocity.write)
		this.velocity.swap()

		p.advection.bind()
		setTexel(p.advection, this.velocity.texelX, this.velocity.texelY)
		let velId = this.velocity.read.attach(0)
		gl.uniform1i(p.advection.uniforms.uVelocity, velId)
		gl.uniform1i(p.advection.uniforms.uSource, velId)
		gl.uniform1f(p.advection.uniforms.dt, dt)
		gl.uniform1f(p.advection.uniforms.dissipation, this.config.VELOCITY_DISSIPATION)
		this.blit(this.velocity.write)
		this.velocity.swap()

		// IMPORTANT (reference parity): on the linear-filtering path the reference
		// does NOT switch texelSize to the dye grid here — it keeps 1/simWidth so
		// the dye is displaced at the SAME uv rate as the velocity field. Using the
		// (much finer) dye texel size would under-advect the dye ~4x, giving weak,
		// wrong swirls. So we deliberately leave texelSize at the sim resolution.
		velId = this.velocity.read.attach(0)
		gl.uniform1i(p.advection.uniforms.uVelocity, velId)
		gl.uniform1i(p.advection.uniforms.uSource, this.density.read.attach(1))
		gl.uniform1f(p.advection.uniforms.dissipation, this.config.DENSITY_DISSIPATION)
		this.blit(this.density.write)
		this.density.swap()
	}

	/** Live glow strength, driven by cursor speed (0 = no glow). */
	setBloomGlow(glow: number) {
		this.config.BLOOM_GLOW = glow
	}

	/** Toggle the bloom glow pass entirely (off = plain smoke, no glow). */
	setBloom(enabled: boolean) {
		this.config.BLOOM = enabled
	}

	/** Draw the dye to the canvas (transparent where empty). */
	render() {
		const gl = this.gl

		const useBloom = this.config.BLOOM
		if (useBloom) this.applyBloom(this.density.read, this.bloom)

		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

		// Match the reference: pick display program by SHADING × BLOOM. The shading
		// variants need texelSize at the drawing-buffer resolution to sample the
		// four neighbours for the surface-normal gradient.
		const width = gl.drawingBufferWidth
		const height = gl.drawingBufferHeight

		if (this.config.SHADING) {
			const p = useBloom ? this.programs.displayBloomShading : this.programs.displayShading
			p.bind()
			gl.uniform2f(p.uniforms.texelSize, 1 / width, 1 / height)
			gl.uniform1i(p.uniforms.uTexture, this.density.read.attach(0))
			if (useBloom) {
				gl.uniform1i(p.uniforms.uBloom, this.bloom.attach(1))
				gl.uniform1f(p.uniforms.intensity, this.config.BLOOM_GLOW)
			}
			this.blit(null)
			return
		}

		if (useBloom) {
			const p = this.programs.displayBloom
			p.bind()
			gl.uniform1i(p.uniforms.uTexture, this.density.read.attach(0))
			gl.uniform1i(p.uniforms.uBloom, this.bloom.attach(1))
			gl.uniform1f(p.uniforms.intensity, this.config.BLOOM_GLOW)
			this.blit(null)
			return
		}

		const p = this.programs.display
		p.bind()
		gl.uniform1i(p.uniforms.uTexture, this.density.read.attach(0))
		this.blit(null)
	}

	dispose() {
		const gl = this.gl
		const ext = gl.getExtension("WEBGL_lose_context")
		ext?.loseContext()
	}
}
