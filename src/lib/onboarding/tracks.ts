// Turn a ScanReport into an ordered set of onboarding TRACKS — the spine of the generated
// onboarding skill. A track is one weak dimension expressed as: why it matters for agent
// autonomy, the concrete CONTROL to create/extend, and — crucially — WHERE that control belongs.
//
// Control placement is the design thesis: a CI gate fires AFTER a branch is pushed, which is too
// late (a leaked secret has already left the machine; a failed gate is a wasted round-trip). In an
// LLM-driven workflow the agent is the FIRST line of control, so most controls become a checklist
// the agent self-runs BEFORE pushing (agent guidance + local hooks + verify-before-propose). CI is
// a thin backstop for the few hard passes that genuinely need a remote, clean-room, or full-tree
// environment (SAST, the merge gate). Each track declares both layers — and its deliverable points
// at the real control file/hook, not a doc-shaped placeholder — so work lands in the right place.
//
// Pure and deterministic (no LLM, no I/O) so it is unit-testable and reused by the keyless path.

import type { DimensionId, Effort, Impact, ScanReport } from "@/lib/types";
import { PRACTICES, type PracticeDef } from "@/lib/practices";
import { commandsFor, type LangCommands } from "@/lib/practice-artifact";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import { IMPACT_RANK } from "@/lib/scoring/impact";

/** Where a control is primarily enforced. */
export type ControlLayer = "pre-push" | "ci-hard-pass" | "both";

/** The per-dimension control placement — the reusable shape, independent of any one repo. */
interface ControlSpec {
  /** One line: what adopting this lets agents do safely. */
  autonomyUnlock: string;
  primaryLayer: ControlLayer;
  /** The concrete control to create or extend — the real file/hook, not a doc-shaped placeholder. */
  deliverable: { path: string; summary: string };
  /** Controls the agent self-runs locally BEFORE pushing (the primary surface). */
  prePushChecklist: string[];
  /** The minimal non-negotiables that stay in CI (clean-room / full-tree / merge gate). */
  ciHardPasses: string[];
  /** Definition of done, authored pre-push-first so the checklist matches the control model. */
  definitionOfDone: string[];
  /** Fallback impact/effort when the scan's roadmap doesn't carry one for this dimension. */
  defaultImpact: Impact;
  defaultEffort: Effort;
}

/** A single onboarding track, ready to render into the skill. */
export interface OnboardingTrack {
  id: string; // practice id, e.g. "agent-in-loop"
  dimId: DimensionId;
  dimName: string;
  title: string; // practice label
  /** Current blended dimension score (baked from the scan), 0..100. */
  score: number;
  autonomyUnlock: string;
  /** Why this gap matters — from the scan's roadmap rationale when present, else dimension gaps. */
  why: string;
  /** Concrete gaps the scan found for this dimension. */
  gaps: string[];
  /** The concrete control to create/extend (path + one-line purpose). */
  deliverable: { path: string; summary: string };
  primaryLayer: ControlLayer;
  prePushChecklist: string[];
  ciHardPasses: string[];
  /** Definition of done — pre-push controls first, CI backstops last. */
  definitionOfDone: string[];
  impact: Impact;
  effort: Effort;
  /** Invitational questions to explore the gap (from the roadmap), inputs not directives. */
  explore: string[];
  levelUnlock?: string;
}

// Per-dimension control placement. Reads as a matrix: most rows lead with a pre-push checklist and
// keep CI to the genuine hard passes — the shift-left model the skill teaches by example. The
// `deliverable` is the actual control to create/extend; the `definitionOfDone` is ordered
// pre-push-first so it never contradicts that model.
const CONTROL: Record<DimensionId, ControlSpec> = {
  D1: {
    autonomyUnlock: "Agents act correctly the first time — they read the repo's rules instead of guessing.",
    primaryLayer: "pre-push",
    deliverable: {
      path: "CLAUDE.md / AGENTS.md",
      summary: "the agent's pre-push checklist host — commands, architecture map, never/always constraints",
    },
    prePushChecklist: [
      "Build/test/lint/run commands are documented verbatim so an agent can copy them",
      "Architecture map (entry points, key modules, data flow) so an agent edits the right place",
      "A 'verify after every change' rule is encoded — run tests + typecheck before proposing a diff",
      "Explicit never/always constraints (security, public API, conventions) are written down",
    ],
    ciHardPasses: ["None — this is the checklist that feeds every other layer, not a CI gate."],
    definitionOfDone: [
      "Build/test/lint/run commands documented so an agent can copy them",
      "Architecture map + explicit never/always constraints written down",
      "A 'verify after every change' rule encoded in the guidance",
      "One or two worked examples of a good change",
    ],
    defaultImpact: "high",
    defaultEffort: "low",
  },
  D2: {
    autonomyUnlock: "Agent-written code is safe to merge because tests catch regressions before a human looks.",
    primaryLayer: "both",
    deliverable: {
      path: "coverage config + a coverage step in your existing hook, with a CI floor",
      summary: "make coverage visible to the agent locally, then enforce a minimum as a CI backstop",
    },
    prePushChecklist: [
      "The full suite runs locally with one command before every push",
      "Coverage delta is visible to the agent — a change that drops coverage is flagged, not silently shipped",
      "Every behavioral change ships with a test that would fail without it",
    ],
    ciHardPasses: [
      "Coverage floor enforced as a hard gate (merge blocked below the threshold)",
      "Full suite green on a clean checkout",
    ],
    definitionOfDone: [
      "Every behavioral change ships with a test (local norm)",
      "Coverage is visible locally and checked before push",
      "One-command test run wired into the local hook",
      "CI enforces a coverage floor as the backstop",
    ],
    defaultImpact: "high",
    defaultEffort: "medium",
  },
  D3: {
    autonomyUnlock: "A declarative, reversible path to prod an agent could safely drive end-to-end.",
    primaryLayer: "both",
    deliverable: {
      path: ".github/workflows/ci.yml (merge gate) + local pre-push checks",
      summary: "the same lint/typecheck/test checks run locally before push and enforced on merge",
    },
    prePushChecklist: [
      "Lint + typecheck + tests pass locally before push (same checks CI will run)",
      "Infra/config changes are previewed locally (plan/diff) before they reach the pipeline",
    ],
    ciHardPasses: [
      "Merges blocked until checks pass (the hard gate)",
      "Release + deploy automation runs only from the protected branch",
    ],
    definitionOfDone: [
      "Lint + typecheck + tests pass locally before push",
      "Merges blocked until checks pass (CI hard gate)",
      "Fast CI feedback (cached deps, parallel jobs)",
    ],
    defaultImpact: "high",
    defaultEffort: "medium",
  },
  D4: {
    autonomyUnlock: "Agents take the first pass on review/triage/fix; humans confirm at the policy level, not line-by-line.",
    primaryLayer: "both",
    deliverable: {
      path: "a 'PR self-review' checklist in CLAUDE.md/AGENTS.md (+ optional .github/workflows/ai-review.yml backstop)",
      summary: "the agent reviews its own diff locally first; a CI AI-review only backstops it",
    },
    prePushChecklist: [
      "The agent runs a self-review pass against a written checklist before opening a PR (diff size, test coverage of the change, security-sensitive edits, public-API changes)",
      "Dependency bumps are read by the agent (changelog / breaking changes) before push — never blind auto-merge",
    ],
    ciHardPasses: [
      "An optional AI-review backstop comments on the PR (suggests, never auto-merges)",
      "A human-confirmation checkpoint before merge stays mandatory",
    ],
    definitionOfDone: [
      "The agent self-reviews against a written PR checklist before push",
      "Dependency bumps are evaluated by the agent, not blind-merged",
      "A human-confirmation checkpoint before merge is preserved",
      "Optional: an AI-review step comments on the PR as a backstop",
    ],
    defaultImpact: "high",
    defaultEffort: "medium",
  },
  D5: {
    autonomyUnlock: "Agents read why, not just what — they don't re-litigate or unknowingly undo a decision.",
    primaryLayer: "pre-push",
    deliverable: {
      path: "docs/adr/ (an ADR trail) + a /docs entry point",
      summary: "architecture-changing PRs add an ADR; agents onboard from a current entry point",
    },
    prePushChecklist: [
      "A change that alters architecture updates or adds an ADR in the same PR",
      "The /docs entry point is current enough for an agent to onboard from cold",
    ],
    ciHardPasses: ["None — keep docs a pre-push norm, not a merge blocker."],
    definitionOfDone: [
      "Architecture-changing PRs update or add an ADR (local norm)",
      "A /docs entry point an agent can onboard from cold",
      "ADRs capture why, not just what",
    ],
    defaultImpact: "medium",
    defaultEffort: "low",
  },
  D6: {
    autonomyUnlock: "Conventions are held by tooling, so agent output stays consistent without a human policing style.",
    primaryLayer: "pre-push",
    deliverable: {
      path: "your lefthook/husky config + .github/pull_request_template.md",
      summary: "lint/format/typecheck on staged files locally; a Definition-of-Done in the PR template",
    },
    prePushChecklist: [
      "Lint + format run on staged files (pre-commit) and typecheck on the whole diff (pre-push)",
      "The PR template's Definition-of-Done is self-attested by the agent before the PR opens",
    ],
    ciHardPasses: ["Lint + typecheck backstop on the merge gate (confirms what ran locally)."],
    definitionOfDone: [
      "Linter + formatter + strict types run on staged files locally",
      "Pre-commit/pre-push hooks enforce them",
      "A PR template carries the Definition-of-Done",
      "CI backstops lint/typecheck on the merge gate",
    ],
    defaultImpact: "medium",
    defaultEffort: "low",
  },
  D7: {
    autonomyUnlock: "Attributable history shows where agents helped and gives automation reliable signals.",
    primaryLayer: "pre-push",
    deliverable: {
      path: "a commit-msg hook (commitlint) + a Co-Authored-By convention",
      summary: "conventional-commit format validated locally; AI work attributed in the trailer",
    },
    prePushChecklist: [
      "Conventional-commit format is validated locally (commit-msg hook)",
      "AI-assisted changes carry a Co-Authored-By trailer",
      "PRs stay small and focused so review is cheap",
    ],
    ciHardPasses: ["Commit-lint backstop on the PR (confirms the local hook)."],
    definitionOfDone: [
      "Conventional-commit format validated locally (commit-msg hook)",
      "AI-assisted commits carry a Co-Authored-By trailer",
      "Small, focused PRs",
      "Commit-lint backstop on the PR",
    ],
    defaultImpact: "low",
    defaultEffort: "low",
  },
  D8: {
    autonomyUnlock: "Agent output is trustworthy and repeatable — verified by evals, not vibes.",
    primaryLayer: "both",
    deliverable: {
      path: "an evals/ harness using your existing test runner (or promptfoo) + a pre-push eval job on changed prompts",
      summary: "golden/contract tests the agent runs locally on changed prompts/agents; CI re-runs as backstop",
    },
    prePushChecklist: [
      "Evals / golden tests run locally on any changed prompt, agent spec, or LLM-facing code before push",
      "Recurring agent tasks follow a runbook the agent reads — not ad-hoc prompting",
      "A versioned prompt/agent library is the single source of truth the agent reuses",
    ],
    ciHardPasses: ["Evals run in CI when prompts/agents change (backstop for the local run)."],
    definitionOfDone: [
      "Evals/golden tests run locally on changed prompts before push",
      "A versioned prompt/agent library the agent reuses",
      "Runbooks for recurring agent tasks",
      "CI re-runs evals when prompts/agents change (backstop)",
    ],
    defaultImpact: "high",
    defaultEffort: "high",
  },
  D9: {
    autonomyUnlock: "Agent-written code can't leak a secret or pull a vulnerable dep — caught before it ever leaves the machine.",
    primaryLayer: "both",
    deliverable: {
      path: "a gitleaks hook (pre-commit) + .github/workflows/codeql.yml (full-tree SAST)",
      summary: "secret scan blocks locally before push; SAST runs in CI as a clean-room hard gate",
    },
    prePushChecklist: [
      "Secret scan (gitleaks) runs pre-commit/pre-push — a secret is blocked before it leaves the machine (CI catching it is already a leak)",
      "Dependency audit (npm audit / cargo deny) runs pre-push before any new dependency is added",
      "New deps are justified (provenance, maintenance) in the PR",
    ],
    ciHardPasses: [
      "SAST on the full tree (CodeQL/Semgrep) as a hard merge gate — needs a clean-room full build",
      "Scheduled SCA + SBOM generation",
      "Signed, attested release artifacts (cosign/SLSA)",
    ],
    definitionOfDone: [
      "Secret scan runs pre-commit (before anything leaves the box)",
      "Dependency audit runs pre-push before adding deps",
      "Full-tree SAST as a CI hard gate (CodeQL/Semgrep)",
      "SBOM + signed/attested artifacts on release",
    ],
    defaultImpact: "high",
    defaultEffort: "medium",
  },
};

const PRACTICE_BY_DIM: Record<DimensionId, PracticeDef | undefined> = Object.fromEntries(
  PRACTICES.map((p) => [p.dimId, p]),
) as Record<DimensionId, PracticeDef | undefined>;

/** A dimension at or above this blended score is treated as a strength, not an onboarding gap. */
export const WEAK_THRESHOLD = 70;

// Effort ranking is INVERTED vs the roadmap's (here lower effort = higher leverage), so it stays local.
const EFFORT_RANK: Record<Effort, number> = { low: 3, medium: 2, high: 1 };

/** Leverage = impact (weighted) + ease. Higher sorts first. */
function leverage(t: OnboardingTrack): number {
  return (IMPACT_RANK[t.impact] ?? 0) * 2 + EFFORT_RANK[t.effort];
}

type CiKind = LangCommands["ci"];

// Coverage commands aren't in commandsFor (which is generic build/test), so map them here, keyed by
// the same CI-family discriminant commandsFor returns.
// No markdown backticks here: skill.ts already renders the whole deliverable path as one code span,
// so inner backticks would create broken nested spans.
const COVERAGE: Record<CiKind, string> = {
  node: "vitest --coverage thresholds in vitest.config (or jest coverageThreshold)",
  python: "pytest --cov with --cov-fail-under in pyproject.toml",
  go: "go test -coverprofile + a coverage-threshold check",
  rust: "cargo llvm-cov (or tarpaulin) with a min-coverage threshold",
  generic: "a coverage threshold for your test runner",
};

const CI_SETUP: Record<CiKind, string> = {
  node: "setup-node",
  python: "setup-python",
  go: "setup-go",
  rust: "rust-toolchain",
  generic: "the language setup step",
};

/**
 * Language-aware deliverable for the dimensions whose concrete control depends on the stack — D2
 * (coverage runner) and D3 (CI setup + commands). Returns null to fall back to the static,
 * language-agnostic control when the stack is unknown (so we don't emit `<run tests>` placeholders).
 */
function langDeliverable(
  dimId: DimensionId,
  language?: string | null,
): { path: string; summary: string } | null {
  if (dimId !== "D2" && dimId !== "D3") return null;
  const cmd = commandsFor(language);
  if (cmd.ci === "generic") return null; // unknown stack → keep the nicer generic static text
  // Only the `path` is language-aware; the `summary` is the same promise as the static control, so
  // pull it from the source of truth (CONTROL) rather than re-stating the literal — editing the D2/D3
  // summary in CONTROL now flows into the language-aware path too, which is the common case.
  if (dimId === "D2") {
    return {
      path: `${COVERAGE[cmd.ci]} + a coverage step in your existing hook, with a CI floor`,
      summary: CONTROL.D2.deliverable.summary,
    };
  }
  return {
    path: `.github/workflows/ci.yml (${CI_SETUP[cmd.ci]} → ${cmd.install} → ${cmd.lint} → ${cmd.test}) gated on merge + the same checks pre-push`,
    summary: CONTROL.D3.deliverable.summary,
  };
}

export interface SelectOpts {
  /** Force this exact set of dimensions (the maintainer's multiselect), bypassing the weak filter. */
  include?: DimensionId[];
  /** Cap the number of tracks (highest leverage kept). */
  max?: number;
}

/**
 * Select onboarding tracks for a report. By default this picks the dimensions the repo is weak on
 * (blended score < WEAK_THRESHOLD) so the skill is individual — strengths are celebrated, not
 * re-litigated. Pass `include` to force a specific set (a maintainer's chosen practices), which can
 * surface a refinement on an otherwise-strong dimension (e.g. coverage gates on a big test suite).
 */
export function selectTracks(report: ScanReport, opts: SelectOpts = {}): OnboardingTrack[] {
  const byId = new Map(report.dimensions.map((d) => [d.id, d]));
  const ids: DimensionId[] = opts.include
    ? opts.include.filter((id) => byId.has(id))
    : report.dimensions.filter((d) => d.score < WEAK_THRESHOLD).map((d) => d.id);

  const tracks: OnboardingTrack[] = [];
  for (const id of ids) {
    const dim = byId.get(id);
    const practice = PRACTICE_BY_DIM[id];
    const control = CONTROL[id];
    if (!dim || !practice || !control) continue;

    const rec = report.roadmap.find((r) => r.dimension === id);
    tracks.push({
      id: practice.id,
      dimId: id,
      dimName: DIMENSION_BY_ID[id]?.name ?? dim.name,
      title: practice.label,
      score: dim.score,
      autonomyUnlock: control.autonomyUnlock,
      why: rec?.rationale?.trim() || dim.summary?.trim() || practice.what,
      gaps: dim.gaps ?? [],
      deliverable: langDeliverable(id, report.repo.primaryLanguage) ?? control.deliverable,
      primaryLayer: control.primaryLayer,
      prePushChecklist: control.prePushChecklist,
      ciHardPasses: control.ciHardPasses,
      definitionOfDone: control.definitionOfDone,
      impact: rec?.impact ?? control.defaultImpact,
      effort: rec?.effort ?? control.defaultEffort,
      explore: rec?.explore ?? [],
      levelUnlock: rec?.levelUnlock,
    });
  }

  tracks.sort((a, b) => leverage(b) - leverage(a));
  return opts.max ? tracks.slice(0, opts.max) : tracks;
}
