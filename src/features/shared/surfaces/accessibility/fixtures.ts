// Deterministic fixtures for the accessibility scene: a fleet follow-ups desk. Seeded (mulberry32),
// so every reader and every screenshot sees the same rows at the same volume. FICTION — the scene
// prints that on screen. No Math.random, no Date.now, no React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type Segment = { id: string; label: string };
export type RowStatus = "open" | "due" | "done";
export type Row = { id: string; title: string; repo: string; segment: string; status: RowStatus; days: number };

export const SEGMENTS: readonly Segment[] = [
  { id: "all", label: "All" },
  { id: "platform", label: "Platform" },
  { id: "product", label: "Product" },
  { id: "data", label: "Data" },
  { id: "infra", label: "Infra" },
];

const TITLES = ["Add CODEOWNERS", "Pin CI runner image", "Document scan budget", "Remove stale token", "Wire release notes", "Adopt the memory skill", "Gate the deploy", "Name the digest owner"];
const REPOS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `volume` follow-ups with system-of-record identities (`fu-<n>`), never positional. */
export function rowsFor(volume: SurfaceVolume, seed = 11): Row[] {
  const rnd = mulberry32(seed);
  const segs = SEGMENTS.slice(1);
  const out: Row[] = [];
  for (let i = 0; i < volume; i++) {
    const r = rnd();
    out.push({
      id: `fu-${i + 1}`,
      title: TITLES[i % TITLES.length]!,
      repo: `${REPOS[Math.floor(rnd() * REPOS.length)]}-${String(i + 1).padStart(2, "0")}`,
      segment: segs[i % segs.length]!.id,
      status: r > 0.8 ? "done" : r > 0.45 ? "due" : "open",
      days: Math.round(rnd() * 30),
    });
  }
  return out;
}

/** The desk shows a window; the volume knob sizes the identity set, not the DOM. */
export const WINDOW = 6;

/** Status as text + glyph, so meaning survives a forced palette (the structural carrier). */
export const STATUS_GLYPH: Record<RowStatus, string> = { open: "○", due: "◐", done: "●" };
export const STATUS_TONE: Record<RowStatus, string> = { open: "text-slate-300", due: "text-warn", done: "text-success-soft" };

/** The held assistive-technology pairings (fiction), each result dated. Unlisted cells are untested. */
export type Pairing = { reader: string; browser: string; measured: string; prePopulated: "voices" | "silent"; repeat: "voices" | "silent" };
export const PAIRINGS: readonly Pairing[] = [
  { reader: "NVDA", browser: "Firefox", measured: "2026-08-30", prePopulated: "silent", repeat: "silent" },
  { reader: "VoiceOver", browser: "Safari", measured: "2026-08-30", prePopulated: "voices", repeat: "silent" },
  { reader: "JAWS", browser: "Chrome", measured: "2026-07-14", prePopulated: "silent", repeat: "voices" },
];
export const UNHELD: readonly { reader: string; browser: string }[] = [
  { reader: "Narrator", browser: "Edge" },
  { reader: "TalkBack", browser: "Chrome (Android)" },
];
