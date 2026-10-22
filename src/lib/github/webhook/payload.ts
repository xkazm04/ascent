// The slice of a GitHub App webhook delivery the arms read. Moved verbatim from
// src/app/api/app/webhook/route.ts when the arms became a table (challenge-2026-10-22d github-app-0).

export interface WebhookPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
  repository?: { full_name?: string; name?: string; default_branch?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
    // MOONSHOT #1 - the fields the live AI-change reducer reads. All optional: the PR-gate arm has
    // always used only `number`/`head`/`base`, and a delivery that omits these simply yields no
    // AI-change row rather than a partial one.
    title?: string;
    body?: string;
    draft?: boolean;
    created_at?: string;
    merged?: boolean;
    merged_at?: string | null;
    merge_commit_sha?: string | null;
    user?: { login?: string; type?: string };
    labels?: { name?: string }[];
  };
  ref?: string;
  after?: string;
  deleted?: boolean;
  // push event: which paths each commit touched (the registry lane reads only `.ai/` moves).
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
  // check_run event: a "Re-run" button click (requested_action) or GitHub's rerequested.
  check_run?: { head_sha?: string; pull_requests?: { number?: number; base?: { ref?: string } }[] };
  requested_action?: { identifier?: string };
  // Control-probe events (moonshot #10). Only the ORGANIZATION/owner is read off these - the payload
  // names WHAT to re-read, never the control state itself.
  organization?: { login?: string };
}
