// Version migration for stored App Readiness Passports.
//
// A passport is persisted at SCAN time (Scan.passportJson + Repository.passportJson) and read back much
// later at display/export time. When the shape evolves, the stored rows do NOT get rewritten — there is no
// backfill and a re-scan is not guaranteed. So every read path lifts the stored object forward here.
//
// 0.1.0 → 0.2.0: automationReadiness.artifacts.memory/.skills went from boolean to a graded ladder.
// A stored `true` only ever meant "the path exists" — exactly the evidence that supports the `adhoc` rung
// and nothing more — so true → "adhoc", false → "none". We must never let a lifted value read as a fresh
// assessment, so the result is TAGGED: `migratedFrom: "0.1.0"` plus an evidence note. A reader that sees
// `governed` knows it was assessed; a reader that sees `adhoc` on a migrated passport knows it is a floor,
// not a measurement.
//
// 0.2.0 → 0.3.0: the passport gained a derived `autonomy` tier block (T0–T3) plus structured
// sandbox/hooks artifact booleans. The tier is DERIVED from fields every stored passport already
// carries, so old rows get a tier read-time without a rescan. The sandbox/hooks detectors did not
// exist when the row was written — the migration leaves them ABSENT (unknown, never a fabricated
// false) and the derived checklist names the re-scan instead of a missing artifact.
//
// Pure: clones, never mutates; no IO, no clock.

import type { AppPassport, ArtifactGrade } from "@/lib/types";
import { deriveAutonomyForStored } from "./passport-autonomy";

export const PASSPORT_VERSION = "0.3.0";

const MIGRATION_NOTE_020 =
  "Lifted from passport 0.1.0: automation artifacts memory/skills were booleans; present→adhoc, absent→none. These are migration floors, not a fresh assessment. Re-scan to grade them.";

const MIGRATION_NOTE_030 =
  "Lifted to passport 0.3.0: autonomy tier derived read-time from stored fields. Sandbox/hooks were not scanned for by this row's scan, so they read as unknown (never fabricated). Re-scan to detect them.";

/** Semver-ish "is this stored passport older than `PASSPORT_VERSION`" test (majors/minors only; a missing
 *  or unparseable version is treated as the oldest shape, which is the conservative read). */
function isBefore(version: string | undefined, target: string): boolean {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return true;
  const parse = (s: string): [number, number, number] => {
    const [x = 0, y = 0, z = 0] = s.split(".").map((n) => {
      const v = Number.parseInt(n, 10);
      return Number.isFinite(v) ? v : 0;
    });
    return [x, y, z];
  };
  const [a1, a2, a3] = parse(version);
  const [b1, b2, b3] = parse(target);
  return a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a3 < b3;
}

/** Coerce a 0.1.0 boolean (or an already-graded 0.2.0 string) to an ArtifactGrade. */
function toGrade(v: unknown): ArtifactGrade {
  if (v === "none" || v === "adhoc" || v === "curated" || v === "governed") return v;
  return v === true ? "adhoc" : "none";
}

/**
 * Lift a stored passport to the current PASSPORT_VERSION. Returns the SAME object when it is already
 * current (cheap no-op on the hot read path); otherwise a migrated clone tagged with `migratedFrom`.
 */
export function upgradePassport(pp: AppPassport): AppPassport {
  if (!isBefore(pp.passportVersion, PASSPORT_VERSION)) return pp;

  // A missing/garbage version is treated as the oldest shape (conservative), and labeled as such.
  const from = pp.passportVersion && /^\d+\.\d+\.\d+$/.test(pp.passportVersion) ? pp.passportVersion : "0.1.0";
  const next: AppPassport = JSON.parse(JSON.stringify(pp));
  const notes: string[] = [];

  // 0.1.0 → 0.2.0: boolean memory/skills → graded-ladder floors.
  if (isBefore(from, "0.2.0")) {
    const artifacts = next.automationReadiness?.artifacts as Record<string, unknown> | undefined;
    if (artifacts) {
      artifacts.memory = toGrade(artifacts.memory);
      artifacts.skills = toGrade(artifacts.skills);
    }
    notes.push(MIGRATION_NOTE_020);
  }

  // 0.2.0 → 0.3.0: derive the autonomy tier from the (now-lifted) stored fields. sandbox/hooks stay
  // absent — the old scan never looked, and deriveAutonomyForStored reads absence as unknown.
  if (isBefore(from, "0.3.0")) {
    next.autonomy = deriveAutonomyForStored(next);
    notes.push(MIGRATION_NOTE_030);
  }

  next.migratedFrom = from;
  next.passportVersion = PASSPORT_VERSION;
  if (next.evidence) {
    const existing = next.evidence.notes ?? [];
    for (const n of notes) if (!existing.includes(n)) existing.push(n);
    next.evidence.notes = existing;
  }
  return next;
}
