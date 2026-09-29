// Shared shapes for the Prism canvas engine. No DOM access here.

export type Pt = [number, number];

/** One of the nine outgoing lines: origin on the prism's exit face (O) to its end at the label rail (E). */
export interface Ray {
  O: Pt;
  E: Pt;
  i: number;
}

/** The hero's drawing geometry in CSS pixels, from a fixed 1600x1000 (or 390x844) design frame. */
export interface Geometry {
  /** Scale of the design frame to the hero box. */
  U: number;
  /** Prism apex, base left, base right. */
  A: Pt;
  BL: Pt;
  BR: Pt;
  /** Entry and exit points of the beam inside the glass. */
  E: Pt;
  X: Pt;
  /** Source of the incoming white beam (bottom edge of the hero). */
  S: Pt;
  rays: Ray[];
}

export interface Layout {
  W: number;
  H: number;
  mobile: boolean;
  geometry: Geometry;
  /** Value for the root's --U / --FL custom properties; null means "remove, use the stylesheet default". */
  cssU: string | null;
  cssFL: string | null;
  /** Desktop only: absolute positions (px) of the nine line labels and the two annotations. */
  labels: Array<{ left: number; top: number }>;
  annIn: { left: number; top: number } | null;
  annOut: { right: number; top: number } | null;
  archSwitch: { right: number; top: number } | null;
}

export interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ph: number;
}

/** What the per-frame painter needs; owned and mutated by engine.ts. */
export interface EngineState {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  dpr: number;
  mobile: boolean;
  reduced: boolean;
  introDone: boolean;
  g: Geometry;
  hues: readonly string[];
  intensity: number[];
  glow: HTMLCanvasElement[];
  glowIn: HTMLCanvasElement | null;
  dust: Dust[];
  /** Half-width in px of line `i`'s fan at its far end (weight x scale). */
  halfW: (i: number) => number;
}
