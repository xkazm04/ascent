// STRUCTURAL GUARD (export-0, challenge-2026-10-22d) - the report exports read through ONE door.
//
// The PDF, LLM-briefing and share-card exports each used to hand-roll the same preamble (parse, owner
// org, gate, read, 404/503) and drifted from the permalink twice: they ignored its canReadOrg-gated
// `?org=` hint and never took its strict read. `readReportForExport` (src/lib/report/export-read.ts)
// now owns that preamble. This pins that no export route goes around it by reading the report or
// resolving the org itself.
//
// It matches CODE, not prose (AGENTS.md): the source is stripped of comments and string literals
// first, and the seeded cases below prove both halves still bite - a direct read fails, and a route
// that only NAMES the door in a comment fails too.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = ["pdf", "llm", "share-card"].map((d) => join(process.cwd(), "src", "app", "api", "report", d, "route.ts"));
const BYPASSES = ["getScanReportByCommit", "readableOrgForOwner", "canReadOrg", "requireOrgRead"];
const DOOR = "readReportForExport";

/** Remove `//` and block comments and every string/template literal, so only code remains. */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
    } else out += c;
  }
  return out;
}

/** The violations a route source carries: a bypass called in code, or the door never called. */
function violations(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const found = BYPASSES.filter((b) => new RegExp(`\\b${b}\\b`).test(code));
  if (!new RegExp(`\\b${DOOR}\\s*\\(`).test(code)) found.push(`missing ${DOOR}()`);
  return found;
}

describe("report export door", () => {
  it.each(ROUTES)("%s reads the report only through readReportForExport", (file) => {
    expect(violations(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("seeded: a route that reads the report directly fails the guard", () => {
    const direct = `import { getScanReportByCommit } from "@/lib/db";
      export async function GET() { const r = await readReportForExport(req, o); await getScanReportByCommit("a", "b", {}); }`;
    expect(violations(direct)).toContain("getScanReportByCommit");
  });

  it("seeded: a route that names the door only in a comment or a string fails the guard", () => {
    const prose = `// every export goes through readReportForExport(request, ...)
      /* readReportForExport( is the door */
      const label = "readReportForExport(";
      export async function GET() { return new Response("ok"); }`;
    expect(violations(prose)).toEqual([`missing ${DOOR}()`]);
  });

  it("seeded: a route that calls the door in code passes", () => {
    const ok = `export async function GET(r) { const read = await readReportForExport(r, { label: "x" }); }`;
    expect(violations(ok)).toEqual([]);
  });
});
