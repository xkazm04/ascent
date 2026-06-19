// Risk radar data + timeline for the "Catch it early" Remotion composition. The radar keeps
// IDENTIFYING risks (each blip pings in at its detect frame) while a MITIGATION WAVE expands from the
// center; a blip is mitigated the moment the wave front reaches its radius (and it's been identified).
// One blip sits beyond the wave's reach (WAVE_MAX) — the risk left open. Blip coordinates + derived
// frames are pre-computed integers (no per-frame trig) → deterministic. Paced to ~30% speed.

export const W = 960;
export const H = 540;
export const FPS = 30;
export const DURATION = 330;
export const CX = 480;
export const CY = 280;
export const R = 195;

export const WAVE_START = 70; // the mitigation wave begins after the first risks are identified
export const WAVE_END = 270;
export const WAVE_MAX = 168; // the wave's reach — blips farther than this stay open
export const BEAM_END = 170; // the identification sweep fades out here

interface RawBlip {
  x: number;
  y: number;
  detect: number; // frame the radar identifies it (enters alert)
  critical: boolean;
}

// Ordered roughly inner → outer so the expanding wave mitigates them in sequence.
const RAW: RawBlip[] = [
  { x: 402, y: 235, detect: 25, critical: true },
  { x: 570, y: 343, detect: 45, critical: true },
  { x: 348, y: 328, detect: 70, critical: true },
  { x: 531, y: 139, detect: 95, critical: false },
  { x: 385, y: 415, detect: 120, critical: false },
  { x: 644, y: 340, detect: 145, critical: false }, // dist > WAVE_MAX → never mitigated (left open)
];

export interface Blip extends RawBlip {
  dist: number;
  mitigate: number; // frame the wave front reaches it (≥ detect); Infinity if beyond the wave
}

export const BLIPS: Blip[] = RAW.map((b) => {
  const dist = Math.round(Math.hypot(b.x - CX, b.y - CY));
  const mitigate =
    dist <= WAVE_MAX
      ? Math.round(Math.max(b.detect, WAVE_START + (dist / WAVE_MAX) * (WAVE_END - WAVE_START)))
      : Infinity;
  return { ...b, dist, mitigate };
});
