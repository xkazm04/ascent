// Pure, shared derivations for the Registry tab. No JSX, no hooks — so the server tab, the panel and
// every sub-component read the SAME six steps, the same verdict line and the same repo tree. Hoisted
// here during the prototype round, when the second variant needed a step list: the stepper is the
// surface's spine and divergent copies of it would have been the real bug.

import type { MigrationStep, RegistryArtifact, RegistryView } from "@/lib/org/registry-view";
import { migratedTotals } from "./registryVerdict";

export type StepState = "done" | "active" | "blocked" | "pending" | "skipped";

export type RegistryStep = {
  id: "choose" | "permissions" | "scaffold" | "migrate" | "point" | "verify";
  n: number;
  title: string;
  /** One invitational line — what this step is for, in the user's terms. */
  blurb: string;
  state: StepState;
  /** The honest current reading for this step (counts, sha, PR). Never a promise. */
  detail: string;
};

export const ARTIFACTS: readonly RegistryArtifact[] = ["skills", "practices", "memory"] as const;

export const ARTIFACT_LABEL: Record<RegistryArtifact, string> = {
  skills: "Skills",
  practices: "Practices",
  memory: "Memory",
};

/** Registry-repo directory each artifact type lives in. */
export const ARTIFACT_DIR: Record<RegistryArtifact, string> = {
  skills: "skills/",
  practices: "practices/",
  memory: "memory/",
};

export const MODE_LABEL: Record<NonNullable<RegistryView["registry"]>["mode"], string> = {
  git_native: "git-native",
  hosted_mirror: "hosted mirror",
};

export const SINK_LABEL: Record<RegistryView["telemetry"]["sink"], string> = {
  api: "api",
  registry: "registry",
  off: "off",
};

export const MIGRATION_LABEL: Record<MigrationStep["state"], string> = {
  "not-started": "not started",
  "pr-open": "PR open",
  merged: "merged",
  "n/a": "hosted",
};

/** State → the one hairline/ink treatment every variant uses. Never a hand-picked hex. */
export const STEP_TONE: Record<StepState, { text: string; border: string; dot: string }> = {
  done: { text: "text-slate-200", border: "border-divider", dot: "bg-accent" },
  // `live-dot` is the app's established, already reduced-motion-gated pulse (globals.css).
  active: { text: "text-white", border: "border-accent/60", dot: "live-dot bg-accent" },
  blocked: { text: "text-slate-200", border: "border-warn/60", dot: "bg-warn" },
  pending: { text: "text-slate-500", border: "border-divider", dot: "bg-slate-700" },
  skipped: { text: "text-slate-500", border: "border-divider", dot: "bg-slate-700" },
};

export function inRegistryTotal(v: RegistryView): number {
  return v.counts.skills.registry + v.counts.practices.registry + v.counts.memory.registry;
}

// The verdict line and its two totals moved to ./registryVerdict (200-LOC cap); re-exported so callers are unchanged.
export { hostedOnlyTotal, migratedTotals, registryVerdict } from "./registryVerdict";

/**
 * The six onboarding steps, resolved against the view. Resumable by construction: each step reads its
 * own evidence, so a reload lands on the same place and a step that is already satisfied reads `done`
 * whatever order it happened in. Terminal counterpart: `.claude/skills/registry-onboarding` (same ids).
 */
export function registrySteps(v: RegistryView): RegistryStep[] {
  const mapped = v.status !== "unmapped";
  const indexed = v.status === "indexed" || v.status === "error";
  const hosted = v.registry?.mode === "hosted_mirror";
  const { moved, total } = migratedTotals(v);
  const migrateDone = total > 0 && moved >= total;
  const migrateOpen = ARTIFACTS.some((a) => v.migration[a].state === "pr-open");
  const pointingN = v.fleet.reposPointing;
  const syncedN = v.fleet.reposSynced30d;
  const pointing = typeof pointingN === "number" && pointingN > 0;
  const verified = indexed && !!v.registry?.catalogSha && typeof syncedN === "number" && syncedN > 0 && v.telemetry.invokes30d > 0;
  // Self-hosted pairing: the checkout is the read source, so the App steps are OPTIONAL, not blocking.
  const local = v.registry?.localPath ?? null;
  const appOptional = !!local && !v.permission.contentsWrite;

  const step = (
    id: RegistryStep["id"],
    n: number,
    title: string,
    blurb: string,
    state: StepState,
    detail: string,
  ): RegistryStep => ({ id, n, title, blurb, state, detail });

  return [
    step(
      "choose",
      1,
      "Choose the registry",
      "Pair a local checkout, create a new repo, map one you already have, or stay hosted. All are real answers.",
      mapped ? "done" : "active",
      local ? `${v.registry!.fullName} · paired locally at ${local}` : v.registry ? `${v.registry.fullName} · ${v.registry.canonical ? "canonical" : "secondary"} · ${MODE_LABEL[v.registry.mode]}` : `${v.candidates.length} installed repo${v.candidates.length === 1 ? "" : "s"} available to map`,
    ),
    step(
      "permissions",
      2,
      "Grant contents:write",
      "Ascent opens pull requests against the registry; it never pushes to your fleet.",
      v.permission.contentsWrite ? "done" : appOptional ? "skipped" : mapped ? "blocked" : "pending",
      v.permission.contentsWrite ? "GitHub App holds contents:write" : appOptional ? "Optional — the local checkout needs no GitHub App; connect one only for pull requests" : "The App cannot write to this repo yet",
    ),
    step(
      "scaffold",
      3,
      "Scaffold the layout",
      "One PR adds README, .ascent/registry.yaml, CODEOWNERS and the three artifact folders.",
      indexed ? "done" : v.status === "scaffold_pr_open" ? "active" : v.status === "scaffolding" ? "active" : "pending",
      v.status === "scaffold_pr_open"
        ? "PR open — waiting on a CODEOWNER merge"
        : indexed
          ? `Indexed at ${shortSha(v.registry?.lastIndexSha)}`
          : "Not opened yet",
    ),
    step(
      "migrate",
      4,
      "Move Skills, Practices, Memory",
      "One PR per artifact type, so review stays readable. Nothing is deleted from ascent until it merges.",
      hosted ? "skipped" : migrateDone || (appOptional && total === 0) ? "done" : appOptional ? "skipped" : migrateOpen || indexed ? "active" : "pending",
      hosted ? "Not applicable in hosted mirror mode" : appOptional && total > moved ? `${moved}/${total} moved · the rest opens PRs, which needs the optional GitHub App` : `${moved}/${total} moved`,
    ),
    step(
      "point",
      5,
      "Point the fleet",
      "Each repo names its registry in .ai/manifest.yaml — or a developer just runs the sync command.",
      pointing && typeof pointingN === "number" && pointingN >= v.fleet.reposTotal ? "done" : pointing ? "active" : indexed ? "active" : "pending",
      typeof pointingN === "number" ? `${pointingN}/${v.fleet.reposTotal} repos carry the pointer` : "Not measured yet: no sweep has read the fleet's pointers",
    ),
    step(
      "verify",
      6,
      "Verify the loop",
      "First catalog.json written, first repo synced, first invoke recorded. Then it runs itself.",
      verified ? "done" : indexed ? "active" : "pending",
      indexed
        ? `catalog ${v.registry?.catalogSha ? "written" : "pending"} · ${typeof syncedN === "number" ? `${syncedN} synced` : "sync unmeasured"} · ${v.telemetry.invokes30d.toLocaleString()} invokes`
        : "Nothing to verify yet",
    ),
  ];
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

// The repo-as-file-map derivation moved to ./registryTree (200-LOC cap); re-exported so callers are unchanged.
export { registryTree, type TreeNode } from "./registryTree";
