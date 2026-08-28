// STRUCTURAL GUARD — every org route that takes a row id from the URL must authorize the caller.
//
// ── The pattern this protects ────────────────────────────────────────────────────────────────────
//
// An `[id]` route is where cross-tenant IDOR lives. The id names a row; the caller supplies it; and
// unless the AUTHORIZED org constrains the lookup, org A can read or mutate org B's row by guessing
// or leaking an id. The in-code comments across these routes cite specific prior bugs of exactly this
// shape, so this is a repaired class, not a hypothetical one.
//
// Two mechanisms are in use here and BOTH are correct — the guard deliberately accepts either:
//
//   (a) RESOLVE-THEN-GATE — derive the owning org from the row, then gate THAT org.
//       `getGoalOrgSlug(id)` → `requireOrgRole(org, …)`  (src/app/api/org/goals/[id]/route.ts)
//       The route never trusts a caller-supplied org alongside a caller-supplied id.
//
//   (b) GATE-THEN-CONSTRAIN — gate the caller-supplied org, then pass it INTO the query beside the
//       id, so a mismatched row simply is not found.
//       `requireOrgAccess(body.org)` → `setRepoSegment(body.org, id, …)` → 404
//       (src/app/api/org/segments/[id]/repos/route.ts, src/app/api/org/tokens/[id]/route.ts)
//
// src/app/api/org/loop/[id]/route.ts states the underlying rule outright: an id-only route "would
// authorize nothing at all, or would have to trust the row it is about to disclose."
//
// ── What this guard can and cannot see ───────────────────────────────────────────────────────────
//
// It asserts the GATE IS PRESENT. It cannot verify that the id is actually org-constrained — that is
// a data-flow property, and a text scan claiming to check it would be worse than no check, because it
// would read as a guarantee it does not provide.
//
// So: this catches the regression that actually happens — a new `[id]` route shipped with no gate at
// all — and it does not catch a gated route that then queries by bare id. Reviewing THAT remains a
// human job, and the two mechanisms above are the shapes to look for.
//
// Architect ADR 2026-08-28-codify-id-route-gating.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ORG_API_DIR = join(process.cwd(), "src", "app", "api", "org");

/** Any call that ends in an authorization decision for an org, including the thin per-resource
 *  wrappers that delegate to `@/lib/authz` (playbook-gate, registry/api, athena/gate, orgPost). */
const GATES = [
  "requireOrgAccess",
  "requireOrgRole",
  "requireOrgRead",
  "requireOrgOwnerPost",
  "authorizeOrgApi",
  "resolvePlaybookOrg",
  "guardRegistryRead",
  "guardRegistryWrite",
  "gateAthenaOrg",
];

/** Every `route.ts` beneath a `[id]` path segment under src/app/api/org. */
function idRouteFiles(dir: string, underId = false, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      idRouteFiles(full, underId || entry === "[id]", out);
    } else if (underId && entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("org [id] routes are authorized (structural guard)", () => {
  const files = idRouteFiles(ORG_API_DIR);

  // If this drops to zero the walker broke — and a guard that silently checks nothing is worse than
  // no guard, because the suite still goes green.
  it("finds the [id] routes it is meant to police", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  it.each(files.map((f) => [f.slice(f.indexOf(join("src", "app"))), f] as const))(
    "%s calls an org gate",
    (_label, file) => {
      const src = readFileSync(file, "utf8");
      const found = GATES.filter((g) => src.includes(g));
      expect(
        found,
        `No org gate found. An [id] route must authorize the caller against the row's org — either ` +
          `resolve-then-gate or gate-then-constrain (see this file's header). If this route is ` +
          `deliberately public, say so here rather than leaving the absence unexplained.`,
      ).not.toHaveLength(0);
    },
  );
});
