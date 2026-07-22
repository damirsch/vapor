export type ImageStatus = "idle" | "vaporizing" | "done";

export interface VaporImage {
  id: string;
  src: string;
  name: string;
  status: ImageStatus;
}

export type SweepDirection = "up" | "down" | "left" | "right" | "diagonal";

export type PlaybackMode = "idle" | "single" | "all";

export interface Settings {
  /** How fast the sweep travels (progress units per second). */
  speed: number;
  /** Displacement magnitude of the vapor. */
  strength: number;
  /** Scale of the curl-noise turbulence. */
  turbulence: number;
  /** Base particle size. */
  particleSize: number;
  /** Sampling resolution (long side in px) — controls particle count. */
  density: number;
  /** Softness of the dissolving band (sweep line width). */
  edge: number;
  /** How long particles drift & linger before fully vanishing. */
  lifetime: number;
  /** Horizontal drift of the vapor. */
  driftX: number;
  /** Vertical drift of the vapor (negative = downward, the default). */
  driftY: number;
  /** Radius of the cursor wake field. */
  hoverRadius: number;
  /** Strength of the cursor wake (how hard the pointer drags the smoke). */
  hoverForce: number;
  /** Delay between images in "Vaporize all" mode (seconds). */
  delay: number;
  /** Direction the sweep bar travels. */
  direction: SweepDirection;
  /**
   * Whether the cursor paints its own colored swirls. When off, the pointer
   * still stirs the fluid (so it keeps affecting vaporized smoke) but adds no
   * new colored dye of its own.
   */
  cursorSmoke: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 0.5,
  strength: 0.35,
  turbulence: 2.34,
  particleSize: 2.8,
  density: 400,
  edge: 0.2,
  lifetime: 1.5,
  driftX: 0.66,
  driftY: 0.8,
  hoverRadius: 0.3,
  hoverForce: 0.2,
  delay: 0.4,
  direction: "up",
  cursorSmoke: false,
};

export function directionToVec(dir: SweepDirection): [number, number] {
  switch (dir) {
    case "up":
      return [0, 1];
    case "down":
      return [0, -1];
    case "left":
      return [-1, 0];
    case "right":
      return [1, 0];
    case "diagonal": {
      const s = 1 / Math.SQRT2;
      return [s, s];
    }
  }
}
