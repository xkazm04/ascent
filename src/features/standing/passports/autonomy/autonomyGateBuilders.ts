// The five per-gate derivations behind the Autonomy Passport, extracted from autonomyModel.ts (which
// composes them in `deriveAutonomy`). Each gate declares its own `source` — "scan" when it reads
// observed passport fields, "derived" when it is a proxy assembled from adjacent ones, "mock" when the
// scan does not measure the named thing at all. Read autonomyModel.ts's header for the full contract.

import type { AppPassport } from "@/lib/types";

import { CI_RANK, SEC_RANK, TEST_RANK, hashUnit, statusOf, type AutonomyGate } from "./autonomyGates";

export function testsGate(pp: AppPassport): AutonomyGate {
  const t = pp.productionReadiness.tests;
  const sv = pp.automationReadiness.selfVerify;
  const ladder = (Math.max(0, TEST_RANK.indexOf(t.level)) / 4) * 70;
  const loop = (sv.test ? 20 : 0) + (t.criticalPathCovered ? 10 : 0);
  const score = Math.round(Math.min(100, ladder + loop));
  const cov = t.coveragePct != null ? `${t.coveragePct}% coverage` : "coverage unreported";
  return {
    id: "tests",
    label: "Test loop",
    short: "TESTS",
    status: statusOf(score),
    score,
    evidence: `${t.level} suite · ${cov}${sv.test ? " · agent-runnable test command" : " · no discoverable test command"}`,
    action: !sv.test
      ? "Publish a one-command test entry point an agent can run unattended."
      : t.criticalPathCovered
        ? "Raise the suite from " + t.level + " toward comprehensive on the critical path."
        : "Cover the critical path. An agent cannot self-check what is untested.",
    source: "scan",
    gatesTier: 1,
  };
}

export function ciGate(pp: AppPassport, protectedBranch: boolean | undefined): AutonomyGate {
  const ci = pp.productionReadiness.ci;
  const ladder = (Math.max(0, CI_RANK.indexOf(ci.level)) / 5) * 65;
  const gateBonus = Math.min(20, ci.gates.length * 7);
  const prot = protectedBranch === true ? 15 : 0;
  const score = Math.round(Math.min(100, ladder + gateBonus + prot));
  return {
    id: "ci",
    label: "CI gates",
    short: "CI",
    status: statusOf(score),
    score,
    evidence: `${ci.level}${ci.provider ? ` on ${ci.provider}` : " · no provider detected"} · ${
      ci.gates.length ? `${ci.gates.length} required check${ci.gates.length === 1 ? "" : "s"}` : "no required checks"
    }${protectedBranch === true ? " · branch protected" : protectedBranch === false ? " · branch unprotected" : ""}`,
    action:
      ci.level === "none"
        ? "Add CI that runs on every PR: the machine review agent output depends on it."
        : protectedBranch !== true
          ? "Protect the default branch so an agent PR cannot bypass the checks."
          : "Promote checks to required status gates on the default branch.",
    source: "scan",
    gatesTier: 2,
  };
}

/** REAL when the passport carries the 0.3.0 `sandbox` detector boolean (devcontainer / Dockerfile /
 *  nix / .tool-versions from the tree index). Pre-0.3.0 passports fall back to the DERIVED PROXY:
 *  delivery discipline (IaC, rollback, versioned migrations) + a declared package manager. */
export function sandboxGate(pp: AppPassport): AutonomyGate {
  const d = pp.productionReadiness.delivery;
  const pm = pp.stack.packageManager;
  const detected = pp.automationReadiness.artifacts.sandbox;
  if (typeof detected === "boolean") {
    const score = detected ? 85 : 12;
    return {
      id: "sandbox",
      label: "Reproducible sandbox",
      short: "SNDBX",
      status: statusOf(score),
      score,
      evidence: detected
        ? "environment definition committed (devcontainer / Dockerfile / nix / .tool-versions)"
        : "no devcontainer / Dockerfile / nix / .tool-versions in the tree",
      action: detected
        ? "Give the agent a disposable environment it can break without consequence."
        : "Check an environment definition into the repo (devcontainer or Dockerfile).",
      source: "scan",
      gatesTier: 2,
    };
  }
  const score = Math.round(
    Math.min(100, (d.iac ? 35 : 0) + (d.rollback ? 20 : 0) + (d.migrations === "versioned" ? 25 : d.migrations === "scripted" ? 12 : 0) + (pm ? 20 : 0)),
  );
  const bits = [
    d.iac ? "infrastructure-as-code" : "no IaC",
    d.rollback ? "rollback path" : "no rollback path",
    `${d.migrations} migrations`,
    pm ? `${pm} lockfile` : "no declared package manager",
  ];
  return {
    id: "sandbox",
    label: "Reproducible sandbox",
    short: "SNDBX",
    status: statusOf(score),
    score,
    evidence: bits.join(" · "),
    action: !pm
      ? "Declare a package manager + lockfile so an agent's environment matches CI's."
      : !d.iac
        ? "Check the environment definition into the repo (devcontainer or IaC)."
        : "Give the agent a disposable environment it can break without consequence.",
    source: "derived",
    gatesTier: 2,
  };
}

/** ⚠️ PART SCAN, PART MOCK. Presence of AGENTS.md/CLAUDE.md, the context graph, the manifest and
 *  memory/skills grades ARE observed. FRESHNESS (the research's sharpest finding — quality over
 *  presence) is NOT: the scan records no "last edited vs repo change rate" for context files. */
export function contextGate(pp: AppPassport, conformance: number | null, key: string): AutonomyGate {
  const a = pp.automationReadiness.artifacts;
  const files = a.agentInstructions.length;
  const graph = a.contextGraph === "full" ? 25 : a.contextGraph === "partial" ? 12 : 0;
  const grade = (g: string) => (g === "governed" ? 12 : g === "curated" ? 8 : g === "adhoc" ? 4 : 0);
  const observed = Math.min(100, Math.min(30, files * 15) + graph + (a.manifest ? 10 : 0) + grade(a.memory) + grade(a.skills) + (conformance != null ? Math.round(conformance * 0.11) : 0));
  // MOCK: staleness penalty. Replace with a real freshness signal (see DATA_MODEL_GAPS).
  const staleDays = Math.round(hashUnit(key + ":ctx") * 210);
  const stalePenalty = files === 0 ? 0 : Math.min(25, Math.floor(staleDays / 12));
  const score = Math.round(Math.max(0, observed - stalePenalty));
  return {
    id: "context",
    label: "Context contract",
    short: "AGENTS",
    status: statusOf(score),
    score,
    evidence: `${files ? a.agentInstructions.join(", ") : "no AGENTS.md / CLAUDE.md"} · ${a.contextGraph} context graph${
      a.manifest ? " · .ai manifest" : ""
    } · last touched ~${staleDays}d ago (mock)`,
    action:
      files === 0
        ? "Write a human-curated AGENTS.md. LLM-generated context files measurably hurt."
        : stalePenalty > 12
          ? "Refresh the context file; it has drifted behind the repo's change rate."
          : "Deepen the context graph so an unattended run starts oriented.",
    source: files === 0 ? "scan" : "mock",
    gatesTier: 3,
  };
}

/** REAL when the passport carries the 0.3.0 `hooks` detector boolean (.husky / lefthook /
 *  .pre-commit-config, or a `hooks` block in .claude/settings.json). Pre-0.3.0 passports fall back
 *  to the MOCK: lint/typecheck self-verify + security posture with a hashed hook-presence bit. */
export function hooksGate(pp: AppPassport, key: string): AutonomyGate {
  const sv = pp.automationReadiness.selfVerify;
  const sec = pp.productionReadiness.security;
  const base = (sv.lint ? 22 : 0) + (sv.typecheck ? 22 : 0) + (Math.max(0, SEC_RANK.indexOf(sec.level)) / 4) * 36;
  const detected = pp.automationReadiness.artifacts.hooks;
  // Pre-0.3.0 fallback MOCK: whether a hook config exists in the repo.
  const hooked = typeof detected === "boolean" ? detected : hashUnit(key + ":hooks") > 0.55;
  const real = typeof detected === "boolean";
  const score = Math.round(Math.min(100, base + (hooked ? 20 : 0)));
  return {
    id: "hooks",
    label: "Guardrails & hooks",
    short: "HOOKS",
    status: statusOf(score),
    score,
    evidence: `${sv.lint ? "lint" : "no lint"} · ${sv.typecheck ? "typecheck" : "no typecheck"} · ${sec.level} security${
      hooked ? ` · pre-commit hooks${real ? "" : " (mock)"}` : ` · no hook config${real ? "" : " (mock)"}`
    }`,
    action: !sv.typecheck
      ? "Add a typecheck an agent must pass before it can push."
      : !hooked
        ? "Install pre-commit/pre-push hooks so guardrails run without a reviewer present."
        : "Scope the agent's tool allow-list and no-AI paths explicitly.",
    source: real ? "scan" : "mock",
    gatesTier: 3,
  };
}
