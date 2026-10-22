// @vitest-environment node
// The dependency direction of the app-wide component folders: `src/components/{shared,ui,kit}` are
// importable by every feature and route, so they must never import back from `src/features/**`
// (that would make a feature reachable only through a cycle, and `shared` stop being shared).
// Comments are blanked before matching (a prose mention of "@/features/" is not an import), and a
// seeded violation pins that the matcher still bites.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/components/shared", "src/components/ui", "src/components/kit"];

/** Blank `//` and block comments, leaving string/template literals (import specifiers) intact. */
export function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Module specifiers that reach into `src/features` (alias or relative), in comment-free source. */
export function featureImports(src: string): string[] {
  const code = stripComments(src);
  const re = /(?:from|import|vi\.mock|vi\.importActual|require)\s*\(?\s*["']([^"']+)["']/g;
  const hits: string[] = [];
  for (const m of code.matchAll(re)) {
    if (/^@\/features(\/|$)/.test(m[1]) || /(^|\/)features\//.test(m[1]) && m[1].startsWith(".")) hits.push(m[1]);
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && name !== "shared-boundary.test.ts") out.push(p);
  }
  return out;
}

describe("shared / ui / kit never import from src/features", () => {
  it("the matcher bites a seeded violation and ignores prose", () => {
    expect(featureImports(`import { X } from "@/features/standing/overview/X";`)).toHaveLength(1);
    expect(featureImports(`vi.mock("@/features/admin/members/M", () => ({}));`)).toHaveLength(1);
    expect(featureImports(`import { Y } from "../../../features/shared/Y";`)).toHaveLength(1);
    expect(featureImports(`// import { X } from "@/features/a/b";\n/* from "@/features/c" */`)).toHaveLength(0);
  });

  for (const root of ROOTS) {
    it(`${root} has no @/features import`, () => {
      const offenders = walk(join(process.cwd(), root)).filter(
        (f) => featureImports(readFileSync(f, "utf8")).length > 0,
      );
      expect(offenders).toEqual([]);
    });
  }
});
