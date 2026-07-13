// Token-aware org authorization for the Skills Library API. This is the ONE seam that lets a machine
// (a dev's repo, the sync CLI, CI) reach the same endpoints a browser does: it accepts an
// `Authorization: Bearer askl_…` org token and, ONLY when no such token is present, falls back to the
// existing session gates (requireOrgRead / requireOrgAccess). So the tenant, plan, and RBAC rules the
// routes already enforce are reused verbatim — a token just supplies the identity a cookie normally would.
//
// Server-only (verifyOrgApiToken hits node:crypto + the DB). Import only from nodejs-runtime routes.

import { NextResponse } from "next/server";
import { verifyOrgApiToken, type SkillTokenScope } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";

/** Who authorized a request: a scoped token (machine) or the fell-through session (browser). */
export type OrgApiPrincipal =
  | { via: "token"; login: string; tokenId: string; scopes: SkillTokenScope[] }
  | { via: "session" };

export type OrgAuthResult = { principal: OrgApiPrincipal } | { denied: NextResponse };

/** Is this result a denial? Narrows the union at call sites: `if (isDenied(auth)) return auth.denied;` */
export function isDenied(r: OrgAuthResult): r is { denied: NextResponse } {
  return "denied" in r;
}

/** Pull a raw `askl_` bearer from the Authorization header, or null. A non-`askl_` Authorization value
 *  is ignored (not an error) so the request falls through to the ordinary session gate. */
function readSkillBearer(request: Request): string | null {
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token && token.startsWith("askl_") ? token : null;
}

/**
 * Authorize `org` for the given capability. With a valid, in-scope, org-matched token → a `token`
 * principal. With no token → defer to the session gate (`read` → requireOrgRead, `write` →
 * requireOrgAccess), preserving the login wall / membership / IDOR guarantees unchanged. A present-but-
 * bad token is a hard 401/403 (it does NOT silently fall back to the session — a caller who sent a
 * credential meant to use it).
 */
export async function authorizeOrgApi(
  request: Request,
  org: string,
  opts: { scope: SkillTokenScope; mode: "read" | "write" },
): Promise<OrgAuthResult> {
  const bearer = readSkillBearer(request);
  if (bearer) {
    const tok = await verifyOrgApiToken(bearer);
    if (!tok) return { denied: NextResponse.json({ error: "Invalid or revoked API token." }, { status: 401 }) };
    if (tok.orgSlug.trim().toLowerCase() !== org.trim().toLowerCase()) {
      return { denied: NextResponse.json({ error: "This token is not authorized for that organization." }, { status: 403 }) };
    }
    if (!tok.scopes.includes(opts.scope)) {
      return { denied: NextResponse.json({ error: `This token lacks the ${opts.scope} scope.` }, { status: 403 }) };
    }
    return { principal: { via: "token", login: `token:${tok.name}`, tokenId: tok.tokenId, scopes: tok.scopes } };
  }
  const denied = opts.mode === "read" ? await requireOrgRead(org) : await requireOrgAccess(org);
  if (denied) return { denied };
  return { principal: { via: "session" } };
}

/** The audit actor for a principal: the token's label for machine calls, else the session viewer login. */
export async function principalLogin(p: OrgApiPrincipal): Promise<string | null> {
  return p.via === "token" ? p.login : await resolveViewerLogin();
}
