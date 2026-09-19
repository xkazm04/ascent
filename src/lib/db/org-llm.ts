// Per-org connected LLM (BYOM — Feature 1) db layer. The org's Amazon Bedrock credentials are the first
// customer secret Ascent persists, so the discipline here is strict:
//   - the secret is stored ONLY in `credentialsEncrypted` (AES-256-GCM via secret-box), never plain;
//   - getOrgLlmConfig returns metadata + `hasCredentials` (presence) — NEVER the secret, NEVER decrypts;
//   - readStoredByomSecret (private) is the ONLY decrypt call site; resolveByomProvider (provider
//     factory, gated on isByomActive) and getStoredByomSecret / getStoredByomCredentials (the
//     test-connection route, ungated so save → test → enable works) are its only readers — adding a
//     BYOM provider widens the credential SHAPE, never the number of places that decrypt;
//   - everything is gated on planAllowsByom (Enterprise) AND isEncryptionConfigured() — fail closed.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { getCreditState } from "@/lib/db/credits";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { planAllowsByom } from "@/lib/plans";

/** Public, secret-free view of an org's BYOM config (what the GET endpoint may return). */
export interface OrgLlmConfigPublic {
  provider: string;
  enabled: boolean;
  modelId: string;
  region: string | null;
  authMode: string;
  /** Whether a credential is stored — presence only, NEVER the secret. */
  hasCredentials: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export interface OrgLlmConfigInput {
  provider?: string;
  modelId: string;
  region?: string | null;
  authMode?: string;
  enabled?: boolean;
  /** Static AWS creds for Bedrock (plaintext in; encrypted before storage). Omit both to KEEP existing. */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** OpenRouter API key (plaintext in; encrypted before storage). Omit to KEEP the existing key. Unlike
   *  Bedrock, OpenRouter routes to third-party upstreams — a cost/flexibility path, NOT the in-boundary
   *  privacy guarantee. */
  apiKey?: string;
}

/** Decrypted static credentials — produced ONLY by resolveByomProvider, consumed ONLY by the provider
 *  factory + the test endpoint. Never serialized to a response or a log. */
export interface ByomStaticCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Resolved BYOM provider params — a discriminated union so the factory builds the right provider.
 *  `bedrock` carries decrypted AWS creds + region (in-boundary); `openrouter` carries a decrypted API
 *  key (routes to third-party upstreams). Produced ONLY by resolveByomProvider; never serialized. */
export type ByomProviderParams =
  | { kind: "bedrock"; model: string; region?: string; credentials: ByomStaticCredentials }
  | { kind: "openrouter"; model: string; apiKey: string };

function toPublic(c: {
  provider: string;
  enabled: boolean;
  modelId: string;
  region: string | null;
  authMode: string;
  credentialsEncrypted: string | null;
  lastValidatedAt: Date | null;
  lastValidationError: string | null;
  createdBy: string | null;
  updatedAt: Date;
}): OrgLlmConfigPublic {
  return {
    provider: c.provider,
    enabled: c.enabled,
    modelId: c.modelId,
    region: c.region,
    authMode: c.authMode,
    hasCredentials: Boolean(c.credentialsEncrypted),
    lastValidatedAt: c.lastValidatedAt ? c.lastValidatedAt.toISOString() : null,
    lastValidationError: c.lastValidationError,
    createdBy: c.createdBy,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Public config metadata for an org — NO secret, NO decrypt. Null when off / no config. */
export async function getOrgLlmConfig(orgSlug: string): Promise<OrgLlmConfigPublic | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const c = await prisma.orgLlmConfig.findUnique({ where: { orgId } });
  return c ? toPublic(c) : null;
}

/**
 * Upsert an org's BYOM config. Encrypts supplied creds via secret-box (fails closed when ENCRYPTION_KEY
 * is unset). Omitting both creds KEEPS the stored secret (an edit of model/region without re-entering
 * keys). Returns { ok:false, error } for an unknown org or unconfigured encryption-with-creds.
 */
export async function setOrgLlmConfig(
  orgSlug: string,
  input: OrgLlmConfigInput,
  createdBy?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isDbConfigured()) return { ok: false, error: "Database not configured." };
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { ok: false, error: "Unknown organization." };

  const provider = input.provider?.trim() || "bedrock";

  // Encrypt the provider-appropriate secret. Bedrock = the AWS key pair (both or neither); OpenRouter =
  // a single API key. Omitting the secret KEEPS the stored one (an edit of model/region without
  // re-entering keys). A partial credential is rejected.
  let credentialsEncrypted: string | undefined;
  if (provider === "openrouter") {
    const key = input.apiKey?.trim();
    if (key) {
      if (!isEncryptionConfigured()) {
        return { ok: false, error: "Secret encryption is not configured (set ENCRYPTION_KEY)." };
      }
      credentialsEncrypted = encryptSecret(JSON.stringify({ apiKey: key }));
    }
  } else {
    const hasKeyId = Boolean(input.accessKeyId?.trim());
    const hasSecret = Boolean(input.secretAccessKey?.trim());
    if (hasKeyId !== hasSecret) {
      return { ok: false, error: "Provide both accessKeyId and secretAccessKey, or neither." };
    }
    if (hasKeyId && hasSecret) {
      if (!isEncryptionConfigured()) {
        return { ok: false, error: "Secret encryption is not configured (set ENCRYPTION_KEY)." };
      }
      credentialsEncrypted = encryptSecret(
        JSON.stringify({ accessKeyId: input.accessKeyId!.trim(), secretAccessKey: input.secretAccessKey!.trim() }),
      );
    }
  }

  const base = {
    provider,
    modelId: input.modelId.trim(),
    region: input.region?.trim() || null,
    authMode: input.authMode?.trim() || "static",
    enabled: input.enabled ?? undefined,
  };
  const update: Prisma.OrgLlmConfigUpdateInput = {
    provider: base.provider,
    modelId: base.modelId,
    region: base.region,
    authMode: base.authMode,
    ...(base.enabled !== undefined ? { enabled: base.enabled } : {}),
    // A new credential invalidates any prior validation result.
    ...(credentialsEncrypted ? { credentialsEncrypted, lastValidatedAt: null, lastValidationError: null } : {}),
  };
  await prisma.orgLlmConfig.upsert({
    where: { orgId },
    update,
    create: {
      orgId,
      provider: base.provider,
      modelId: base.modelId,
      region: base.region,
      authMode: base.authMode,
      enabled: base.enabled ?? false,
      credentialsEncrypted: credentialsEncrypted ?? null,
      createdBy: createdBy ?? null,
    },
  });
  return { ok: true };
}

/** Disable BYOM and CLEAR the stored credential (the DELETE endpoint). */
export async function disableOrgLlmConfig(orgSlug: string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return;
  await prisma.orgLlmConfig.updateMany({
    where: { orgId },
    data: { enabled: false, credentialsEncrypted: null, lastValidatedAt: null, lastValidationError: null },
  });
}

/** Stamp the result of a test-connection attempt. */
export async function recordOrgLlmValidation(orgSlug: string, ok: boolean, error?: string | null): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return;
  await prisma.orgLlmConfig.updateMany({
    where: { orgId },
    data: { lastValidatedAt: ok ? new Date() : null, lastValidationError: ok ? null : (error ?? "Validation failed").slice(0, 500) },
  });
}

/** An org's STORED BYOM secret with the config it belongs to — the shape both the provider factory
 *  and the test-connection endpoint need. A discriminated union so a caller can never read an
 *  OpenRouter key as AWS credentials (the silent-null bug that made the OpenRouter test path
 *  impossible to build). Never serialized to a response or a log. */
export type StoredByomSecret =
  | { provider: "bedrock"; modelId: string; region: string | null; credentials: ByomStaticCredentials }
  | { provider: "openrouter"; modelId: string; apiKey: string };

/**
 * THE decrypt primitive — the single place in the codebase that calls decryptSecret on an org's BYOM
 * blob. It is deliberately UN-gated (no `enabled`/plan check) and NOT exported: the two exported
 * readers below own their own gating, so widening the credential surface to a second provider does
 * NOT widen the decrypt surface (module-header discipline). Returns null on missing/tampered/
 * malformed data — never throws, so a bad blob degrades rather than 500s a scan.
 */
async function readStoredByomSecret(orgSlug: string): Promise<StoredByomSecret | null> {
  if (!isDbConfigured() || !isEncryptionConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const c = await prisma.orgLlmConfig.findUnique({ where: { orgId } });
  if (!c?.credentialsEncrypted) return null;
  try {
    const blob = JSON.parse(decryptSecret(c.credentialsEncrypted)) as Partial<ByomStaticCredentials> & {
      apiKey?: string;
    };
    if (c.provider === "openrouter") {
      return blob.apiKey ? { provider: "openrouter", modelId: c.modelId, apiKey: blob.apiKey } : null;
    }
    if (c.provider === "bedrock") {
      return blob.accessKeyId && blob.secretAccessKey
        ? {
            provider: "bedrock",
            modelId: c.modelId,
            region: c.region,
            credentials: { accessKeyId: blob.accessKeyId, secretAccessKey: blob.secretAccessKey },
          }
        : null;
    }
    return null; // unknown provider — never route
  } catch {
    // Tamper / wrong key / malformed — never crash a scan; fall back to the platform provider.
    return null;
  }
}

/** Decrypt an org's STORED secret regardless of `enabled` — for the test-connection endpoint
 *  (save → test → enable). Null when none / encryption off / tamper. Never returned to a client;
 *  consumed only by the test route to build a throwaway provider. */
export async function getStoredByomSecret(orgSlug: string): Promise<StoredByomSecret | null> {
  return readStoredByomSecret(orgSlug);
}

/** Bedrock-only view of {@link getStoredByomSecret} — kept so callers that can ONLY handle AWS
 *  credentials cannot accidentally receive an OpenRouter key. */
export async function getStoredByomCredentials(orgSlug: string): Promise<ByomStaticCredentials | null> {
  const stored = await readStoredByomSecret(orgSlug);
  return stored?.provider === "bedrock" ? stored.credentials : null;
}

/** True when BYOM should drive this org's scans — enabled config WITH creds, Enterprise plan, AND
 *  encryption configured. No decrypt. Used by the scan route to skip credits + by the resolver. */
export async function isByomActive(orgSlug: string): Promise<boolean> {
  if (!isDbConfigured() || !isEncryptionConfigured()) return false;
  if (orgSlug === "public") return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const c = await prisma.orgLlmConfig.findUnique({
    where: { orgId },
    select: { enabled: true, credentialsEncrypted: true },
  });
  if (!c?.enabled || !c.credentialsEncrypted) return false;
  const credit = await getCreditState(orgSlug).catch(() => null);
  return planAllowsByom(credit?.plan);
}

/**
 * The THREE states a BYOM lookup can be in. A single `ByomProviderParams | null` cannot express them:
 * `null` collapsed "this org has no BYOM" (fall through to the platform provider — correct) into
 * "this org's BYOM is ACTIVE but unresolvable" (an ENCRYPTION_KEY rotation, a tampered blob), which
 * must fail closed. The caller then had to re-derive the difference with a SECOND isByomActive() call,
 * and any error in that second call silently resolved to "inactive" — reopening the exact fallback the
 * distinction exists to prevent.
 */
export type ByomResolution =
  | { state: "inactive" }
  | { state: "active"; params: ByomProviderParams }
  | { state: "unresolvable" };

/**
 * Resolve an org's BYOM state in ONE pass — the only decrypt path, and the single read of the org's
 * BYOM configuration (it used to be read twice per scan: once here and once by the caller's
 * disambiguating isByomActive).
 *
 * THROWS on an infrastructure failure (DB unreachable, plan lookup down). That is deliberate and is
 * the whole point: a caller cannot distinguish "no BYOM" from "couldn't tell" if this swallows the
 * error, and guessing "no BYOM" routes an enterprise org's private source to the platform provider.
 * A DECRYPT failure is different — it is a determinate answer ("active, but we cannot use it"), so it
 * returns `unresolvable` rather than throwing.
 */
export async function resolveByomState(orgSlug: string): Promise<ByomResolution> {
  if (!(await isByomActive(orgSlug))) return { state: "inactive" };
  const stored = await readStoredByomSecret(orgSlug);
  if (!stored) return { state: "unresolvable" };
  const params: ByomProviderParams =
    stored.provider === "openrouter"
      ? { kind: "openrouter", model: stored.modelId, apiKey: stored.apiKey }
      : {
          kind: "bedrock",
          model: stored.modelId,
          ...(stored.region ? { region: stored.region } : {}),
          credentials: stored.credentials,
        };
  return { state: "active", params };
}

/**
 * Params-or-null view of {@link resolveByomState}, kept as the db layer's simple accessor (it is part
 * of the `@/lib/db` barrel's public surface). Prefer resolveByomState in any caller that must tell an
 * unresolvable ACTIVE config apart from an org that never configured BYOM — collapsing the two is
 * what made the platform-fallback breach possible.
 */
export async function resolveByomProvider(orgSlug: string): Promise<ByomProviderParams | null> {
  const resolved = await resolveByomState(orgSlug);
  return resolved.state === "active" ? resolved.params : null;
}
