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
// 0.3.0 -> 0.4.0: blockers gained MINTED IDS (`findings[]`), named stack fields became three-valued
// (name / null / "unknown"), and `evidence` gained per-field detection strength. Three different lifts,
// each governed by the same rule — a migrated value is a FLOOR implied by the old shape, never a
// measurement:
//   - `findings` ARE derivable from a stored row: the blocker text is right there, so each line is
//     matched back to the cause code that produced it and the id is minted. A line that matches nothing
//     (a blocker from a build this table doesn't know) gets a deliberately NON-durable id, because
//     inventing a stable identity for prose we cannot classify is the exact defect ids exist to fix.
//   - Named `null`s are LEFT ALONE. The stored null conflates "absent" with "could not classify" and
//     nothing in the row can separate them; rewriting them all to "unknown" would erase every genuine
//     "no error tracking" finding in the fleet, and leaving them as null at least keeps the floor. The
//     ambiguity is disclosed in an evidence note instead of being papered over.
//   - `evidence.fields` is left ABSENT. That scan never rated a field, so there is no strength to lift;
//     absent reads as unknown and a reader falls back to the whole-artifact confidence, exactly as it
//     did before 0.4.0. Never a fabricated 1.0.
//
// Pure: clones, never mutates; no IO, no clock.

import type { AppPassport, ArtifactGrade, FindingSeverity, PassportFinding } from "@/lib/types";
import { deriveAutonomyForStored } from "./passport-autonomy";

export const PASSPORT_VERSION = "0.4.0";

const MIGRATION_NOTE_020 =
  "Lifted from passport 0.1.0: automation artifacts memory/skills were booleans; present→adhoc, absent→none. These are migration floors, not a fresh assessment. Re-scan to grade them.";

const MIGRATION_NOTE_030 =
  "Lifted to passport 0.3.0: autonomy tier derived read-time from stored fields. Sandbox/hooks were not scanned for by this row's scan, so they read as unknown (never fabricated). Re-scan to detect them.";

const MIGRATION_NOTE_040 =
  "Lifted to passport 0.4.0: blocker ids were minted from each stored blocker's text. Per-field evidence strength was never assessed by this row's scan, so evidence.fields is absent (unknown, never fabricated). A null on a named stack field in this row is the pre-0.4.0 encoding that meant EITHER 'absent' OR 'could not classify' - re-scan to separate them.";

/** Legacy blocker prose -> the cause code and severity the 0.4.0 builder mints for it. This table IS
 *  the "map old keys forward" step: without it, changing the join key from prose to id would orphan
 *  every decline ever made, which is the failure the change exists to prevent. Ordered longest-lived
 *  first; each pattern is anchored the same way the pre-0.4.0 decline regexes were. */
const LEGACY_FINDINGS: { axis: "auto" | "prod"; match: RegExp; code: string; severity: FindingSeverity }[] = [
  { axis: "auto", match: /^no in-repo \.ai\/manifest/i, code: "no-manifest", severity: "warn" },
  { axis: "auto", match: /^no machine-readable context graph/i, code: "no-context-graph", severity: "warn" },
  { axis: "auto", match: /^no agent memory/i, code: "no-memory", severity: "warn" },
  { axis: "auto", match: /^no reusable agent skills/i, code: "no-skills", severity: "info" },
  { axis: "auto", match: /^no evidence ai is actually used/i, code: "no-ai-in-workflow", severity: "info" },
  { axis: "auto", match: /^agent can't self-verify/i, code: "self-verify-gaps", severity: "block" },
  { axis: "prod", match: /^zero observability/i, code: "zero-observability", severity: "block" },
  { axis: "prod", match: /^ci does not gate merges/i, code: "ci-not-gating", severity: "block" },
  { axis: "prod", match: /^no dependency\/secret\/sast scanning/i, code: "no-security-scanning", severity: "block" },
  { axis: "prod", match: /^enforcement \(branch protection\) not observable/i, code: "enforcement-not-observable", severity: "info" },
];

/** Back-fill `findings` from a stored row's rendered `blockers`. An unmatched line keeps its text but
 *  gets an id marked `unclassified` and suffixed by position: that id is INTENTIONALLY not durable
 *  (it moves if the list changes), so nothing downstream may persist a judgment against it. Re-scan
 *  to get real ids. */
function backfillFindings(blockers: string[] | undefined, axis: "auto" | "prod"): PassportFinding[] {
  return (blockers ?? []).map((text, i) => {
    const hit = LEGACY_FINDINGS.find((f) => f.axis === axis && f.match.test(text));
    return hit
      ? { id: `${axis}.${hit.code}`, code: hit.code, text, severity: hit.severity }
      : { id: `${axis}.unclassified.${i}`, code: "unclassified", text, severity: "info" as FindingSeverity };
  });
}

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

  // 0.3.0 -> 0.4.0: mint ids for the stored blockers. Named nulls and evidence.fields are deliberately
  // left as they are (see the header): a floor is honest, a fabricated measurement is not.
  if (isBefore(from, "0.4.0")) {
    if (next.automationReadiness) next.automationReadiness.findings = backfillFindings(next.automationReadiness.blockers, "auto");
    if (next.productionReadiness) next.productionReadiness.findings = backfillFindings(next.productionReadiness.blockers, "prod");
    notes.push(MIGRATION_NOTE_040);
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
