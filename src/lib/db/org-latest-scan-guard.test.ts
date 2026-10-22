// The latest-scan door, guarded (rollups-0, challenge-2026-10-22).
//
// "Each repo's latest scan" has ONE implementation: org-rollup-latest-scans.ts (`withLatestScans`,
// `readLatestScanPerRepo`, `readLatestTwoScansPerRepo`). A nested `scans: { ..., take: N }` relation
// looks equivalent and is not: under Prisma 6.19's client query compiler the relation `take` is applied
// AFTER the fetch, so the statement carries no LIMIT and the org's whole scan history crosses the wire
// to keep N rows per repo (measured in getOrgBacklog's header, org-insights.ts). The fix landed in three
// readers in f3f0e79d "so the call sites cannot drift" - and fifteen more kept the old shape. This
// guard is what stops the sixteenth.
//
// Per AGENTS.md's rule for source-scanning gates: comments and string literals are stripped BEFORE
// matching (every module here explains, in prose, the shape it must not use - and the prose must not
// satisfy or trip the matcher), and a seeded violation proves the matcher still bites.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DB_DIR = join(process.cwd(), "src", "lib", "db");

/**
 * Exemptions, each with the reason it cannot use the door. A new entry needs a reason as specific as
 * this one, or it is a violation with a comment.
 */
const ALLOWLIST: Record<string, string> = {
  "org-benchmark.ts":
    "BENCHMARK_ELIGIBLE filters the nested scans on engineProvider (latest ELIGIBLE scan, not latest scan) - a scan-column " +
    "filter outside latestScanAtPerRepo's where-contract (repo scope + scannedAt only), and the corpus read is capped by " +
    "repository `take: BENCHMARK_CORPUS_CAP` across other tenants, which the org-scoped door does not model.",
};

/** Blank out comments and string/template literals, keeping every newline so line numbers survive. */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const keepNewlines = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += c + keepNewlines(src.slice(i + 1, j)) + c;
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Every `scans: { ... }` object literal whose OWN top level carries a `take` key, as 1-based lines. */
export function nestedScanTakeLines(src: string): number[] {
  const code = stripCommentsAndStrings(src);
  const lines: number[] = [];
  const opener = /\bscans\s*:\s*\{/g;
  for (let m = opener.exec(code); m; m = opener.exec(code)) {
    let depth = 1;
    let found = false;
    for (let j = m.index + m[0].length; j < code.length && depth > 0; j++) {
      const ch = code[j]!;
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
      else if (depth === 1 && /\btake\s*:/y.test(code.slice(j, j + 40)) && !/\w/.test(code[j - 1] ?? "")) found = true;
    }
    if (found) lines.push(code.slice(0, m.index).split("\n").length);
  }
  return lines;
}

function violations(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(DB_DIR)) {
    if (!/^org-.*\.ts$/.test(f) || /\.test(-helpers)?\.ts$/.test(f) || f in ALLOWLIST) continue;
    for (const line of nestedScanTakeLines(readFileSync(join(DB_DIR, f), "utf8"))) out.push(`${f}:${line}`);
  }
  return out;
}

describe("the latest-scan door is the only way a src/lib/db/org-*.ts module asks for a repo's latest scan", () => {
  it("no module carries a nested `scans: { ..., take }` relation (use withLatestScans)", () => {
    expect(violations()).toEqual([]);
  });

  it("every allowlisted file exists, still needs its exemption, and states a reason", () => {
    for (const [f, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(40);
      expect(nestedScanTakeLines(readFileSync(join(DB_DIR, f), "utf8")).length).toBeGreaterThan(0);
    }
  });
});

describe("the matcher (seeded, so a matcher that stops matching cannot report a clean tree)", () => {
  it("reports file:line for the one-line shape", () => {
    const src = 'const a = 1;\nconst r = await p.repository.findMany({ select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { id: true } } } });\n';
    expect(nestedScanTakeLines(src)).toEqual([2]);
  });

  it("seeded violation: an inline fixture carrying a multi-line nested `take: 2` reports exactly 1", () => {
    const seeded = [
      "const repos = await prisma.repository.findMany({",
      "  select: {",
      "    id: true,",
      "    scans: {",
      '      orderBy: { scannedAt: "desc" },',
      "      take: 2,",
      "      select: { overallScore: true, dimensions: { select: { dimId: true } } },",
      "    },",
      "  },",
      "});",
    ].join("\n");
    expect(nestedScanTakeLines(seeded)).toEqual([4]);
  });

  it("the same text inside a // comment, a block comment or a string literal passes", () => {
    const shape = 'scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { id: true } }';
    expect(nestedScanTakeLines(`// ${shape}\nconst x = 1;`)).toEqual([]);
    expect(nestedScanTakeLines(`/* ${shape} */\nconst x = 1;`)).toEqual([]);
    expect(nestedScanTakeLines(`const doc = '${shape.replace(/"/g, "")}';`)).toEqual([]);
    expect(nestedScanTakeLines("const doc = `" + shape + "`;")).toEqual([]);
  });

  it("a `take` deeper than the scans object's own level is not the relation take", () => {
    expect(nestedScanTakeLines("x({ scans: { select: { recommendations: { take: 5 } } } });")).toEqual([]);
    expect(nestedScanTakeLines("x({ scans: { where: { id: 1 } }, take: 3 });")).toEqual([]);
  });

  it("the allowlisted benchmark read is still caught by the matcher (it is exempt, not invisible)", () => {
    expect(nestedScanTakeLines(readFileSync(join(DB_DIR, "org-benchmark.ts"), "utf8")).length).toBe(2);
  });
});
