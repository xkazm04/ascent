// The ONE-SHOT handoff between the wizard's "fast preview first" run and the org shell's header
// scan button: the wizard imports the selected repos as an instant mock preview, writes this flag,
// and sends the user to /org/<slug> — where useOrgScanButton consumes the flag ON MOUNT and starts
// the LIVE scan of exactly those repos through the layout-persistent header stream. Because the
// header (and its SSE stream) is mounted by the org LAYOUT and every migrated tab is a `?tab=` push
// on the same route, the user can tour the dashboard while live results replace the preview rows
// (persistScanReport's engine-aware dedup retires each mock row in place — scans-persist.ts).
//
// Guard rails, all encoded here:
//   - ONE-SHOT: consuming removes the key BEFORE anything else can read it, so a refresh (or React
//     StrictMode's double effect) can never re-trigger a second billable run.
//   - Tenant-scoped: the flag names its org; visiting a DIFFERENT org leaves it in place untouched
//     (the user may pass through another dashboard first), and only the matching org consumes it.
//   - TTL: a stale flag (tab parked overnight) is discarded, not run — an hours-late surprise scan
//     is exactly the "silent spend" this choreography must never do. The consumer still relies on
//     the server (/api/org/scan) for the real authority: membership (requireOrgAccess) and the
//     credit gate (checkScanEntitlement + per-repo reservation) are enforced there, never here.
//   - sessionStorage (not localStorage): per-tab, gone when the tab closes — matching the wizard's
//     own resume-snapshot channel.

const KEY = "ascent.upgrade-scan.v1";

/** Org keys are compared CASE-INSENSITIVELY: the wizard writes the GitHub handle as listed
 *  ("Acme-Corp") while the dashboard sees whatever casing the URL carried, and the DB slug itself is
 *  lower-cased (`normalizeOrgSlug`). Without this, `/org/acme-corp` would silently ignore a flag
 *  written for "Acme-Corp" — the whole choreography lost to a capital letter. */
function orgKey(org: string): string {
  return org.trim().toLowerCase();
}
/** A flag older than this is stale — discard rather than auto-start a scan the user forgot about. */
export const UPGRADE_SCAN_TTL_MS = 15 * 60_000;

export interface UpgradeScanFlag {
  org: string;
  repos: string[];
  at: number;
}

/** Wizard side: record that `repos` (just previewed under `org`) await their live upgrade. */
export function setUpgradeScanFlag(org: string, repos: string[]): void {
  try {
    const flag: UpgradeScanFlag = { org: orgKey(org), repos, at: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(flag));
  } catch {
    /* sessionStorage unavailable (private mode / quota) — the handoff is best-effort; the user can
       still run the header scan manually. */
  }
}

/**
 * Org-shell side: consume the flag for THIS org. Returns the repo list exactly once — the key is
 * removed before returning, so a second call (refresh, StrictMode re-run) gets null. A flag for a
 * different org is left in place; an expired or malformed flag is removed and dropped.
 */
export function consumeUpgradeScanFlag(org: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    let flag: UpgradeScanFlag | null = null;
    try {
      flag = JSON.parse(raw) as UpgradeScanFlag;
    } catch {
      flag = null;
    }
    if (!flag || typeof flag.org !== "string") {
      sessionStorage.removeItem(KEY); // malformed — never runnable, clear it
      return null;
    }
    if (orgKey(flag.org) !== orgKey(org)) return null; // someone else's dashboard — leave for the right org
    sessionStorage.removeItem(KEY); // one-shot: gone before any run starts
    if (typeof flag.at !== "number" || Date.now() - flag.at > UPGRADE_SCAN_TTL_MS) return null;
    if (!Array.isArray(flag.repos) || flag.repos.length === 0) return null;
    return flag.repos.map(String);
  } catch {
    return null;
  }
}
