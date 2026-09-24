// PROVIDER CREDENTIALS: one org's pull credential for an AI-usage provider read by ADMIN PULL with a
// customer-supplied key (today: the OpenAI Admin Costs connector). Copilot needs none of this: it
// reads through the GitHub App installation Ascent already holds.
//
// THE KEY NEVER CROSSES THE WIRE. `ProviderCredential.credentialRef` holds `encryptSecret()`
// ciphertext (AES-256-GCM, ENCRYPTION_KEY; src/lib/crypto/secret-box.ts), the same custody the forge
// installations and BYOM use. `getProviderSecret` is the only reader that decrypts, and only the sync
// route calls it. The wire type `ProviderConnectionRow` has no field for the key or its ciphertext;
// what the UI needs is `hasCredential`, a different fact with a different name. Fail CLOSED: with no
// ENCRYPTION_KEY, a key is refused rather than stored in the clear.
//
// The same row records the LAST SYNC and whether it was complete, so a pull that stopped early (page
// cap, rate limit) stays visibly partial instead of reading as a whole window.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { recordAudit } from "@/lib/db/scans-audit";

export type CredentialProvider = "openai";
export type ProviderSyncStatus = "complete" | "partial" | "failed";

export const OPENAI_CONNECT_ACTION = "integrations.openai.connect";
export const OPENAI_DISCONNECT_ACTION = "integrations.openai.disconnect";

/** The CLIENT-FACING row. Timestamps are ISO strings (the wire-safe-dates invariant). */
export interface ProviderConnectionRow {
  provider: CredentialProvider;
  /** Whether a key is stored: NOT the key, and deliberately not named after it. */
  hasCredential: boolean;
  /** The OpenAI project filter; empty = every project in the organization. */
  projectIds: string[];
  lastSyncAt: string | null;
  lastSyncStatus: ProviderSyncStatus | null;
  lastSyncDetail: string | null;
  /** The span the last sync actually covered: first bucket start, last bucket end. */
  lastSyncFrom: string | null;
  lastSyncThrough: string | null;
  updatedAt: string;
}

type DbRow = {
  provider: string;
  credentialRef: string | null;
  projectIdsJson: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncDetail: string | null;
  lastSyncFrom: Date | null;
  lastSyncThrough: Date | null;
  updatedAt: Date;
};

function parseProjects(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const STATUSES: readonly string[] = ["complete", "partial", "failed"];

/** Prisma row → wire row. The ONE place `credentialRef` becomes a boolean and is dropped. */
function toRow(r: DbRow): ProviderConnectionRow {
  return {
    provider: "openai",
    hasCredential: Boolean(r.credentialRef),
    projectIds: parseProjects(r.projectIdsJson),
    lastSyncAt: iso(r.lastSyncAt),
    lastSyncStatus: r.lastSyncStatus && STATUSES.includes(r.lastSyncStatus) ? (r.lastSyncStatus as ProviderSyncStatus) : null,
    lastSyncDetail: r.lastSyncDetail,
    lastSyncFrom: iso(r.lastSyncFrom),
    lastSyncThrough: iso(r.lastSyncThrough),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function findRow(orgSlug: string, provider: CredentialProvider): Promise<(DbRow & { orgId: string }) | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const row = (await getPrisma().providerCredential.findFirst({ where: { orgId, provider } })) as DbRow | null;
  return row ? { ...row, orgId } : null;
}

/** The org's connection status for one provider, or null. Read-only; carries no secret. */
export async function getProviderConnection(orgSlug: string, provider: CredentialProvider): Promise<ProviderConnectionRow | null> {
  const row = await findRow(orgSlug, provider);
  return row ? toRow(row) : null;
}

/**
 * SERVER-ONLY. The decrypted key and the project filter, for the sync route and nothing else.
 * `key: null` comes with the reason: nothing stored, no ENCRYPTION_KEY, or ciphertext that no longer
 * decrypts (a rotated key). Never a partial value or a guess. Never log the return value.
 */
export async function getProviderSecret(
  orgSlug: string,
  provider: CredentialProvider,
): Promise<{ key: string | null; projectIds: string[]; reason: "absent" | "no-encryption" | "undecryptable" | null }> {
  const row = await findRow(orgSlug, provider);
  if (!row?.credentialRef) return { key: null, projectIds: [], reason: "absent" };
  const projectIds = parseProjects(row.projectIdsJson);
  if (!isEncryptionConfigured()) return { key: null, projectIds, reason: "no-encryption" };
  try {
    return { key: decryptSecret(row.credentialRef), projectIds, reason: null };
  } catch {
    console.error("[provider-credentials] stored key could not be decrypted", { orgSlug, provider });
    return { key: null, projectIds, reason: "undecryptable" };
  }
}

export interface SetProviderConnectionInput {
  orgSlug: string;
  provider: CredentialProvider;
  /** PLAINTEXT key; encrypted here. `undefined` keeps the stored key (edit the project filter only). */
  credential?: string;
  /** `undefined` keeps the stored filter; `[]` clears it. */
  projectIds?: string[];
  actorId?: string;
}

/** Connect or update. Idempotent on (orgId, provider). Audits the act; the payload never holds the key. */
export async function setProviderConnection(input: SetProviderConnectionInput): Promise<ProviderConnectionRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(input.orgSlug);
  if (!orgId) return null;
  if (input.credential !== undefined && !isEncryptionConfigured()) {
    throw new Error("Secret encryption is not configured: refusing to store a provider key.");
  }
  const data = {
    ...(input.credential === undefined ? {} : { credentialRef: encryptSecret(input.credential) }),
    ...(input.projectIds === undefined ? {} : { projectIdsJson: JSON.stringify(input.projectIds) }),
  };
  const row = (await getPrisma().providerCredential.upsert({
    where: { orgId_provider: { orgId, provider: input.provider } },
    update: data,
    create: { orgId, provider: input.provider, ...data },
  })) as DbRow;
  const out = toRow(row);
  await recordAudit(
    OPENAI_CONNECT_ACTION,
    { provider: input.provider, keyUpdated: input.credential !== undefined, projects: out.projectIds.length },
    { orgId, actorId: input.actorId },
  );
  return out;
}

/** Disconnect: delete the row, which destroys the ciphertext. Stored usage records are kept (they
 *  are real past spend). Returns whether anything was removed; audits only a real removal. */
export async function deleteProviderConnection(
  orgSlug: string,
  provider: CredentialProvider,
  opts: { actorId?: string } = {},
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const res = await getPrisma().providerCredential.deleteMany({ where: { orgId, provider } });
  if (res.count > 0) await recordAudit(OPENAI_DISCONNECT_ACTION, { provider }, { orgId, actorId: opts.actorId });
  return res.count > 0;
}

export interface ProviderSyncOutcome {
  status: ProviderSyncStatus;
  detail: string | null;
  from: Date | null;
  through: Date | null;
  at?: Date;
}

/** Stamp the last sync's outcome on the connection. A no-op when the org has no connection row. */
export async function recordProviderSync(orgSlug: string, provider: CredentialProvider, o: ProviderSyncOutcome): Promise<void> {
  if (!isDbConfigured()) return;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return;
  await getPrisma().providerCredential.updateMany({
    where: { orgId, provider },
    data: {
      lastSyncAt: o.at ?? new Date(),
      lastSyncStatus: o.status,
      lastSyncDetail: o.detail,
      lastSyncFrom: o.from,
      lastSyncThrough: o.through,
    },
  });
}
