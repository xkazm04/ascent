// GUARD: no silent catch in the executive-briefing-export span. A failed read must not vanish: it either
// reaches a door (console.warn + reportHandledError, via degradedRead / noteReadFailure / respondError)
// or sits on the allowlist below with a reason. Three shapes are silent: `.catch(() => <literal>)`, an
// empty `catch {}`, and a `catch` whose whole body is one `return`. Sibling of the swallowed-error sweep
// (robustness-3/-4/-5). The scan reads code, not comments (briefing-silent-catch.scan.ts), and a seeded
// violation per shape proves the matcher still bites.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIEFING_SPAN_SOURCES } from "./briefing-silent-catch.span";
import { findSilentCatches, type SilentShape } from "./briefing-silent-catch.scan";

const ROOT = join(__dirname, "..", "..", "..");

interface Allowed {
  file: string;
  shape: SilentShape;
  /** How many sites of this shape the file legitimately holds. A different count fails, so an entry cannot go stale. */
  count: number;
  reason: string;
}

const BODY = "a request-body parse: an unparseable body is treated as empty and answered 400 by validation";
const UI = "the fetch already failed visibly; a non-JSON error body falls back to a generic message shown to the reader";
const NET = "a network failure is returned to the reader as an inline message";

const ALLOWED: Allowed[] = [
  { file: "src/app/api/me/backlog/route.ts", shape: "catch-literal", count: 1, reason: BODY },
  { file: "src/app/api/me/watch/route.ts", shape: "catch-literal", count: 1, reason: BODY },
  { file: "src/app/api/org/program/route.ts", shape: "catch-literal", count: 2, reason: BODY },
  { file: "src/lib/api/orgPost.ts", shape: "catch-literal", count: 1, reason: BODY },
  { file: "src/components/org/PersonalBacklogControls.tsx", shape: "catch-literal", count: 1, reason: UI },
  { file: "src/components/org/PersonalBacklogControls.tsx", shape: "catch-return", count: 1, reason: NET },
  { file: "src/components/org/PersonalWatchControls.tsx", shape: "catch-literal", count: 1, reason: UI },
  { file: "src/components/org/PersonalWatchControls.tsx", shape: "catch-return", count: 1, reason: NET },
  { file: "src/components/org/shared/RepoDimensionModal.tsx", shape: "catch-literal", count: 1, reason: UI },
  { file: "src/features/bought/executive/BriefingShareButton.tsx", shape: "catch-literal", count: 1, reason: UI },
  { file: "src/components/report/DownloadButton.tsx", shape: "empty-catch", count: 1, reason: "read-only for this sweep (inventoried, not edited): a non-JSON error body keeps the generic message" },
  { file: "src/features/bought/executive/BriefingShareButton.tsx", shape: "empty-catch", count: 1, reason: "clipboard: a denied write falls through to the manual-copy presentation, which tells the reader" },
  { file: "src/components/CopyForLlm.tsx", shape: "catch-return", count: 1, reason: "clipboard: a blocked execCommand copy reports false and the manual-copy panel opens" },
  { file: "src/lib/signed-share.ts", shape: "catch-return", count: 1, reason: "an unparseable token payload is an invalid token: the expected answer to a mangled URL" },
  { file: "src/lib/org/briefing-narrative.ts", shape: "catch-return", count: 1, reason: "the LLM seam already metered the failure; the deterministic template is the floor" },
];

const allowed = (file: string, shape: SilentShape) =>
  ALLOWED.filter((a) => a.file === file && a.shape === shape).reduce((n, a) => n + a.count, 0);

function scanSpan() {
  const found: { file: string; shape: SilentShape; line: number; text: string }[] = [];
  for (const rel of BRIEFING_SPAN_SOURCES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    for (const s of findSilentCatches(readFileSync(abs, "utf8"))) found.push({ file: rel, ...s });
  }
  return found;
}

describe("silent catches in the briefing span", () => {
  it("every silent catch is allowlisted with a reason, and no allowlist entry is stale", () => {
    const found = scanSpan();
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

  it("every allowlist entry names a real span file and carries a reason", () => {
    for (const a of ALLOWED) {
      expect(BRIEFING_SPAN_SOURCES).toContain(a.file);
      expect(a.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("the matcher still bites (seeded violations)", () => {
  const seeded: [string, string, SilentShape][] = [
    ["a literal .catch", "const x = await read().catch(() => null);", "catch-literal"],
    ["an array .catch", "const x = await read().catch((e) => []);", "catch-literal"],
    ["an empty catch", "try { a(); } catch {}", "empty-catch"],
    ["an empty catch with only a comment", "try { a(); } catch (e) { /* nothing */ }", "empty-catch"],
    ["a bare-return catch", "try { a(); } catch { return null; }", "catch-return"],
  ];
  for (const [name, src, shape] of seeded) {
    it(`flags ${name}`, () => expect(findSilentCatches(src).map((s) => s.shape)).toContain(shape));
  }

  it("does not flag a catch that reaches a door", () => {
    expect(findSilentCatches("try { a(); } catch (e) { console.warn('x', e); return null; }")).toEqual([]);
    expect(findSilentCatches("const x = await read().catch(degradedRead('r', null));")).toEqual([]);
    expect(findSilentCatches("try { a(); } catch (err) { return respondError(503, 'm', { cause: err }); }")).toEqual([]);
  });

  it("reads code, not prose: a door named only in a comment or string does not satisfy it", () => {
    expect(findSilentCatches("try { a(); } catch { // console.warn(e) and reportHandledError\n return null; }").map((s) => s.shape)).toEqual(["catch-return"]);
    expect(findSilentCatches('try { a(); } catch { return "reportHandledError"; }').map((s) => s.shape)).toEqual(["catch-return"]);
  });
});
