// Structural guard: an in-context customer-repo write resolves its token AND its write coordinate
// through requirePrWriteTarget, never by handing a bare string to requirePrWriteContext.
//
// Why a guard and not only route tests: requirePrWriteContext(org: string) mints an installation
// token for WHATEVER slug it is given. Nothing ties that string to the org the caller was gated on,
// so a route can pass the repo's parsed owner instead of the gated org and still type-check.
// /api/org/ai-stance/apply did exactly that (a cross-tenant draft PR, audited under the caller's
// org). The composer takes the gated org and the raw coordinate together, so it cannot express a
// different org. This file keeps the next PR-write route from reaching for the old door by hand.
//
// Like id-routes-gated.test.ts, it matches CODE: comments and string literals are stripped first,
// and a seeded fixture proves the matcher still bites (a matcher that stops matching reports a clean
// tree in a voice indistinguishable from success).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripCommentsAndStrings } from "@/app/api/org/id-routes-gated.test";

const API_DIR = join(process.cwd(), "src", "app", "api");

/**
 * The out-of-context routes still allowed to call requirePrWriteContext directly. Each one derives
 * the minted org from its own tenant gate, and none of them takes a caller-supplied owner that could
 * differ from the org it gated. This list may only SHRINK: migrating one of these routes to the
 * composer means deleting its line here, and the count below is pinned so a new entry is a
 * deliberate edit that a reviewer sees.
 */
const ALLOWED_DIRECT_MINT: Record<string, string> = {
  // resolvePlaybookOrg(id) reads the org FROM the playbook row and gates it; parseOrgRepo(raw, org)
  // then refuses any repo whose owner is not that org (400). The mint gets the same gated org.
  "org/playbooks/[id]/apply/route.ts": "gated org from the playbook row; parseOrgRepo pins owner === org",
  "org/playbooks/[id]/apply-batch/route.ts": "gated org from the playbook row; parseOrgRepo pins owner === org",
  // readableOrgForOwner(owner) returns the lower-cased OWNER itself (or PUBLIC_ORG, refused), and
  // requireOrgRole gates that value. The gated org, the minted org and the write owner are one string.
  "report/foundation/pr/route.ts": "org IS the repo owner (readableOrgForOwner), then requireOrgRole admin",
  "report/foundation/pr-batch/route.ts": "single-owner batch; org IS that owner, then requireOrgRole admin",
  "report/foundation/secrets/route.ts": "org IS the repo owner (readableOrgForOwner), then requireOrgRole owner",
  "report/passport/pr/route.ts": "org IS the repo owner (readableOrgForOwner), then requireOrgRole admin",
};
const PINNED_ALLOW_COUNT = 6;

/** The in-context PR-write routes that must go through the composer. */
const COMPOSER_ROUTES = [
  "practices/apply/route.ts",
  "practices/apply-batch/route.ts",
  "practices/rollout/route.ts",
  "org/ai-stance/apply/route.ts",
  "org/ai-stance/apply-batch/route.ts",
  "org/admission/propose/route.ts",
  "org/admission/ruleset/route.ts",
];

const DIRECT_MINT = /\brequirePrWriteContext\s*\(/;
const COMPOSER = /\brequirePrWriteTarget\s*\(/;

/** True when the source calls requirePrWriteContext in CODE (not in a comment or string). */
function mintsDirectly(src: string): boolean {
  return DIRECT_MINT.test(stripCommentsAndStrings(src));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(API_DIR, file).split(sep).join("/");

describe("customer-repo writes mint through the composer (structural guard)", () => {
  const files = sourceFiles(API_DIR);
  const direct = files.filter((f) => mintsDirectly(readFileSync(f, "utf8"))).map(rel).sort();

  it("the matcher flags a seeded code call and ignores the same text in prose", () => {
    expect(mintsDirectly("const ctx = await requirePrWriteContext(parsed.owner);")).toBe(true);
    expect(mintsDirectly("// const ctx = await requirePrWriteContext(parsed.owner);\nconst x = 1;")).toBe(false);
    expect(mintsDirectly("/* requirePrWriteContext(parsed.owner) */ const x = 1;")).toBe(false);
    expect(mintsDirectly('const s = "requirePrWriteContext(parsed.owner)";')).toBe(false);
  });

  it("only allow-listed routes call requirePrWriteContext directly", () => {
    expect(direct.filter((f) => !(f in ALLOWED_DIRECT_MINT))).toEqual([]);
  });

  it("the allow-list is pinned and every entry still earns its place", () => {
    expect(Object.keys(ALLOWED_DIRECT_MINT)).toHaveLength(PINNED_ALLOW_COUNT);
    // A migrated route must leave the list, so the list can only shrink toward zero.
    expect(Object.keys(ALLOWED_DIRECT_MINT).sort()).toEqual(direct);
  });

  it.each(COMPOSER_ROUTES)("%s writes through requirePrWriteTarget", (route) => {
    const src = stripCommentsAndStrings(readFileSync(join(API_DIR, ...route.split("/")), "utf8"));
    expect(COMPOSER.test(src), `${route} must resolve its token and coordinate via requirePrWriteTarget`).toBe(true);
    expect(DIRECT_MINT.test(src), `${route} must not mint a token by hand`).toBe(false);
  });
});
