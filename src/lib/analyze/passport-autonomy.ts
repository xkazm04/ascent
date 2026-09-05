// Per-repo autonomy tier for the App Readiness Passport (W1b) — "what can you safely hand an
// agent in THIS repo?" A PURE sibling of passport-score.ts: derived from fields the passport
// already carries plus scan governance, never authored, no IO/clock/random.
//
// The ladder (predicates are cumulative — a tier requires every lower tier's predicates too):
//   T0 observe-only        — the default; nothing an agent produces should merge unread.
//   T1 tests/docs/refactors — agent instructions committed + a one-command test entry point +
//                             tests.level ≥ partial (agent output can be CHECKED before it lands).
//   T2 features w/ review   — + CI gates merges (ci.level ≥ gated) + tests.level ≥ substantial +
//                             (guardrail hooks OR a reproducible sandbox).
//   T3 scheduled autonomous — + AI demonstrably in the workflow + an eval harness + versioned
//                             migrations (unattended runs need a reversible schema trail).
//
// TOKEN HONESTY (same doctrine as passport.ts): "gated" is an ENFORCED rung that needs branch
// protection, which a tokenless scan cannot observe. governance == null therefore caps the grant
// at T1 and says so in `missing` — never claim a delegation level the scan couldn't verify.
//
// MIGRATION HONESTY: sandbox/hooks are 0.3.0 detectors. On a passport lifted from an older stored
// row they are undefined — UNKNOWN, not false — and the T2 checklist names the re-scan, not the
// missing artifact.

import type { AppPassport, AutonomyBlock, AutonomyTierId, Governance } from "@/lib/types";

const TEST_RANK = ["none", "smoke", "partial", "substantial", "comprehensive"] as const;
const CI_RANK = ["none", "build", "checks", "gated", "delivery", "progressive"] as const;

const testRank = (level: string): number => Math.max(0, TEST_RANK.indexOf(level as (typeof TEST_RANK)[number]));
const ciRank = (level: string): number => Math.max(0, CI_RANK.indexOf(level as (typeof CI_RANK)[number]));

export const TOKENLESS_MISSING =
  "Enforcement (branch protection) not observable on this scan (no token). Tiers above T1 require verified merge gates; re-scan with a token.";

const SANDBOX_HOOKS_UNKNOWN =
  "Sandbox/hooks not assessed by this pre-0.3.0 scan. Re-scan to detect devcontainer/Dockerfile/nix and hook configs.";

interface Predicate {
  met: boolean;
  missing: string;
}

/** Tolerant reads: stored blobs may be partial/legacy, so every field degrades to its floor. */
function readInputs(pp: AppPassport, enforcementVisible: boolean): AutonomyBlock["inputs"] {
  const auto = pp.automationReadiness;
  const prod = pp.productionReadiness;
  const artifacts = auto?.artifacts;
  return {
    agentInstructions: (artifacts?.agentInstructions?.length ?? 0) > 0,
    selfVerifyTest: auto?.selfVerify?.test === true,
    testsLevel: prod?.tests?.level ?? "none",
    ciLevel: prod?.ci?.level ?? "none",
    sandbox: typeof artifacts?.sandbox === "boolean" ? artifacts.sandbox : null,
    hooks: typeof artifacts?.hooks === "boolean" ? artifacts.hooks : null,
    aiInWorkflow: auto?.aiInWorkflow === true,
    evals: artifacts?.evals ?? "none",
    migrations: prod?.delivery?.migrations ?? "none",
    enforcementVisible,
  };
}

/** Each tier's OWN predicates (T2 additionally inherits T1's, T3 inherits both — see cumulative()). */
function tierPredicates(inputs: AutonomyBlock["inputs"]): Record<Exclude<AutonomyTierId, "T0">, Predicate[]> {
  const sandboxHooksUnknown = inputs.sandbox === null && inputs.hooks === null;
  return {
    T1: [
      {
        met: inputs.agentInstructions,
        missing: "No agent instructions file. Write a human-curated CLAUDE.md / AGENTS.md so an agent starts oriented.",
      },
      {
        met: inputs.selfVerifyTest,
        missing: 'No one-command test entry point (package "test" script) an agent can run unattended.',
      },
      {
        met: testRank(inputs.testsLevel) >= testRank("partial"),
        missing: `Test suite is ${inputs.testsLevel}, and at least a partial suite is needed to check agent-authored tests, docs and refactors.`,
      },
    ],
    T2: [
      {
        met: ciRank(inputs.ciLevel) >= ciRank("gated"),
        missing: "CI does not gate merges. Protect the default branch and require status checks so an agent PR cannot bypass them.",
      },
      {
        met: testRank(inputs.testsLevel) >= testRank("substantial"),
        missing: `Test suite is ${inputs.testsLevel}, and substantial coverage is needed before delegating feature work.`,
      },
      {
        met: inputs.hooks === true || inputs.sandbox === true,
        missing: sandboxHooksUnknown
          ? SANDBOX_HOOKS_UNKNOWN
          : "No guardrail hooks (.husky / lefthook / pre-commit / .claude hooks) and no reproducible sandbox (devcontainer / Dockerfile / nix / .tool-versions).",
      },
    ],
    T3: [
      {
        met: inputs.aiInWorkflow,
        missing: "No evidence AI is used in this repo's workflow yet (no AI co-author trailers or AI-involved PRs).",
      },
      {
        met: inputs.evals !== "none",
        missing: "No eval / golden-test harness for AI output. Unattended runs need a quality bar the machine can apply.",
      },
      {
        met: inputs.migrations === "versioned",
        missing: `Migrations are ${inputs.migrations}, and schema changes need a versioned migration trail before unattended runs.`,
      },
    ],
  };
}

/** Core derivation over an explicit enforcement-visibility flag (shared by the two entry points). */
function derive(pp: AppPassport, enforcementVisible: boolean): AutonomyBlock {
  const inputs = readInputs(pp, enforcementVisible);
  const preds = tierPredicates(inputs);

  // Cumulative unmet predicates per tier (a T2 checklist includes any still-unmet T1 items).
  const cumulative: Record<Exclude<AutonomyTierId, "T0">, string[]> = {
    T1: preds.T1.filter((x) => !x.met).map((x) => x.missing),
    T2: [...preds.T1, ...preds.T2].filter((x) => !x.met).map((x) => x.missing),
    T3: [...preds.T1, ...preds.T2, ...preds.T3].filter((x) => !x.met).map((x) => x.missing),
  };

  let tier: AutonomyTierId = "T0";
  if (cumulative.T1.length === 0) tier = "T1";
  if (tier === "T1" && cumulative.T2.length === 0 && enforcementVisible) tier = "T2";
  if (tier === "T2" && cumulative.T3.length === 0) tier = "T3";

  const order: Exclude<AutonomyTierId, "T0">[] = ["T1", "T2", "T3"];
  const above = order.filter((t) => Number(t.slice(1)) > Number(tier.slice(1)));
  const unlocks = above.map((t) => ({
    tier: t,
    // The tokenless cap gates every tier above T1, so it leads those checklists explicitly.
    missing: t === "T1" || enforcementVisible ? cumulative[t] : [TOKENLESS_MISSING, ...cumulative[t]],
  }));

  return { tier, unlocks, inputs };
}

/**
 * Derive the autonomy tier at BUILD time (buildPassport): governance is the scan's live
 * branch-protection read; null means a tokenless scan → cap at T1 with an explicit missing entry.
 */
export function deriveAutonomyTier(pp: AppPassport, governance: Governance | null | undefined): AutonomyBlock {
  return derive(pp, governance != null);
}

/**
 * Derive the autonomy tier for a STORED pre-0.3.0 passport at read time (upgradePassport), where
 * the original Governance object is gone. Enforcement visibility is inferred from evidence the
 * passport itself recorded: buildPassport stamps a tokenless scan's `evidence.source` with
 * "no branch-protection visibility". Mis-inference cannot inflate the tier — T2 also requires
 * ci.level ≥ "gated", a rung a tokenless build could never have written.
 */
export function deriveAutonomyForStored(pp: AppPassport): AutonomyBlock {
  const tokenless = (pp.evidence?.source ?? "").includes("no branch-protection visibility");
  return derive(pp, !tokenless);
}
