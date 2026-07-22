export interface ParticleData {
  /** xyz positions, centered at origin. */
  positions: Float32Array;
  /** rgb color per particle, 0..1. */
  colors: Float32Array;
  /** normalized coordinate within the image plane, -0.5..0.5. */
  coords: Float32Array;
  /** three random values per particle. */
  seeds: Float32Array;
  count: number;
  /** world width of the plane. */
  width: number;
  /** world height of the plane. */
  height: number;
  /** the source image, ready to become a texture. */
  image: HTMLImageElement;
}

/** Lightweight metadata for showing an idle image as a textured plane. */
export interface ImageMeta {
  image: HTMLImageElement;
  /** world width of the plane. */
  width: number;
  /** world height of the plane. */
  height: number;
}

/** World-unit size of the longest side of an image plane. */
export const FIT = 3;

// Cache built particle data by src+density so navigating the filmstrip (or
// re-entering the render window) doesn't rebuild the heavy buffers each time.
const cache = new Map<string, ParticleData>();
const MAX_CACHE = 16;

// Cache the decoded <img> element per src so we never decode the same image
// twice (once for the plane, once for the particles).
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(src);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

/**
 * Cheaply load an image and compute its plane size, without sampling pixels or
 * allocating particle buffers. Used to render idle images as plain textured
 * planes until they actually need to vaporize.
 */
export async function loadImageMeta(src: string): Promise<ImageMeta> {
  const image = await loadImage(src);
  const ratio = image.width / image.height;
  const width = ratio >= 1 ? FIT : FIT * ratio;
  const height = ratio >= 1 ? FIT / ratio : FIT;
  return { image, width, height };
}

/**
 * Turn an image into a particle field. The longest side is sampled down to
 * `density` pixels; fully transparent pixels are skipped. The plane is sized so
 * its largest dimension is `FIT` world units.
 */
export async function buildParticleData(
  src: string,
  density: number,
): Promise<ParticleData> {
  const key = `${src}:${Math.round(density)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const data = await buildFresh(src, density);
  cache.set(key, data);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return data;
}

async function buildFresh(
  src: string,
  density: number,
): Promise<ParticleData> {
  const image = await loadImage(src);

  const longSide = Math.max(1, Math.round(density));
  const ratio = image.width / image.height;

  let sw: number;
  let sh: number;
  if (ratio >= 1) {
    sw = longSide;
    sh = Math.max(1, Math.round(longSide / ratio));
  } else {
    sh = longSide;
    sw = Math.max(1, Math.round(longSide * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(image, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  const width = ratio >= 1 ? FIT : FIT * ratio;
  const height = ratio >= 1 ? FIT / ratio : FIT;

  const total = sw * sh;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const coords = new Float32Array(total * 2);
  const seeds = new Float32Array(total * 3);

  let count = 0;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const i = (py * sw + px) * 4;
      const a = data[i + 3];
      if (a < 12) continue;

      const u = px / (sw - 1 || 1); // 0..1 left→right
      const v = py / (sh - 1 || 1); // 0..1 top→bottom

      const x = (u - 0.5) * width;
      const y = (0.5 - v) * height; // flip so image is upright

      const p3 = count * 3;
      positions[p3] = x;
      positions[p3 + 1] = y;
      positions[p3 + 2] = 0;

      colors[p3] = data[i] / 255;
      colors[p3 + 1] = data[i + 1] / 255;
      colors[p3 + 2] = data[i + 2] / 255;

      const c2 = count * 2;
      coords[c2] = x / (width || 1); // -0.5..0.5
      coords[c2 + 1] = y / (height || 1);

      seeds[p3] = Math.random() * 2 - 1;
      seeds[p3 + 1] = Math.random() * 2 - 1;
      seeds[p3 + 2] = Math.random();

      count++;
    }
  }

  return {
    positions: positions.subarray(0, count * 3),
    colors: colors.subarray(0, count * 3),
    coords: coords.subarray(0, count * 2),
    seeds: seeds.subarray(0, count * 3),
    count,
    width,
    height,
    image,
  };
}
