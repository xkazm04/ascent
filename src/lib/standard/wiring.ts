// Wires the doctor into BOTH control layers with ONE script — the shift-left model made literal:
//   - pre-push (primary):  the agent runs `node .ai/doctor.mjs` locally before the branch leaves the box
//   - CI (thin backstop):  the SAME command runs on the merge gate, confirming what the agent already did
// We generate the CI workflow here; the pre-push side is a one-line extension of the repo's existing
// hook (lefthook/husky/pre-commit), which the skill instructs — we never add a parallel hook system.
//
// Language-neutral: the gate only needs Node to run the in-repo doctor, so it works for any stack.

import type { GeneratedFile } from "./types";

export function buildConformanceWiring(): GeneratedFile {
  // Trigger on pull_request only — the merge gate is branch-name-agnostic, so this works whether the
  // default branch is main, master, or anything else (no hard-coded branch to get wrong). Add a
  // `push:` trigger for your default branch if you also want to gate direct pushes.
  const body = `# .ai conformance — the hard-pass BACKSTOP for the .ai/ standard.
# The SAME command runs in your pre-push hook (primary) and here on the merge gate (backstop):
# the agent self-certifies locally, CI only confirms. The doctor exits non-zero on a hard failure,
# which blocks the merge. Add --run to also execute capability commands (heavier; the repo's own
# test/build CI usually already does that).
name: ai-conformance
on:
  pull_request:
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: .ai conformance gate
        run: node .ai/doctor.mjs
`;
  return {
    path: ".github/workflows/ai-conformance.yml",
    body,
    purpose: "CI hard-pass backstop: runs the same doctor as your pre-push hook, on the merge gate.",
    lang: "yaml",
  };
}
