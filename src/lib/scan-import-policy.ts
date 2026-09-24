// The scan policy an /api/org/import job carries on its queue row (backlog develop-2026-09-17 row 26).
//
// The import route ENQUEUES its whole batch before scanning, drains what fits inside its 300s budget,
// and leaves the tail as `queued` ScanJob rows for the background worker. Those rows are then run by
// `runRescoreJob`, which knows nothing about the request that created them. Three facts about that
// request change what the scan is ALLOWED to do, so they travel on the row's `reason`, in the same
// colon-namespaced shape the schema already documents for `webhook:<event>`:
//
//   • token  - which GitHub credential the import scanned with. `none` is the anonymous public funnel's
//              token-less scan: without it on the row, the worker would fall back to the ambient
//              GITHUB_TOKEN (an operator PAT, often with private `repo` scope) and hand an attacker-
//              named private repo to the open org, the confused deputy the import route closes.
//   • mock   - a free preview import. Without it the worker would run REAL inference and reserve a
//              credit for a run the user asked to be free.
//   • funnel - the public-funnel allowance, which is metered per REQUEST (the caller's IP / viewer).
//              No background worker holds that request, so such a job cannot be finished off-request
//              and is settled `skipped` rather than scanned unmetered or billed to credits.
//
// A bare `import` (a row written before this encoding) decodes to null: the worker's default path,
// unchanged. An unrecognised token flag decodes to `none`, the least-privileged credential.

export type ImportTokenMode = "install" | "ambient" | "none";

export interface ImportJobPolicy {
  /** `install`: the org's GitHub App installation token. `ambient`: the auth-off seeding path's env
   *  token. `none`: token-less, never the ambient PAT. */
  token: ImportTokenMode;
  /** A free mock-LLM preview: no inference, never a credit. */
  mock: boolean;
  /** Metered against the per-request public-scan allowance: not resumable off-request. */
  funnel: boolean;
}

const PREFIX = "import:";

/** The `reason` an import job is enqueued under. */
export function importJobReason(policy: ImportJobPolicy): string {
  const flags: string[] = [policy.token];
  if (policy.mock) flags.push("mock");
  if (policy.funnel) flags.push("funnel");
  return PREFIX + flags.join("+");
}

/** The policy on a job's `reason`, or null when the row is not a policy-carrying import job. */
export function decodeImportReason(reason: string): ImportJobPolicy | null {
  if (!reason.startsWith(PREFIX)) return null;
  const flags = new Set(reason.slice(PREFIX.length).split("+"));
  const token: ImportTokenMode = flags.has("install") ? "install" : flags.has("ambient") ? "ambient" : "none";
  return { token, mock: flags.has("mock"), funnel: flags.has("funnel") };
}
