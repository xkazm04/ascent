// Wires the doctor into BOTH control layers with ONE script — the shift-left model made literal:
//   - pre-push (primary):  the agent runs `node .ai/doctor.mjs` locally before the branch leaves the box
//   - CI (thin backstop):  the SAME command runs on the merge gate, confirming what the agent already did
// We generate the CI workflow here; the pre-push side is a one-line extension of the repo's existing
// hook (lefthook/husky/pre-commit), which the skill instructs — we never add a parallel hook system.
//
// Language-neutral: the gate only needs Node to run the in-repo doctor, so it works for any stack.

import type { GeneratedFile } from "./types";

export function buildConformanceWiring(): GeneratedFile {
  // Trigger on pull_request (the merge gate) AND a weekly schedule (the CONTINUOUS half — G7-23).
  // A pull_request-only trigger means a repo that goes quiet (no PRs for weeks) never re-reports, so
  // Ascent's dashboard silently shows a stale score while the manifest/hooks/CI may have drifted
  // underneath it. The scheduled job re-runs the SAME doctor and, when ASCENT_CONFORMANCE_URL +
  // ASCENT_CONFORMANCE_TOKEN are configured as repo/org secrets, reports the fresh result back with
  // --json — closing the loop without requiring a human to open a PR first. Both triggers are
  // branch-name-agnostic (no hard-coded main/master/trunk) so this works on any default branch.
  const body = `# .ai conformance — the hard-pass BACKSTOP for the .ai/ standard, plus a scheduled
# CONTINUOUS re-check so the score doesn't go stale between PRs.
# The SAME command runs in your pre-push hook (primary) and here on the merge gate (backstop):
# the agent self-certifies locally, CI only confirms. The doctor exits non-zero on a hard failure,
# which blocks the merge (pull_request job only — a scheduled run must not fail the merge queue).
# Add --run to also execute capability commands (heavier; the repo's own test/build CI usually
# already does that).
name: ai-conformance
on:
  pull_request:
  schedule:
    # Weekly, off-peak UTC. Re-reports conformance even when the repo has no open PRs, so a
    # dashboard viewer never sees a score that's silently weeks stale.
    - cron: "17 6 * * 1"
  workflow_dispatch: {}
# Least-privilege GITHUB_TOKEN: this workflow only checks out the code and runs the in-repo doctor, so
# it needs read access to repo contents and nothing else. Declaring it explicitly drops the token to
# read-only even on repos whose org default is the broad read/write token — a supply-chain guardrail
# for a workflow Ascent generates into every adopting repo.
permissions:
  contents: read
jobs:
  conformance:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: .ai conformance gate
        run: node .ai/doctor.mjs
  # Scheduled/manual re-check: never fails the run (report-only), and self-reports to Ascent via
  # doctor.mjs's own --json path when the two secrets below are set. Set ASCENT_CONFORMANCE_URL to
  # your Ascent deployment's /api/report/conformance endpoint and ASCENT_CONFORMANCE_TOKEN to an
  # org-scoped API token with the telemetry:write scope (Org Settings -> API tokens).
  scheduled-report:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: .ai conformance report (continuous)
        env:
          ASCENT_CONFORMANCE_URL: \${{ secrets.ASCENT_CONFORMANCE_URL }}
          ASCENT_CONFORMANCE_TOKEN: \${{ secrets.ASCENT_CONFORMANCE_TOKEN }}
        run: node .ai/doctor.mjs --json
`;
  return {
    path: ".github/workflows/ai-conformance.yml",
    body,
    purpose:
      "CI hard-pass backstop on the merge gate, plus a weekly scheduled re-check that self-reports conformance to Ascent even between PRs.",
    lang: "yaml",
  };
}
