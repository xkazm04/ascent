// Deterministic fixtures for the diff-comparison scene: one fictional repository (`harbor/lumen-api`),
// four scan snapshots of its detector signals, sized by the volume knob. Seeded (mulberry32), so every
// reader and every screenshot sees the same pair; no Math.random, no Date.now. Nothing here is an
// Ascent org — the scene says so on screen.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type SignalKind = "count" | "flag" | "text" | "blob" | "volatile";
/** One detector signal of a scan. `id` is minted once and survives reorder, rename and restore. */
export type Signal = { id: string; dim: string; name: string; value: string; kind: SignalKind };

export type ScanId = "scan-1180" | "scan-1191" | "scan-1204" | "scan-1204-alt";
export type BaselineSpecies = "temporal" | "lifecycle" | "sibling" | "declared";

export type Scan = { id: ScanId; sha: string; at: string; caption: string };

export const REPO = "harbor/lumen-api";
export const SCANS: readonly Scan[] = [
  { id: "scan-1180", sha: "a41c0e2", at: "2026-08-19", caption: "promoted · ships now" },
  { id: "scan-1191", sha: "7be90d1", at: "2026-08-28", caption: "previous scan" },
  { id: "scan-1204", sha: "f03a7c9", at: "2026-09-05", caption: "latest scan" },
  { id: "scan-1204-alt", sha: "c9d1b44", at: "2026-09-05", caption: "sibling branch" },
];

/** Which baseline each species names. The question decides; the data never does. */
export const SPECIES: readonly { id: BaselineSpecies; baseline: ScanId | null; question: string }[] = [
  { id: "temporal", baseline: "scan-1191", question: "what just changed?" },
  { id: "lifecycle", baseline: "scan-1180", question: "what would shipping this change?" },
  { id: "sibling", baseline: "scan-1204-alt", question: "how do the alternatives differ?" },
  { id: "declared", baseline: null, question: "does reality match the promise?" },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIMS = ["D1 guidance", "D2 tests", "D3 ci", "D4 security", "D5 docs", "D6 observability"];
const NOUNS = ["workflow", "detector", "coverage", "hook", "policy", "manifest", "linter", "scanner", "budget", "rule"];

/** The ancestral signal list every scan is derived from: `volume` rows with system-of-record ids. */
export function ancestralSignals(volume: SurfaceVolume): Signal[] {
  const rnd = mulberry32(volume);
  const out: Signal[] = [];
  for (let i = 0; i < volume; i++) {
    const n = i + 1;
    const kind: SignalKind = n === 3 ? "blob" : n === 5 ? "volatile" : n % 3 === 0 ? "flag" : n % 3 === 1 ? "count" : "text";
    const value =
      kind === "blob" ? "<binary 4.2 KB sha:91ab>" : kind === "volatile" ? "2026-08-19T06:12:40Z" : kind === "flag" ? "present" : kind === "count" ? String(Math.round(rnd() * 40)) : `${NOUNS[i % NOUNS.length]} configured`;
    out.push({ id: `sig-${n}`, dim: DIMS[i % DIMS.length], name: `${NOUNS[i % NOUNS.length]}-${String(n).padStart(2, "0")}`, value, kind });
  }
  return out;
}

type Edits = { seed: number; changeRate: number; removeRate: number; inserts: number; move: boolean; stamp: string };

const EDITS: Record<ScanId, Edits> = {
  "scan-1180": { seed: 11, changeRate: 0.01, removeRate: 0.002, inserts: 0, move: false, stamp: "2026-08-19T06:12:40Z" },
  "scan-1191": { seed: 19, changeRate: 0.02, removeRate: 0.004, inserts: 1, move: false, stamp: "2026-08-28T11:03:07Z" },
  "scan-1204": { seed: 29, changeRate: 0.03, removeRate: 0.006, inserts: 2, move: true, stamp: "2026-09-05T09:41:55Z" },
  "scan-1204-alt": { seed: 31, changeRate: 0.025, removeRate: 0.005, inserts: 2, move: false, stamp: "2026-09-05T09:58:12Z" },
};

/** A scan's signals: the ancestral list under that scan's deterministic edits (values drift, a few rows
 *  leave, new ids arrive at the HEAD so positional alignment shifts every row after them, and the
 *  latest scan moves one row — a move, not a remove-plus-add). */
export function signalsFor(volume: SurfaceVolume, scan: ScanId): Signal[] {
  const e = EDITS[scan];
  const rnd = mulberry32(e.seed * 1000 + volume);
  const out: Signal[] = [];
  for (const s of ancestralSignals(volume)) {
    const r = rnd();
    if (s.kind === "volatile") {
      out.push({ ...s, value: e.stamp });
      continue;
    }
    if (s.kind === "blob") {
      out.push({ ...s, value: `<binary 4.2 KB sha:${e.seed}f${scan.slice(-2)}>` });
      continue;
    }
    if (r < e.removeRate) continue;
    if (r < e.removeRate + e.changeRate) {
      const value = s.kind === "count" ? String(Number(s.value) + 1 + Math.round(rnd() * 5)) : s.kind === "flag" ? "absent" : `${s.value} (v2)`;
      out.push({ ...s, value });
      continue;
    }
    out.push(s);
  }
  for (let k = e.inserts; k > 0; k--) {
    out.unshift({ id: `new-${scan}-${k}`, dim: DIMS[k % DIMS.length], name: `arrival-${k}`, value: "present", kind: "flag" });
  }
  if (e.move && out.length > 12) {
    const idx = out.findIndex((s) => s.id === "sig-8");
    if (idx >= 0) {
      const [row] = out.splice(idx, 1);
      out.splice(Math.min(out.length, idx + 9), 0, row);
    }
  }
  return out;
}

/** The line level's input: a YAML-ish serialization. `style` "b" reorders keys and requotes strings —
 *  the formatting churn that becomes forty phantom edits under a text diff. */
export function serialize(rows: readonly Signal[], style: "a" | "b"): string {
  const lines: string[] = [];
  for (const s of rows) {
    if (style === "a") lines.push(`- id: ${s.id}`, `  name: ${s.name}`, `  value: ${s.value}`);
    else lines.push(`- name: "${s.name}"`, `  id: "${s.id}"`, `  value: "${s.value}"`);
  }
  return lines.join("\n");
}

/** Rows rendered from a window of the diff, never the whole volume. */
export const WINDOW = 24;
