// Audit-trail tamper-evidence — makes the recurring compliance record examiner-grade (the fintech
// Character's blocker: "a plain mutable table, no hash/chain/signature"). Two migration-free layers:
//
//  1. Per-row HMAC signature, folded into the EXISTING AuditLog.meta JSON as `_sig`. Signing over the
//     row's own content (action/org/actor/createdAt/meta) means a row can't be altered at rest without
//     invalidating its signature — and the secret never leaves the server. No new column, no chain (so
//     no concurrent-writer fork), verifiable independently per row.
//  2. A SHA-256 checksum the CSV exporters append, so the FILED artifact is self-verifying: an examiner
//     recomputes it over the rows and proves the download wasn't edited after the fact.
//
// Inert without a signing secret (mirrors lib/briefing-share.ts) — degrades to today's behaviour rather
// than failing a write.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Signing secret: a dedicated AUDIT_SIGNING_SECRET, else the shared AUTH_SECRET. Null = signing off. */
function auditSecret(): string | null {
  return (process.env.AUDIT_SIGNING_SECRET || process.env.AUTH_SECRET || "").trim() || null;
}

export interface AuditFields {
  action: string;
  orgId: string | null;
  actorId: string | null;
  /** ISO timestamp stamped on the row (set explicitly so the signed value matches what's stored). */
  createdAt: string;
  /** The caller meta, WITHOUT any `_sig` field. */
  meta: Record<string, unknown>;
}

/** Recursively sort object keys so two equal objects serialize identically regardless of build order. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    return Object.keys(src)
      .sort()
      .reduce<Record<string, unknown>>((o, k) => {
        o[k] = sortKeys(src[k]);
        return o;
      }, {});
  }
  return v;
}

/** Canonical, order-stable serialization of the tamper-sensitive fields. */
function canonical(f: AuditFields): string {
  return JSON.stringify({
    action: f.action,
    orgId: f.orgId,
    actorId: f.actorId,
    createdAt: f.createdAt,
    meta: sortKeys(f.meta),
  });
}

/** HMAC-SHA256 (base64url) signature of an audit row, or null when no signing secret is configured. */
export function signAudit(f: AuditFields): string | null {
  const secret = auditSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(canonical(f)).digest("base64url");
}

/**
 * The caller meta with an `_sig` HMAC folded in when signing is configured; the meta unchanged
 * otherwise. This is what gets JSON.stringify'd into AuditLog.meta — migration-free tamper-evidence.
 */
export function withAuditSignature(f: AuditFields): Record<string, unknown> {
  const sig = signAudit(f);
  return sig ? { ...f.meta, _sig: sig } : f.meta;
}

export type AuditVerdict = "ok" | "tampered" | "unsigned" | "no-secret";

/** Verify a stored audit row: recompute the HMAC over its content (meta minus `_sig`) and compare. */
export function verifyAudit(f: AuditFields): AuditVerdict {
  if (!auditSecret()) return "no-secret";
  const stored = typeof f.meta._sig === "string" ? (f.meta._sig as string) : null;
  if (!stored) return "unsigned";
  const rest = { ...f.meta };
  delete rest._sig;
  const expected = signAudit({ ...f, meta: rest });
  if (!expected) return "no-secret";
  const a = Buffer.from(expected);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "tampered";
}

/**
 * SHA-256 (hex) of an export's content — sent in the `x-ascent-content-sha256` response header so a
 * downloaded compliance file can be proven unaltered (recompute over the bytes, compare). A header
 * keeps the CSV itself pure data; per-row HMAC `_sig`s give the rows their own at-rest tamper-evidence.
 */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
