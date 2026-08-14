// Org-scoped API tokens (Feature 2 sync) — the keystone that lets a dev's repo / CLI / CI reach the
// Skills Library without a browser session. A token is minted ONCE as a raw `askl_<random>` string; we
// persist only its SHA-256 hash + a display prefix (mirror Invite.token's capability model — the raw
// value is shown once and never re-broadcast). Verification hashes the inbound bearer, looks it up, and
// recovers the owning org slug + scopes. No-op-safe without a DB, like the rest of the db layer.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

const TOKEN_PREFIX = "askl_";

/** Capabilities a token may carry. Reads are open to any member anyway, but a token is a long-lived
 *  bearer credential, so it is scoped down to exactly what the holder needs. `memory:read` is the
 *  control-plane door the recall route's own header always promised — an agent pulling the org's
 *  budget-packed memory into its context without a cookie session. */
export const SKILL_TOKEN_SCOPES = ["skills:read", "skills:write", "telemetry:write", "memory:read"] as const;
export type SkillTokenScope = (typeof SKILL_TOKEN_SCOPES)[number];

export function isSkillTokenScope(v: string): v is SkillTokenScope {
  return (SKILL_TOKEN_SCOPES as readonly string[]).includes(v);
}

/** A token as shown in the management UI — never includes the raw value or its hash. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: SkillTokenScope[];
  createdBy: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** The resolved principal behind a verified bearer token. */
export interface VerifiedApiToken {
  tokenId: string;
  orgSlug: string;
  name: string;
  scopes: SkillTokenScope[];
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

function parseScopes(raw: string): SkillTokenScope[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(isSkillTokenScope);
}

function cleanScopes(scopes: string[] | undefined): SkillTokenScope[] {
  const valid = (scopes ?? []).filter(isSkillTokenScope);
  // Never mint an empty-scope token (it would authorize nothing yet still exist) — default to read.
  return valid.length ? Array.from(new Set(valid)) : ["skills:read"];
}

/**
 * Mint a token for an org. Returns the RAW token (shown once) plus its summary row, or null (DB-less /
 * unknown org). The raw value exists only in this return — after this it lives solely as a hash.
 */
export async function createOrgApiToken(
  orgSlug: string,
  input: { name: string; scopes?: string[]; createdBy?: string | null },
): Promise<{ token: string; summary: ApiTokenSummary } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const scopes = cleanScopes(input.scopes);
  const row = await prisma.orgApiToken.create({
    data: {
      orgId,
      name: input.name.trim().slice(0, 80) || "token",
      tokenHash: sha256Hex(token),
      tokenPrefix: token.slice(0, 12), // "askl_" + 7 random chars — enough to recognize, not to use
      scopes: scopes.join(","),
      createdBy: input.createdBy ?? null,
    },
  });
  return { token, summary: toSummary(row) };
}

function toSummary(r: {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string;
  createdBy: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiTokenSummary {
  return {
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    scopes: parseScopes(r.scopes),
    createdBy: r.createdBy,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Active (non-revoked) tokens for an org — the management list. Raw values / hashes never included. */
export async function listOrgApiTokens(orgSlug: string): Promise<ApiTokenSummary[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().orgApiToken.findMany({
    where: { orgId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSummary);
}

/** Soft-revoke a token (scoped to its org, so one org can't revoke another's). Idempotent. */
export async function revokeOrgApiToken(orgSlug: string, tokenId: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const res = await getPrisma().orgApiToken.updateMany({
    where: { id: tokenId, orgId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

/**
 * Verify an inbound raw bearer token: hash it, look up a non-revoked row, and recover the owning org
 * slug + scopes. Returns null for any miss (unknown / revoked / malformed). Bumps `lastUsedAt`
 * fire-and-forget so a stale write can never fail the request. The hash lookup is already
 * constant-work; the timing-safe compare guards the (already unique) hash equality defensively.
 */
export async function verifyOrgApiToken(rawToken: string): Promise<VerifiedApiToken | null> {
  if (!isDbConfigured()) return null;
  const token = rawToken.trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = sha256Hex(token);
  const row = await getPrisma()
    .orgApiToken.findFirst({
      where: { tokenHash: hash, revokedAt: null },
      select: { id: true, name: true, scopes: true, tokenHash: true, org: { select: { slug: true } } },
    })
    .catch(() => null);
  if (!row) return null;
  // Defensive constant-time equality (the WHERE already matched on the unique hash).
  try {
    if (!timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) return null;
  } catch {
    return null;
  }
  void getPrisma()
    .orgApiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { tokenId: row.id, orgSlug: row.org.slug, name: row.name, scopes: parseScopes(row.scopes) };
}
