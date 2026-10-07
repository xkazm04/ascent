// GUARD: no silent catch in the scan-queue, cron and org stream-route paths (org-fleet-dashboard robustness-1). A failed
// queue read/write or cron step must not vanish into a fabricated 0, null or []: it reaches a door
// (degradedRead / noteReadFailure, a console.warn plus reportHandledError) or sits on the allowlist
// below with a reason. Class A/B/C: docs/adr/2026-10-07-failed-read-is-not-absence.md. Reuses the
// briefing guard's code-not-prose matcher; a seeded violation per shape proves it still bites.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSilentCatches, type SilentShape } from "./org/briefing-silent-catch.scan";

const ROOT = join(__dirname, "..", "..");

const SOURCES = [
  "src/app/api/cron/rescan/route.ts",
  "src/app/api/cron/probe/route.ts",
  "src/lib/db/scan-jobs.ts",
  "src/lib/scan-queue-worker.ts",
  "src/app/api/org/import/route.ts",
  "src/app/api/org/scan/route.ts",
  "src/app/api/org/scan/queue/route.ts",
];

interface Allowed {
  file: string;
  shape: SilentShape;
  /** How many sites of this shape the file legitimately holds. A different count fails, so an entry cannot go stale. */
  count: number;
  reason: string;
}

// Class C only. The first sweep found 39 silent sites in the four queue/cron files, all class A/B (fixed).
// The three org routes (import, scan, scan/queue) held 16: 13 class B (now through degradedRead) and these 3.
const ALLOWED: Allowed[] = [
  { file: "src/app/api/org/import/route.ts", shape: "catch-literal", count: 2, reason: "a quota-event telemetry write on the 429 path, and a request-body parse that becomes the 400 answer" },
  { file: "src/app/api/org/scan/route.ts", shape: "catch-literal", count: 1, reason: "a request-body parse that becomes the 400 'Missing org' answer" },
];

const allowed = (file: string, shape: SilentShape) =>
  ALLOWED.filter((a) => a.file === file && a.shape === shape).reduce((n, a) => n + a.count, 0);

function scan() {
  const found: { file: string; shape: SilentShape; line: number; text: string }[] = [];
  for (const rel of SOURCES) {
    const abs = join(ROOT, rel);
    expect(existsSync(abs), `${rel} must exist`).toBe(true);
    for (const s of findSilentCatches(readFileSync(abs, "utf8"))) found.push({ file: rel, ...s });
  }
  return found;
}

describe("silent catches in the scan-queue and cron paths", () => {
  it("every silent catch is allowlisted with a reason, and no allowlist entry is stale", () => {
    const found = scan();
    const problems: string[] = [];
    const keys = new Set([...found.map((f) => `${f.file}|${f.shape}`), ...ALLOWED.map((a) => `${a.file}|${a.shape}`)]);
    for (const key of keys) {
      const [file, shape] = key.split("|") as [string, SilentShape];
      const hits = found.filter((f) => f.file === file && f.shape === shape);
      if (hits.length !== allowed(file, shape)) {
        problems.push(`${file} [${shape}] found ${hits.length}, allowlisted ${allowed(file, shape)}: ${hits.map((h) => `L${h.line} ${h.text}`).join(" | ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every allowlist entry names a guarded file and carries a reason", () => {
    for (const a of ALLOWED) {
      expect(SOURCES).toContain(a.file);
      expect(a.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("the matcher still bites (seeded violations)", () => {
  const seeded: [string, string, SilentShape][] = [
    ["a literal .catch", "const x = await read().catch(() => 0);", "catch-literal"],
    ["an array .catch", "const x = await read().catch((e) => []);", "catch-literal"],
    ["a no-op write .catch", "await write().catch(() => {});", "catch-literal"],
    ["an empty catch", "try { a(); } catch {}", "empty-catch"],
    ["a bare-return catch", "try { a(); } catch { return null; }", "catch-return"],
  ];
  for (const [name, src, shape] of seeded) {
    it(`flags ${name}`, () => expect(findSilentCatches(src).map((s) => s.shape)).toContain(shape));
  }

  it("does not flag a catch that reaches the door", () => {
    expect(findSilentCatches("const x = await read().catch(degradedRead('r', 0));")).toEqual([]);
    expect(findSilentCatches("try { a(); } catch (e) { noteReadFailure('r', e); return null; }")).toEqual([]);
  });
});
