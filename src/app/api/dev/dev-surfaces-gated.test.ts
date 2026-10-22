// STRUCTURAL GUARD - the Dev Inspector context's three dev surfaces each keep their one gate.
//
//   1. DEV_INSPECT is read in exactly one place: scripts/dev-inspector/dev-inspect-flag.cjs, whose
//      devInspectEnabled() checks the production floor before the variable. Any other raw read is a
//      second spelling of the flag with no floor (next.config.ts and the loader each had one).
//   2. Every exported HTTP handler under src/app/api/dev/**/route.ts calls seedRequestAuthorized as
//      its first statement. The route set comes from the filesystem, so the next seeder is covered
//      without anyone updating a hand-list (context-map.json's list already drifted once).
//   3. The DevInspector overlay is imported outside its folder only by src/app/layout.tsx, and its
//      mount sits behind `process.env.NODE_ENV === "development"`.
//
// Every matcher reads CODE, not prose: comments are stripped first (a route that only DESCRIBES its
// gate in a comment must fail), and each guard seeds a violation to prove it still bites.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsAndStrings } from "@/app/api/org/id-routes-gated.test";
import { stripComments } from "@/lib/org/tab-link-graph";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

// ── 1. one DEV_INSPECT definition ──────────────────────────────────────────────────────────────
const FLAG_DEFINITION = "scripts/dev-inspector/dev-inspect-flag.cjs";
const readsDevInspect = (src: string) => /\bDEV_INSPECT\b/.test(stripCommentsAndStrings(src));
const CODE_FILE = /\.(c|m)?[jt]sx?$/;
const isTestFile = (p: string) => /\.test\.[jt]sx?$/.test(p);

describe("DEV_INSPECT has one definition", () => {
  it("detects a raw read in code and ignores a prose or string mention", () => {
    expect(readsDevInspect('if (process.env.DEV_INSPECT === "1") register();')).toBe(true);
    expect(readsDevInspect("const on = process.env['X'] || env.DEV_INSPECT;")).toBe(true);
    expect(readsDevInspect("// launched with DEV_INSPECT=1 by dev:inspect\nconst a = 1;")).toBe(false);
    expect(readsDevInspect("/* DEV_INSPECT=1 */ const msg = \"DEV_INSPECT=1\";")).toBe(false);
  });

  it("is read nowhere outside dev-inspect-flag.cjs", () => {
    const files = [
      join(ROOT, "next.config.ts"),
      ...walk(join(ROOT, "scripts", "dev-inspector"), (p) => CODE_FILE.test(p)),
      ...walk(join(ROOT, "src"), (p) => CODE_FILE.test(p) && !isTestFile(p)),
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((f) => rel(f) !== FLAG_DEFINITION)
      .filter((f) => readsDevInspect(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
    expect(readsDevInspect(readFileSync(join(ROOT, FLAG_DEFINITION), "utf8"))).toBe(true);
  });
});

// ── 2. every /api/dev handler gates first ──────────────────────────────────────────────────────
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\([^)]*\)[^{]*\{/g;

/** Handlers whose first statement is not an `if (!seedRequestAuthorized(...))` gate. */
function ungatedHandlers(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const bad: string[] = [];
  let m: RegExpExecArray | null;
  HANDLER.lastIndex = 0;
  let found = 0;
  while ((m = HANDLER.exec(code))) {
    found++;
    const body = code.slice(m.index + m[0].length).trimStart();
    if (!/^if\s*\(\s*!\s*seedRequestAuthorized\s*\(/.test(body)) bad.push(m[1]!);
  }
  if (found === 0) bad.push("(no handler found)");
  return bad;
}

describe("every /api/dev route gates with seedRequestAuthorized first", () => {
  it("rejects a gate that follows a prisma call, and a gate only named in a comment", () => {
    const gated = "export async function POST(req: NextRequest) {\n  if (!seedRequestAuthorized(req)) return deny();\n  await getPrisma().x();\n}";
    const late = "export async function POST(req: NextRequest) {\n  const org = await getPrisma().organization.findUnique({});\n  if (!seedRequestAuthorized(req)) return deny();\n}";
    const prose = "export async function POST(req: NextRequest) {\n  // if (!seedRequestAuthorized(req)) is the gate\n  await getPrisma().x();\n}";
    expect(ungatedHandlers(gated)).toEqual([]);
    expect(ungatedHandlers(late)).toEqual(["POST"]);
    expect(ungatedHandlers(prose)).toEqual(["POST"]);
  });

  const routes = walk(join(ROOT, "src", "app", "api", "dev"), (p) => /[\\/]route\.ts$/.test(p));

  it("finds the dev routes on disk", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(routes.map((r) => [rel(r), r]))("%s", (_name, file) => {
    expect(ungatedHandlers(readFileSync(file, "utf8"))).toEqual([]);
  });
});

// ── 3. the overlay mounts only in development ──────────────────────────────────────────────────
const IMPORTS_INSPECTOR = /from\s+["'][^"']*_dev-inspector\/DevInspector["']/;
const DEV_MOUNT = /process\.env\.NODE_ENV\s*===\s*["']development["']\s*&&\s*<DevInspector\s*\/>/;
/** Every `<DevInspector` JSX element must be the operand of the development check. */
const mountsOnlyInDev = (src: string) => {
  const code = stripComments(src);
  const all = code.match(/<DevInspector\b/g)?.length ?? 0;
  const guarded = code.match(new RegExp(DEV_MOUNT.source, "g"))?.length ?? 0;
  return all > 0 && all === guarded;
};

describe("DevInspector mounts only behind the development check", () => {
  it("rejects an unguarded mount and a guard that lives only in a comment", () => {
    expect(mountsOnlyInDev('{process.env.NODE_ENV === "development" && <DevInspector />}')).toBe(true);
    expect(mountsOnlyInDev("<body><DevInspector /></body>")).toBe(false);
    expect(mountsOnlyInDev('// process.env.NODE_ENV === "development" && <DevInspector />\n<DevInspector />')).toBe(false);
  });

  it("is imported outside its folder only by src/app/layout.tsx", () => {
    const importers = walk(join(ROOT, "src"), (p) => /\.[jt]sx?$/.test(p) && !isTestFile(p))
      .filter((f) => !rel(f).startsWith("src/app/_dev-inspector/"))
      .filter((f) => IMPORTS_INSPECTOR.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(importers).toEqual(["src/app/layout.tsx"]);
  });

  it("is mounted in src/app/layout.tsx only behind NODE_ENV === development", () => {
    expect(mountsOnlyInDev(readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf8"))).toBe(true);
  });
});
