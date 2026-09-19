#!/usr/bin/env node
// KPI reader: the codebase-measured KPIs authored by the stewardship readings of 2026-09-07.
//
//   node scripts/kpi/codebase-kpi-readings.mjs [--root <checkout dir>] [--json]
//
// One entry per KPI, each `{ value, numerator, denominator, evidence }` so a reader can audit the
// cohort. `value: null` means "not measurable" (empty cohort), never 0. Read-only, no dependencies.
// Every definition is a pure file parse of the checkout at --root (default: cwd); the output carries
// the checkout's git revision and whether `src/` or `prisma/` was dirty when read.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const root = resolve(opt("--root", process.cwd()));
const json = args.includes("--json");

const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (dir, acc = []) => {
  const abs = join(root, dir);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, acc);
    else acc.push(rel.replaceAll("\\", "/"));
  }
  return acc;
};
const rate = (num, den) => (den <= 0 ? null : Number(((num / den) * 100).toFixed(1)));
const isTest = (p) => /\.(dom\.)?test\.tsx?$/.test(p);

// ── Database Client & Schema · Prisma-model/init.sql parity (%) ──────────────────────────────────
// Models in prisma/schema.prisma that have a `CREATE TABLE "<Model>"` in prisma/init.sql. The
// vitest guard (src/lib/db/init-sql.test.ts) fails the suite at <100 %; this is the same parse as a
// number, so the drift is visible between test runs and after a schema wave lands.
function schemaInitParity() {
  const schema = read("prisma/schema.prisma");
  const initSql = read("prisma/init.sql");
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  const tables = new Set([...initSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));
  const missing = models.filter((m) => !tables.has(m));
  const extra = [...tables].filter((t) => !models.includes(t));
  return {
    value: rate(models.length - missing.length, models.length),
    numerator: models.length - missing.length,
    denominator: models.length,
    evidence: { missingInInitSql: missing, tablesWithoutModel: extra },
  };
}

// ── Dev Inspector · dev seed routes accepting the secret as a query param (count, direction down) ─
// Routes under src/app/api/dev/**/route.ts whose gate reads the seed secret from the URL
// (`?secret=`), which leaks it into access/CDN/proxy logs and Referer headers. The operator route
// /api/kpi refuses a query-param channel for exactly this reason (see its header comment).
let sharedGateReadsQueryMemo;
function sharedGateReadsQuery() {
  if (sharedGateReadsQueryMemo === undefined) {
    const p = "src/lib/dev/seed-auth.ts";
    sharedGateReadsQueryMemo =
      existsSync(join(root, p)) && /searchParams\.get\(\s*["']secret["']\s*\)/.test(read(p));
  }
  return sharedGateReadsQueryMemo;
}
function devRoutesQuerySecret() {
  const routes = walk("src/app/api/dev").filter((p) => p.endsWith("/route.ts"));
  const offending = [];
  for (const r of routes) {
    const src = read(r);
    // The shared gate lives in src/lib/dev/seed-auth.ts; a route inherits the query channel by
    // calling it, or opens one itself with searchParams.get("secret").
    const usesSharedGate = /seedRequestAuthorized/.test(src);
    const ownQueryRead = /searchParams\.get\(\s*["']secret["']\s*\)/.test(src);
    if (ownQueryRead || (usesSharedGate && sharedGateReadsQuery())) offending.push(r);
  }
  return {
    value: offending.length,
    numerator: offending.length,
    denominator: routes.length,
    evidence: { routes: offending },
  };
}

// ── Design System: UI Primitives & Deck · barrel export adoption (%) ─────────────────────────────
// Value exports of src/components/ui/index.ts (the brand kit's public surface) that at least one
// file outside src/components/ui and src/components/deck imports by name from "@/components/ui".
// A primitive nobody imports is dead surface the catalog still advertises.
function uiBarrelAdoption() {
  const barrel = read("src/components/ui/index.ts");
  const names = [...barrel.matchAll(/^export\s+\{([^}]+)\}\s+from/gm)].flatMap((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/).pop())
      .filter(Boolean),
  );
  const consumers = walk("src").filter(
    (p) =>
      /\.tsx?$/.test(p) &&
      !isTest(p) &&
      !p.startsWith("src/components/ui/") &&
      !p.startsWith("src/components/deck/"),
  );
  const sources = consumers.map((p) => read(p));
  const importsName = (n) => {
    const re = new RegExp(
      `import\\s+(?:type\\s+)?\\{[^}]*\\b${n}\\b[^}]*\\}\\s+from\\s+["'][^"']*components/ui`,
    );
    return sources.some((s) => re.test(s));
  };
  const used = names.filter(importsName);
  const unused = names.filter((n) => !used.includes(n));
  return { value: rate(used.length, names.length), numerator: used.length, denominator: names.length, evidence: { unused } };
}

// ── Landing Page Prototypes · prototype surface (non-test files, direction down) ─────────────────
// Files under src/components/landing/prototypes that are not tests. A prototype gallery exists to
// graduate variants into the product or delete them; the number should fall, not grow.
function prototypeSurface() {
  const files = walk("src/components/landing/prototypes").filter((p) => /\.tsx?$/.test(p) && !isTest(p));
  return { value: files.length, numerator: files.length, denominator: null, evidence: { files } };
}

// ── Marketing About Page · reduced-motion coverage of framer-motion components (%) ───────────────
// Non-test files under src/components/about and src/components/about-org that import framer-motion;
// share that reference the reduced-motion gate (useReducedMotion, motionReveal, or MotionConfig
// reducedMotion). motionReveal.ts (the gate itself) is excluded from the cohort. Remotion
// compositions that do not import framer-motion are outside the cohort: RemotionStage gates them.
function aboutReducedMotion() {
  const files = [...walk("src/components/about"), ...walk("src/components/about-org")].filter(
    (p) => /\.tsx?$/.test(p) && !isTest(p) && !p.endsWith("motionReveal.ts"),
  );
  const animated = files.filter((p) => /from\s+["'](framer-motion|motion\/react)["']/.test(read(p)));
  const gated = animated.filter((p) => /useReducedMotion|motionReveal|reducedMotion=/.test(read(p)));
  const ungated = animated.filter((p) => !gated.includes(p));
  return {
    value: rate(gated.length, animated.length),
    numerator: gated.length,
    denominator: animated.length,
    evidence: { ungated },
  };
}

let rev = null;
let dirty = null;
try {
  rev = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  dirty = execSync("git status --porcelain -- src prisma", { cwd: root, encoding: "utf8" }).trim().length > 0;
} catch {
  /* not a git checkout */
}

const out = {
  measuredAt: new Date().toISOString(),
  root: relative(process.cwd(), root) || ".",
  rev,
  dirty,
  schemaInitSqlParity: schemaInitParity(),
  devRoutesAcceptingQuerySecret: devRoutesQuerySecret(),
  uiBarrelExportAdoption: uiBarrelAdoption(),
  landingPrototypeSurface: prototypeSurface(),
  aboutReducedMotionCoverage: aboutReducedMotion(),
};

if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`codebase KPI readings @ ${rev ?? "?"}${dirty ? " (dirty)" : ""}`);
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== "object" || v === null || !("value" in v)) continue;
    const frac = v.denominator === null ? "" : ` (${v.numerator}/${v.denominator})`;
    console.log(`  ${k}: ${v.value ?? "n/a"}${frac}  ${JSON.stringify(v.evidence)}`);
  }
}
