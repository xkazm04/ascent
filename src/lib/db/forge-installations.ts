// FORGE INSTALLATIONS (moonshot #4) — one org's credential + capability record for ONE forge account
// (a GitLab group access token, a PAT, a self-managed host).
//
// THE CREDENTIAL NEVER CROSSES THE WIRE. `Installation.credentialRef` holds `encryptSecret()`
// ciphertext, it is read only by server code that is about to make a forge call, and the wire type
// `ForgeInstallationRow` has NO field for it — not a redacted one, not a boolean named `credentialRef`.
// What the UI needs to know is `hasCredential`, and that is a different fact with a different name, so
// there is no shape in which a route handler can accidentally serialize the secret.
//
// `Organization.githubInstallId` is DELIBERATELY UNTOUCHED and remains the GitHub read path. Migrating
// a live identity column onto this table is its own release; a table that sits beside it costs nothing
// and risks nothing, and the two are never consulted for the same forge.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { recordAudit } from "@/lib/db/scans-audit";
import { isForgeId, type ForgeCapabilities, type ForgeHost, type ForgeId } from "@/lib/forge/types";
import { forgeCapabilities } from "@/lib/forge/registry";

/**
 * The CLIENT-FACING row. Timestamps are `string` (ISO), mapped with `.toISOString()` server-side —
 * the wire-safe-dates invariant, asserted in `src/lib/db/wire-safe.ts`.
 */
export interface ForgeInstallationRow {
  id: string;
  forge: ForgeId;
  /** The forge-native account id: a GitLab group id or path. Never a secret. */
  externalId: string;
  /** Null = the forge's public host. Set for a self-managed instance. */
  host: string | null;
  /** Whether a credential is stored — NOT the credential, and deliberately not named after it. */
  hasCredential: boolean;
  /** What this account can be asked, as recorded when it was connected. Falls back to the adapter's
   *  compiled-in manifest when the column is empty or unparseable, so the UI never renders a blank
   *  capability table for a row that predates the column. */
  capabilities: ForgeCapabilities;
  createdAt: string;
  updatedAt: string;
}

type DbInstallation = {
  id: string;
  forge: string;
  externalId: string;
  host: string | null;
  credentialRef: string | null;
  capabilitiesJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT = {
  id: true,
  forge: true,
  externalId: true,
  host: true,
  credentialRef: true,
  capabilitiesJson: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Prisma row → wire row. The ONE place `credentialRef` is turned into a boolean and dropped. */
function toRow(r: DbInstallation): ForgeInstallationRow {
  // The column is plain TEXT; a value written by an older build or a hand-edit must degrade to a
  // documented default rather than reach a caller as an unhandled forge id.
  const forge: ForgeId = isForgeId(r.forge) ? r.forge : "github";
  return {
    id: r.id,
    forge,
    externalId: r.externalId,
    host: r.host,
    hasCredential: Boolean(r.credentialRef),
    capabilities: parseCapabilities(r.capabilitiesJson, forge),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Parse the recorded manifest, falling back to the adapter's own. Never throws, never returns a
 *  partial object a consumer would read as "capability absent". */
export function parseCapabilities(json: string | null, forge: ForgeId): ForgeCapabilities {
  const fallback = forgeCapabilities(forge);
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json) as Partial<ForgeCapabilities>;
    if (!parsed || typeof parsed !== "object") return fallback;
    // Merge onto the fallback so a manifest written before a capability existed reports the adapter's
    // current answer for it instead of `undefined`.
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

/** One org's installation for a forge, or null. Read-only; carries no secret. */
export async function getForgeInstallation(
  orgSlug: string,
  forge: ForgeId,
): Promise<ForgeInstallationRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const row = await getPrisma().installation.findFirst({ where: { orgId, forge }, select: SELECT });
  return row ? toRow(row as DbInstallation) : null;
}

/** Every installation an org has connected. */
export async function listForgeInstallations(orgSlug: string): Promise<ForgeInstallationRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().installation.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });
  return rows.map((r) => toRow(r as DbInstallation));
}

/**
 * SERVER-ONLY. The decrypted credential for a forge call, plus the host override to make it against.
 * Returns `token: null` when no credential is stored, when encryption is not configured, or when the
 * stored ciphertext cannot be decrypted (a rotated key) — never a partial or a guess. Callers treat a
 * null token exactly as they treat an anonymous scan.
 *
 * NOTHING in this module's other exports can reach this value; keep it that way.
 */
export async function getForgeCredential(
  orgSlug: string,
  forge: ForgeId,
): Promise<{ token: string | null; host: ForgeHost | null }> {
  if (!isDbConfigured()) return { token: null, host: null };
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { token: null, host: null };
  const row = await getPrisma().installation.findFirst({
    where: { orgId, forge },
    select: { credentialRef: true, host: true },
  });
  if (!row) return { token: null, host: null };
  const host = row.host ? hostFromBase(row.host) : null;
  if (!row.credentialRef || !isEncryptionConfigured()) return { token: null, host };
  try {
    return { token: decryptSecret(row.credentialRef), host };
  } catch {
    // A rotated/absent key means the stored secret is unreadable. Degrading to "no token" is the
    // honest outcome; guessing or falling back to an ambient credential would be a tenancy bug.
    console.error("[forge-installations] stored credential could not be decrypted", { orgSlug, forge });
    return { token: null, host };
  }
}

/** A stored `host` string (the instance's web root) → the `ForgeHost` an adapter takes. */
export function hostFromBase(base: string): ForgeHost {
  const web = base.replace(/\/+$/, "");
  return { apiBase: `${web}/api/v4`, webBase: web };
}

export interface UpsertForgeInstallationInput {
  orgSlug: string;
  forge: ForgeId;
  externalId: string;
  /** The instance web root for a self-managed forge; null/undefined = the public host. */
  host?: string | null;
  /**
   * The PLAINTEXT credential. `undefined` leaves an existing credential untouched (so an admin can
   * rename a host without re-pasting a token); `null` CLEARS it. Encrypted here, never stored raw,
   * and never echoed back by any read in this module.
   */
  credential?: string | null;
  actorId?: string;
}

/**
 * Connect or update an org's forge account. Idempotent on `(orgId, forge, externalId)`, which IS the
 * unique key, so a double-submit cannot fork a second row.
 *
 * Writes an `AuditLog` entry — `forge.installation.set` or `.cleared` — whose payload names the forge,
 * the external id and the host, and NEVER the credential or its ciphertext.
 */
export async function upsertForgeInstallation(
  input: UpsertForgeInstallationInput,
): Promise<ForgeInstallationRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(input.orgSlug);
  if (!orgId) return null;
  if (input.credential && !isEncryptionConfigured()) {
    // Refuse rather than store a secret in the clear. The route surfaces this as a configuration
    // error; silently persisting plaintext would be the worst available outcome.
    throw new Error("Secret encryption is not configured — refusing to store a forge credential.");
  }

  const capabilitiesJson = JSON.stringify(forgeCapabilities(input.forge));
  const credentialRef =
    input.credential === undefined ? undefined : input.credential === null ? null : encryptSecret(input.credential);

  const row = await getPrisma().installation.upsert({
    where: { orgId_forge_externalId: { orgId, forge: input.forge, externalId: input.externalId } },
    update: {
      host: input.host ?? null,
      capabilitiesJson,
      ...(credentialRef === undefined ? {} : { credentialRef }),
    },
    create: {
      orgId,
      forge: input.forge,
      externalId: input.externalId,
      host: input.host ?? null,
      capabilitiesJson,
      credentialRef: credentialRef ?? null,
    },
    select: SELECT,
  });

  await recordAudit(
    input.credential === null ? "forge.installation.cleared" : "forge.installation.set",
    { forge: input.forge, externalId: input.externalId, host: input.host ?? null },
    { orgId, actorId: input.actorId },
  );
  return toRow(row as DbInstallation);
}

/** Disconnect a forge account. Returns whether a row was removed. */
export async function deleteForgeInstallation(
  orgSlug: string,
  forge: ForgeId,
  externalId: string,
  opts: { actorId?: string } = {},
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const deleted = await getPrisma().installation.deleteMany({ where: { orgId, forge, externalId } });
  if (deleted.count > 0) {
    await recordAudit(
      "forge.installation.cleared",
      { forge, externalId, disconnected: true },
      { orgId, actorId: opts.actorId },
    );
  }
  return deleted.count > 0;
}
