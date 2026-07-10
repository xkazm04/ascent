// Per-org connected LLM (BYOM — Feature 1) db layer. The org's Amazon Bedrock credentials are the first
// customer secret Ascent persists, so the discipline here is strict:
//   - the secret is stored ONLY in `credentialsEncrypted` (AES-256-GCM via secret-box), never plain;
//   - getOrgLlmConfig returns metadata + `hasCredentials` (presence) — NEVER the secret, NEVER decrypts;
//   - resolveByomProvider is the ONLY decrypt path, used solely by the provider factory at build time;
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
  /** Static AWS creds (plaintext in; encrypted before storage). Omit both to KEEP existing creds. */
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Decrypted static credentials — produced ONLY by resolveByomProvider, consumed ONLY by the provider
 *  factory + the test endpoint. Never serialized to a response or a log. */
export interface ByomStaticCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ByomProviderParams {
  model: string;
  region?: string;
  credentials: ByomStaticCredentials;
}

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

  // Encrypt creds when BOTH are supplied. Either-only is a partial credential → reject.
  let credentialsEncrypted: string | undefined;
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

  const base = {
    provider: input.provider?.trim() || "bedrock",
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

/** Decrypt an org's STORED static credentials regardless of `enabled` — for the test-connection
 *  endpoint (save → test → enable). Null when none / encryption off / tamper. Never returned to a
 *  client; consumed only by the test route to build a throwaway provider. */
export async function getStoredByomCredentials(orgSlug: string): Promise<ByomStaticCredentials | null> {
  if (!isDbConfigured() || !isEncryptionConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const c = await prisma.orgLlmConfig.findUnique({ where: { orgId }, select: { credentialsEncrypted: true } });
  if (!c?.credentialsEncrypted) return null;
  try {
    const creds = JSON.parse(decryptSecret(c.credentialsEncrypted)) as Partial<ByomStaticCredentials>;
    return creds.accessKeyId && creds.secretAccessKey
      ? { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey }
      : null;
  } catch {
    return null;
  }
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
 * Resolve the BYOM provider params (incl. DECRYPTED creds) when BYOM is active for this org, else null.
 * The ONLY decrypt path. Returns null (never throws) if anything is off — a bad/tampered blob makes the
 * scan fall back to the platform path rather than 500. Used solely by getProviderForOrg.
 */
export async function resolveByomProvider(orgSlug: string): Promise<ByomProviderParams | null> {
  if (!(await isByomActive(orgSlug))) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const c = await prisma.orgLlmConfig.findUnique({ where: { orgId } });
  if (!c?.credentialsEncrypted || c.provider !== "bedrock") return null;
  try {
    const creds = JSON.parse(decryptSecret(c.credentialsEncrypted)) as Partial<ByomStaticCredentials>;
    if (!creds.accessKeyId || !creds.secretAccessKey) return null;
    return {
      model: c.modelId,
      ...(c.region ? { region: c.region } : {}),
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    };
  } catch {
    // Tamper / wrong key / malformed — never crash a scan; fall back to the platform provider.
    return null;
  }
}
