// STRUCTURAL GUARD - no owner/admin API route admits the shared public org (members-0, 2026-10-22).
//
// The ADR of 2026-10-07 (docs/adr/2026-10-07-shared-public-org-has-no-owner.md) decided nobody
// administers "public", and kept requireOrgRole open on it because hasOrgRole READ callers go through
// the same gate. The refusal was therefore per-route, and the rule was re-broken at every new owner
// route nobody remembered: the scan found 7 open routes, the follow-up 14, and this card 8 more.
//
// The rule, checked here over every tracked src/app/api/**/route.ts: a route whose code calls
// requireOrgRole(x, "owner" | "admin"), requireOrgRole with a non-literal min, or requireOrgOwnerPost
// must also refuse the public org IN CODE, by one of
//   - requireOrgAdmin(...)        the one door (authz.ts): refusePublicOrgAdmin ?? requireOrgRole
//   - refusePublicOrgAdmin(...)   the helper itself
//   - an explicit `=== PUBLIC_ORG` / `!== PUBLIC_ORG` comparison (local/*, loop/*, report/* answer
//     403/404/400 on the public org that way, before their gate)
// or sit in ALLOWLIST with a reason. requireOrgOwnerPost counts as refused when the shared preamble
// (src/lib/api/orgPost.ts) itself refuses in code.
//
// It matches CODE, not prose. Comments are stripped before matching; string literals are KEPT for the
// gate match (the min role IS a string, and id-routes-gated's stripCommentsAndStrings would erase it)
// and stripped for the refusal match (a refusal named only inside a string is not a refusal). The
// seeded fixtures below prove both halves still bite.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Routes that call an owner/admin gate with no in-file refusal, each with the reason it is safe. */
const ALLOWLIST: Record<string, string> = {
  "src/app/api/athena/proposals/[id]/resolve/route.ts":
    "gateAthenaOrg (src/app/api/athena/gate.ts) answers PUBLIC_ORG before the spec-driven requireOrgRole runs",
  "src/app/api/org/briefing/share/route.ts":
    "only the GET (the grant inventory, a read) calls requireOrgRole(owner) directly; POST goes through requireOrgOwnerPost, so no link can be minted or revoked on public",
};

const ORG_POST = "src/lib/api/orgPost.ts";

/** Remove line and block comments; keep string and template literals verbatim unless `dropStrings`. */
export function stripComments(src: string, dropStrings = false): string {
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
      const start = i;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      if (!dropStrings) out += src.slice(start, i);
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The top-level argument texts of the call whose "(" sits at `open`. */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      cur += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (depth === 0) break;
    if (i === open) continue;
    if (depth === 1 && c === ",") {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  args.push(cur.trim());
  return args;
}

/** True when the comment-stripped code calls an owner/admin role gate (requireOrgOwnerPost aside). */
export function callsAdminRoleGate(code: string): boolean {
  for (const m of code.matchAll(/\brequireOrgRole\s*\(/g)) {
    const min = callArgs(code, m.index! + m[0].length - 1)[1] ?? "";
    if (!/^(["'`])(member|viewer)\1$/.test(min)) return true;
  }
  return false;
}

/** True when the code (comments AND strings stripped) refuses the public org itself. */
export function refusesPublic(bare: string): boolean {
  return /\b(requireOrgAdmin|refusePublicOrgAdmin)\s*\(/.test(bare) || /[!=]==\s*PUBLIC_ORG\b|\bPUBLIC_ORG\s*[!=]==/.test(bare);
}

/** Why a route source violates the rule, or null when it complies (allowlist not consulted). */
export function violation(src: string, orgPostRefuses: boolean): string | null {
  const code = stripComments(src);
  const refused = refusesPublic(stripComments(src, true));
  if (callsAdminRoleGate(code) && !refused) return "owner/admin requireOrgRole without a public refusal";
  if (/\brequireOrgOwnerPost\s*\(/.test(code) && !refused && !orgPostRefuses) return "requireOrgOwnerPost, which admits public";
  return null;
}

const tracked = execFileSync("git", ["ls-files", "src/app/api"], { cwd: process.cwd(), encoding: "utf8" })
  .split(/\r?\n/)
  .filter((p) => p.endsWith("/route.ts"));
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const orgPostRefuses = refusesPublic(stripComments(read(ORG_POST), true));
const gated = tracked.filter((p) => {
  const code = stripComments(read(p));
  return callsAdminRoleGate(code) || /\brequireOrgOwnerPost\s*\(/.test(code);
});

describe("owner/admin API routes refuse the shared public org (structural guard)", () => {
  // A walker that finds nothing reports a clean tree in a voice indistinguishable from success.
  it("finds the owner/admin routes it is meant to police", () => {
    expect(gated.length).toBeGreaterThanOrEqual(40);
  });

  it("the shared requireOrgOwnerPost preamble refuses public in code", () => {
    expect(orgPostRefuses).toBe(true);
  });

  it("every owner/admin route refuses public, or is allowlisted with a reason", () => {
    const open = gated
      .filter((p) => !(p in ALLOWLIST))
      .map((p) => [p, violation(read(p), orgPostRefuses)] as const)
      .filter(([, why]) => why !== null)
      .map(([p, why]) => `${p}: ${why}`);
    expect(open).toEqual([]);
  });

  it("every ALLOWLIST entry is tracked, still calls an owner/admin gate, and would fail without the entry", () => {
    for (const [p, reason] of Object.entries(ALLOWLIST)) {
      expect(tracked, p).toContain(p);
      expect(gated, p).toContain(p);
      expect(violation(read(p), orgPostRefuses), p).not.toBeNull();
      expect(reason.length, p).toBeGreaterThan(20);
    }
  });
});

describe("the guard bites (seeded fixtures)", () => {
  const head = 'import { requireOrgRole } from "@/lib/authz";\n';

  it("a refusal named only in a comment beside an owner gate is a violation", () => {
    const src = `${head}// refusePublicOrgAdmin(org) is called upstream\nconst d = await requireOrgRole(org, "owner"); /* requireOrgAdmin( */\n`;
    expect(violation(src, true)).not.toBeNull();
  });

  it("keeps the min-role string: an owner gate is seen, a member gate is not", () => {
    expect(callsAdminRoleGate(stripComments('await requireOrgRole(org, "owner");'))).toBe(true);
    expect(callsAdminRoleGate(stripComments('await requireOrgRole(org, "admin");'))).toBe(true);
    expect(callsAdminRoleGate(stripComments("await requireOrgRole(org, spec?.role ?? \"owner\");"))).toBe(true);
    expect(callsAdminRoleGate(stripComments('await requireOrgRole(f(a, b), "member");'))).toBe(false);
  });

  it("a refusal named only inside a string literal does not count", () => {
    const src = `${head}const msg = "call refusePublicOrgAdmin( first, or org === PUBLIC_ORG";\nawait requireOrgRole(org, "admin");\n`;
    expect(violation(src, true)).not.toBeNull();
  });

  it("a route with neither the door nor a PUBLIC_ORG comparison fails; either one passes", () => {
    expect(violation(`${head}await requireOrgRole(org, "owner");\n`, true)).not.toBeNull();
    expect(violation(`${head}if (org === PUBLIC_ORG) return no();\nawait requireOrgRole(org, "owner");\n`, true)).toBeNull();
    expect(violation(`${head}await requireOrgAdmin(org, "owner");\n`, true)).toBeNull();
  });

  it("requireOrgOwnerPost is open exactly when the shared preamble does not refuse", () => {
    const src = "const gate = await requireOrgOwnerPost(request);\n";
    expect(violation(src, false)).not.toBeNull();
    expect(violation(src, true)).toBeNull();
  });
});
