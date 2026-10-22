// One report-back credential PER REPOSITORY, and the honest state of the one a repo holds.
//
// Report-back used to mint every repo's ASCENT_CONFORMANCE_TOKEN under ONE org-wide token name and
// rotate it on every provision. Rotation retires every live token of that name, so provisioning repo
// N silently revoked the credential already written into repos 1..N-1, and revoking one repo killed
// them all. The fix is a name per repo: provisioning or revoking one repo can only ever touch tokens
// carrying THAT repo's name.
//
// The rollout panel used to read "Provisioned" from the latest audit row alone, never checking the
// row's `ok` or whether the token it recorded is still live. `reportBackState` joins the two and says
// which of five things is true, so the row can offer the one action that fits.
//
// PURE and client-safe: no `node:` imports (the hash is FNV-1a), no db, no env. A client component may
// import these types and helpers.

/** The single org-wide name every repo shared before per-repo credentials. Kept to read legacy rows. */
export const LEGACY_TOKEN_NAME = "conformance report-back";

/** The token-name column's length cap (org-api-tokens slices names to this). */
export const TOKEN_NAME_MAX = 80;

const NAME_PREFIX = "report-back ";

/** FNV-1a, 32-bit, as 8 hex chars. Not a security hash: it only keeps truncated names distinct. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The stable token name for one repository's report-back credential. Case-insensitive (GitHub names
 * are), at most {@link TOKEN_NAME_MAX} chars. A name that would overflow is cut and suffixed with a
 * hash of the WHOLE name, so two repos sharing their first 80 chars still get different names.
 */
export function tokenNameFor(fullName: string): string {
  const base = `${NAME_PREFIX}${fullName.trim().toLowerCase()}`;
  if (base.length <= TOKEN_NAME_MAX) return base;
  const hash = fnv1a(base);
  return `${base.slice(0, TOKEN_NAME_MAX - hash.length - 1)}~${hash}`;
}

/** Why a provision attempt failed, as a class. Never the raw GitHub body. */
export type ReportBackFailure = "missing-permission" | "write-failed";

/** A refused secrets write classified by HTTP status: 403 means the App lacks Secrets write. */
export function failureReason(status: number | null | undefined): ReportBackFailure {
  return status === 403 ? "missing-permission" : "write-failed";
}

export type ReportBackState = "live" | "failed" | "credential-revoked" | "legacy-shared" | "none";

export interface ReportBackStatus {
  state: ReportBackState;
  /** Set only for `failed`. */
  reason?: ReportBackFailure;
  /** The App's per-installation Configure page, set for a `missing-permission` failure when known. */
  configureUrl?: string;
}

/** What the latest `foundation.reportback_provisioned` audit row recorded for a repo. */
export interface ProvisionRecord {
  ok: boolean;
  tokenPrefix: string | null;
  /** Absent on rows written before per-repo credentials: those were all the legacy shared name. */
  tokenName: string | null;
  reason: ReportBackFailure | null;
}

/** Read a provision record out of an audit row's meta. Tolerates every older meta shape. */
export function provisionRecordOf(meta: Record<string, unknown>): ProvisionRecord {
  const reason = meta.reason === "missing-permission" || meta.reason === "write-failed" ? meta.reason : null;
  return {
    // Older rows may predate `ok`; only an explicit false is a failure.
    ok: meta.ok !== false,
    tokenPrefix: typeof meta.tokenPrefix === "string" ? meta.tokenPrefix : null,
    tokenName: typeof meta.tokenName === "string" ? meta.tokenName : null,
    reason,
  };
}

/**
 * The repo's report-back state. `record` is the latest provision row, or null when there is none or a
 * NEWER revoke retired it. `livePrefixes` are the display prefixes of the org's live tokens.
 */
export function reportBackState(record: ProvisionRecord | null, livePrefixes: ReadonlySet<string>): ReportBackStatus {
  if (!record) return { state: "none" };
  if (!record.ok) return { state: "failed", reason: record.reason ?? "write-failed" };
  if (!record.tokenPrefix || !livePrefixes.has(record.tokenPrefix)) return { state: "credential-revoked" };
  if (!record.tokenName || record.tokenName === LEGACY_TOKEN_NAME) return { state: "legacy-shared" };
  return { state: "live" };
}

/** True when the repo's CI can still post a score with the credential it holds. */
export function canReport(status: ReportBackStatus): boolean {
  return status.state === "live" || status.state === "legacy-shared";
}
