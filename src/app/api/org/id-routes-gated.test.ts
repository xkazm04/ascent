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
// ── It matches CODE, not prose (2026-09-04) ──────────────────────────────────────────────────────
//
// Every route under this guard explains, in a comment, which gate it calls and why — that is the
// house style, and it is what made a raw-text `src.includes(gate)` a guard that could not fail.
// Measured: deleting the import AND both `requireOrgAccess` / `requireOrgRole` call sites from
// `goals/[id]/route.ts`, leaving only the three comment lines that NAME them, kept this suite at
// 21/21 green. A route with no authorization at all read as compliant, in a voice indistinguishable
// from success.
//
// So the source is stripped of comments and string literals before any gate name is looked for. A
// route now has to CALL the gate, not describe it — and `finds a gate only in real code` below seeds
// exactly that violation so this can never silently stop biting again.
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

/**
 * Strip block comments, line comments and string/template literals so a gate name that appears only
 * in PROSE (or in an unrelated string) cannot satisfy the check. Order matters: the scanner walks the
 * source once, character by character, tracking which of the five states it is in, because a naive
 * regex pass would treat `"// not a comment"` as a comment and `// a "quote"` as a string opener.
 *
 * Deliberately crude in one direction and safe in that direction: a regex LITERAL (`/[id]/`) is left
 * as code, so at worst a gate name inside one would still count — a case that does not occur and
 * would, unlike prose, be genuinely executable text.
 */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++; // skip the escaped character
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

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

  // THE GUARD'S OWN FAIL-BEFORE. A source-scanning check that stops matching reports a clean codebase
  // in a voice indistinguishable from success, so the stripper is exercised against a route that only
  // TALKS about its gate — the exact shape that passed for as long as this guard read raw text.
  it("finds a gate only in real code, never in the prose that explains it", () => {
    const gated = [
      'import { requireOrgRole } from "@/lib/authz";',
      "const blocked = await requireOrgRole(org, \"admin\");",
    ].join("\n");
    const described = [
      "// This route is gated: the DELETE demands admin (requireOrgRole(org, \"admin\")).",
      "/* resolve-then-gate, see requireOrgAccess in @/lib/authz */",
      'const label = "requireOrgRead";',
      "const blocked = null;",
    ].join("\n");

    expect(GATES.some((g) => stripCommentsAndStrings(gated).includes(g))).toBe(true);
    expect(GATES.some((g) => stripCommentsAndStrings(described).includes(g))).toBe(false);
    // …and the raw text the guard used to read cannot tell the two apart.
    expect(GATES.some((g) => described.includes(g))).toBe(true);
  });

  it.each(files.map((f) => [f.slice(f.indexOf(join("src", "app"))), f] as const))(
    "%s calls an org gate",
    (_label, file) => {
      const src = stripCommentsAndStrings(readFileSync(file, "utf8"));
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

// ── The same class, a different key (moonshot #8) ────────────────────────────────────────────────
//
// `RepoAdmission` is addressed by (org, repoFullName) rather than by a row id, so none of its routes
// live under an `[id]` segment and the walker above never sees them. The IDOR shape is IDENTICAL
// though: the caller supplies a repo name, the row is a governance decision, and gating the org is
// only half the job — a caller could present their own org and name `othertenant/repo`.
//
// So these routes must do BOTH: gate the org (mechanism b's first half) and constrain the
// caller-supplied name to that org. `repoUnderOrg` is the constraint, and it is asserted here rather
// than left to review because "gated but not constrained" is precisely the gap the header above says
// a text scan cannot see — except when the constraint has a NAME, which is why it has one.
const ADMISSION_DIR = join(ORG_API_DIR, "admission");

function admissionRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) admissionRouteFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("org admission routes are gated AND repo-constrained (structural guard)", () => {
  const files = admissionRouteFiles(ADMISSION_DIR);

  it("finds the admission routes it is meant to police", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it.each(files.map((f) => [f.slice(f.indexOf(join("src", "app"))), f] as const))(
    "%s gates the org and constrains the caller-supplied repo to it",
    (_label, file) => {
      const raw = readFileSync(file, "utf8");
      const src = stripCommentsAndStrings(raw);
      expect(GATES.filter((g) => src.includes(g)), "No org gate found on an admission route.").not.toHaveLength(0);
      // A GET listing is org-scoped by its query and names no repo; only a route that reads a repo
      // from the caller has something to constrain.
      //
      // This probe reads the RAW source on purpose: `searchParams.get("repo")` is identified BY its
      // string literal, which the stripper removes. Over-detecting here is the safe direction (it can
      // only demand a constraint on a route that merely mentions a repo), where a stripped probe would
      // silently stop asking for one — so the two reads are deliberately different sources.
      if (/body\.repo|searchParams\.get\("repo"\)/.test(raw)) {
        expect(
          src.includes("repoUnderOrg"),
          `This route takes a repo name from the caller but does not pass it through repoUnderOrg. ` +
            `Gating the org is only half of gate-then-constrain: a caller may present their own org ` +
            `and name another tenant's repository.`,
        ).toBe(true);
      }
    },
  );
});
