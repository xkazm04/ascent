// Structural guard for the public-corpus door (card portfolio-0). Every Prisma read in
// src/lib/register/** and in the landing gallery (src/lib/db/scans-gallery.ts) must carry the tenancy fragment `publicCorpusWhere` (directly, or through a
// binding built from it), and the "is this a mock score" rule must exist in exactly one place.
//
// Comments and string literals are stripped BEFORE matching: a guard that reads prose is satisfied by
// prose. A seeded violation below proves the matcher still bites.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/** Blank out comments (and, unless keepStrings, string/template literals), preserving length. */
function strip(src: string, keepStrings = false): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      const lit = src.slice(i, j + 1);
      out += keepStrings ? lit : c + lit.slice(1, -1).replace(/[^\n]/g, " ") + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const CALL = /\b(?:prisma|getPrisma\(\))\s*\.\s*(\w+)\s*\.\s*(findMany|findFirst|findUnique|count|groupBy|aggregate)\s*\(/g;

/** Every Prisma read in `src` whose argument reaches no binding of `publicCorpusWhere`. */
function unguardedCorpusReads(src: string): { reads: number; violations: string[] } {
  const code = strip(src);
  const doors = new Set(["publicCorpusWhere"]);
  const bindings = [...code.matchAll(/\b(?:const|let)\s+(\w+)[^=;]*=([^;]*)/g)];
  for (let grew = true; grew; ) {
    grew = false;
    for (const [, name, rhs] of bindings) {
      if (doors.has(name!)) continue;
      if ([...doors].some((d) => new RegExp(`\\b${d}\\b`).test(rhs!))) {
        doors.add(name!);
        grew = true;
      }
    }
  }
  const violations: string[] = [];
  let reads = 0;
  for (const m of code.matchAll(CALL)) {
    reads++;
    let depth = 1;
    let j = m.index! + m[0].length;
    for (; j < code.length && depth > 0; j++) depth += code[j] === "(" ? 1 : code[j] === ")" ? -1 : 0;
    const arg = code.slice(m.index! + m[0].length, j - 1);
    if (![...doors].some((d) => new RegExp(`\\b${d}\\b`).test(arg))) violations.push(m[0] + arg.trim() + ")");
  }
  return { reads, violations };
}

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : walk(p, ext);
    return ext.test(f) && !/\.test\.tsx?$/.test(f) ? [p.replace(/\\/g, "/")] : [];
  });
}

describe("public-corpus door - every register read carries publicCorpusWhere", () => {
  const files = [...walk("src/lib/register", /\.ts$/), "src/lib/db/scans-gallery.ts"];

  it("scans real code (the matcher has something to match)", () => {
    const reads = files.reduce((n, f) => n + unguardedCorpusReads(readFileSync(f, "utf8")).reads, 0);
    expect(files).toEqual(expect.arrayContaining(["src/lib/register/data.ts", "src/lib/db/scans-gallery.ts"]));
    expect(reads).toBeGreaterThanOrEqual(6);
  });

  it.each(files)("%s has no read outside the door", (f) => {
    expect(unguardedCorpusReads(readFileSync(f, "utf8")).violations).toEqual([]);
  });

  it("SEEDED: an id-only fetch fails the guard", () => {
    const seeded = "const repos = await prisma.repository.findMany({ where: { id: { in: ids } } });";
    expect(unguardedCorpusReads(seeded).violations).toHaveLength(1);
  });

  it("the same text inside a comment or a string literal passes (comments and strings are stripped)", () => {
    const prose = [
      "// prisma.repository.findMany({ where: { id: { in: ids } } })",
      "/* prisma.scan.groupBy({ by: ['repoId'] }) */",
      'const s = "prisma.repository.findMany({ where: { id: { in: ids } } })";',
    ].join("\n");
    expect(unguardedCorpusReads(prose)).toEqual({ reads: 0, violations: [] });
  });

  it("a binding built from the door satisfies the guard", () => {
    const ok = "const where = { ...publicCorpusWhere(orgId), x: 1 };\nawait prisma.repository.count({ where });";
    expect(unguardedCorpusReads(ok)).toEqual({ reads: 1, violations: [] });
  });
});

// Scoped to the three sites that held a hand copy of the rule when the door was cut (the register,
// the fleet rollups, the benchmark filter). Other modules still declare their own MOCK_ENGINE
// (org-delivery-trend, maturity/attribution, org/playbookLiftModel); folding them in is follow-up work.
describe("one mock rule", () => {
  const sites = [
    ...walk("src/lib/register", /\.ts$/),
    "src/lib/db/scans-gallery.ts",
    "src/lib/db/org-rollup.ts",
    "src/lib/corpus/eligibility.ts",
  ];

  it("the mock engine literal is declared in exactly one of the register / rollup / benchmark modules", () => {
    const declaring = sites.filter((f) => /\bMOCK_ENGINE\s*=\s*["']mock["']/.test(strip(readFileSync(f, "utf8"), true)));
    expect(declaring).toEqual(["src/lib/corpus/eligibility.ts"]);
  });

  it("no register module compares an engine to the literal itself", () => {
    for (const f of [...walk("src/lib/register", /\.ts$/), "src/lib/db/scans-gallery.ts"]) {
      expect(strip(readFileSync(f, "utf8"), true)).not.toMatch(/engineProvider\s*[!=]==?\s*["']mock["']/);
    }
  });
});

describe("one set of qualifier chips", () => {
  it("the literal 'rubric unknown' appears in exactly one .tsx file (RegisterChips.tsx)", () => {
    const hits = walk("src", /\.tsx$/).filter((f) => readFileSync(f, "utf8").includes("rubric unknown"));
    expect(hits).toEqual(["src/components/landing/RegisterChips.tsx"]);
  });
});
