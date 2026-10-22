// Source guard: a rate-limit refusal is counted in ONE place, the charge pipeline. Three routes used to
// place `recordQuotaEvent("rate_limit", ...)` by hand, which mislabelled the peek limiter, counted a
// store outage as abuse, and left six doors uncounted. A hand-placed count next to a limiter call now
// double-counts, so it is banned outside src/lib/rate-limit-charge.ts.
//
// Comments are stripped before matching (a line explaining the old call must not trip the guard, and a
// commented-out call must not satisfy it), and a seeded violation proves the matcher still bites.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(process.cwd(), "src");
const OWNER = ["lib", "rate-limit-charge.ts"].join(sep);

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const HAND_PLACED = /recordQuotaEvent\(\s*["'`]rate_limit["'`]/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("rate-limit refusals are counted only by the charge pipeline", () => {
  it("no source file outside rate-limit-charge.ts records a 'rate_limit' event", () => {
    const offenders = sources(SRC)
      .filter((p) => relative(SRC, p) !== OWNER)
      .filter((p) => HAND_PLACED.test(stripComments(readFileSync(p, "utf8"))));
    expect(offenders.map((p) => relative(SRC, p))).toEqual([]);
  });

  it("the pipeline itself is the one place that does", () => {
    expect(HAND_PLACED.test(stripComments(readFileSync(join(SRC, OWNER), "utf8")))).toBe(true);
  });

  it("bites on a seeded violation and ignores the same text in a comment", () => {
    const seeded = `if (!rl.ok) {\n  void recordQuotaEvent("rate_limit", "scan").catch(() => {});\n}`;
    expect(HAND_PLACED.test(stripComments(seeded))).toBe(true);
    const prose = `// used to call recordQuotaEvent("rate_limit", "scan") here\n/* recordQuotaEvent('rate_limit', 'x') */`;
    expect(HAND_PLACED.test(stripComments(prose))).toBe(false);
  });
});
