// Deterministic fixtures for the scan-ledger scene — FICTION, and the scene says so on screen. Seeded
// (mulberry32): the same volume yields the same rows every mount, so the jsdom test and a screenshot
// are reproducible. No Math.random, no Date.now: moments are OFFSETS from a mount instant the scene
// captures once, so relative labels are stable at mount and the future-skew rows stay in the future.
// No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { SCAN_STATUS_MEMBERS, SEVERITY_MEMBERS, type ScanStatus, type Severity } from "./vocabulary";

export type ScanRow = {
  id: string;
  /** Repo names are OUTSIDE-AUTHORED text: rendered as text, never keyed on. */
  repo: string;
  /** Typed as string on purpose: this is the value AS IT CROSSES THE WIRE, resolved by the total resolvers. */
  status: string;
  topSeverity: string;
  costUsd: number | null;
  tokens: number;
  passRate: number;
  /** Seconds before the mount instant (negative = the future: clock skew, a misparsed instant). */
  finishedOffsetS: number;
};

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

/** `list[i mod len]`: a non-empty list is always hit, whatever the index. */
function cycle<T>(list: readonly T[], i: number): T {
  return list[i % list.length]!; // invariant: every list fed here is a non-empty constant
}

const NAMES = ["alloy-api", "basalt-web", "cirrus-worker", "delta-cli", "ember-docs", "fathom-sdk", "granite-infra", "harbor-ui", "isobar-etl", "juniper-mobile"];
const OFFSETS_S = [12, 95, 740, 3_900, 26_000, 90_000, 400_000, 3_000_000];

/** `volume` rows with system-of-record identities (`scan-<n>`). The scene shows a window. */
export function rowsFor(volume: SurfaceVolume, seed = 11): ScanRow[] {
  const rnd = mulberry32(seed);
  const out: ScanRow[] = [];
  for (let i = 0; i < volume; i++) {
    const r = rnd();
    const status: ScanStatus = cycle(SCAN_STATUS_MEMBERS, Math.floor(rnd() * SCAN_STATUS_MEMBERS.length));
    const sev: Severity = cycle(SEVERITY_MEMBERS, Math.floor(rnd() * SEVERITY_MEMBERS.length));
    out.push({
      id: `scan-${i + 1}`,
      repo: `${NAMES[i % NAMES.length]}-${String(i + 1).padStart(2, "0")}`,
      status,
      topSeverity: sev,
      // Three facts on purpose: a real sub-cent spend, an exact zero, an absent figure, and money.
      costUsd: i % 4 === 1 ? 0.0042 : i % 4 === 2 ? 0 : i % 4 === 3 ? null : Math.round(r * 250_000) / 100,
      tokens: Math.round(rnd() * 2_400_000),
      passRate: Math.round(rnd() * 1000) / 1000,
      finishedOffsetS: cycle(OFFSETS_S, i),
    });
  }
  return out;
}

export const WINDOW = 8;

/** The row a skewed producer delivers: two tokens this consumer has no label for, and a future instant. */
export const SKEW_ROW: ScanRow = {
  id: "scan-skew",
  repo: "kestrel-gateway-99",
  status: "dead_letter",
  topSeverity: "p0",
  costUsd: 3.5,
  tokens: 48_000,
  passRate: 0.5,
  finishedOffsetS: -3 * 3600, // three hours in the future: beyond tolerance, relative is abandoned
};

/** A row 40 seconds in the future: within tolerance, clamped to "now". */
export const SMALL_SKEW_OFFSET_S = -40;

/** Hostile names the untrusted-label region offers as one-click samples. */
/** A repository name that spells a severity token — the pill must never be handed it. */
export const TOKEN_LOOKALIKE_SAMPLE = { key: "looks like a token", value: "critical" } as const;
export const HOSTILE_SAMPLES: readonly { key: string; value: string }[] = [
  { key: "markup", value: '<img src=x onerror="alert(1)"> <b>bold?</b>' },
  { key: "no spaces", value: "a".repeat(48) + "-service-that-never-breaks-" + "b".repeat(48) },
  { key: "RTL", value: "שירות-נתונים main-api" },
  TOKEN_LOOKALIKE_SAMPLE,
  { key: "emoji", value: "🚀🔥 launch-svc ✨" },
];
