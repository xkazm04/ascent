// Pure, shared derivations for the Registry tab. No JSX, no hooks — so the server tab, the panel and
// every sub-component read the SAME six steps, the same verdict line and the same repo tree. Hoisted
// here during the prototype round, when the second variant needed a step list: the stepper is the
// surface's spine and divergent copies of it would have been the real bug.

import type { MigrationStep, RegistryArtifact, RegistryView } from "@/lib/org/registry-view";

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

export function migratedTotals(v: RegistryView): { moved: number; total: number } {
  return ARTIFACTS.reduce(
    (acc, a) => ({ moved: acc.moved + v.migration[a].moved, total: acc.total + v.migration[a].total }),
    { moved: 0, total: 0 },
  );
}

export function inRegistryTotal(v: RegistryView): number {
  return v.counts.skills.registry + v.counts.practices.registry + v.counts.memory.registry;
}

export function hostedOnlyTotal(v: RegistryView): number {
  return v.counts.skills.hostedOnly + v.counts.practices.hostedOnly + v.counts.memory.hostedOnly;
}

/** The one-line honest summary the masthead/verdict slot shows in every variant. */
export function registryVerdict(v: RegistryView): string {
  if (v.status === "unmapped") {
    const n = hostedOnlyTotal(v);
    return n === 0
      ? "Hosted only — nothing in a registry yet, and nothing to move."
      : `Hosted only — ${n} artifact${n === 1 ? "" : "s"} live in ascent's tables, nothing in a registry yet.`;
  }
  if (v.status === "scaffolding") return "Scaffolding the registry layout.";
  if (v.status === "scaffold_pr_open") return "Scaffold PR is open — a CODEOWNER merge turns it into your registry.";
  if (v.status === "error") return v.error?.message ?? "The last index attempt failed.";
  if (v.registry?.mode === "hosted_mirror") return "Hosted mirror — ascent stays the writer; the repo is a read-only copy.";
  const { moved, total } = migratedTotals(v);
  const behind = v.fleet.adoption.stale + v.fleet.adoption.diverged;
  const tail = behind > 0 ? ` · ${behind} repo${behind === 1 ? "" : "s"} behind the catalog` : " · every pointing repo in sync";
  return `${moved}/${total} artifacts in the registry · ${v.fleet.reposPointing}/${v.fleet.reposTotal} repos pointing${tail}`;
}

/**
 * The six onboarding steps, resolved against the view. Resumable by construction: each step reads its
 * own evidence, so a reload lands on the same place and a step that is already satisfied reads `done`
 * whatever order it happened in.
 */
export function registrySteps(v: RegistryView): RegistryStep[] {
  const mapped = v.status !== "unmapped";
  const indexed = v.status === "indexed" || v.status === "error";
  const hosted = v.registry?.mode === "hosted_mirror";
  const { moved, total } = migratedTotals(v);
  const migrateDone = total > 0 && moved >= total;
  const migrateOpen = ARTIFACTS.some((a) => v.migration[a].state === "pr-open");
  const pointing = v.fleet.reposPointing > 0;
  const verified = indexed && !!v.registry?.catalogSha && v.fleet.reposSynced30d > 0 && v.telemetry.invokes30d > 0;

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
      "Create a new repo, map one you already have, or stay hosted. All three are real answers.",
      mapped ? "done" : "active",
      v.registry ? `${v.registry.fullName} · ${v.registry.canonical ? "canonical" : "secondary"} · ${MODE_LABEL[v.registry.mode]}` : `${v.candidates.length} installed repo${v.candidates.length === 1 ? "" : "s"} available to map`,
    ),
    step(
      "permissions",
      2,
      "Grant contents:write",
      "Ascent opens pull requests against the registry; it never pushes to your fleet.",
      v.permission.contentsWrite ? "done" : mapped ? "blocked" : "pending",
      v.permission.contentsWrite ? "GitHub App holds contents:write" : "The App cannot write to this repo yet",
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
      hosted ? "skipped" : migrateDone ? "done" : migrateOpen ? "active" : indexed ? "active" : "pending",
      hosted ? "Not applicable in hosted mirror mode" : `${moved}/${total} moved`,
    ),
    step(
      "point",
      5,
      "Point the fleet",
      "Each repo names its registry in .ai/manifest.yaml — or a developer just runs the sync command.",
      pointing && v.fleet.reposPointing >= v.fleet.reposTotal ? "done" : pointing ? "active" : indexed ? "active" : "pending",
      `${v.fleet.reposPointing}/${v.fleet.reposTotal} repos carry the pointer`,
    ),
    step(
      "verify",
      6,
      "Verify the loop",
      "First catalog.json written, first repo synced, first invoke recorded. Then it runs itself.",
      verified ? "done" : indexed ? "active" : "pending",
      indexed
        ? `catalog ${v.registry?.catalogSha ? "written" : "pending"} · ${v.fleet.reposSynced30d} synced · ${v.telemetry.invokes30d.toLocaleString()} invokes`
        : "Nothing to verify yet",
    ),
  ];
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** The registry repo rendered as a file map — the identified panel's spine. */
export type TreeNode = { path: string; kind: "dir" | "file"; count?: number; note: string; generated?: boolean };

export function registryTree(v: RegistryView): TreeNode[] {
  const c = v.counts;
  return [
    { path: ".ascent/registry.yaml", kind: "file", note: v.registry ? `${MODE_LABEL[v.registry.mode]} · telemetry ${SINK_LABEL[v.registry.telemetrySink]}` : "mode + policies" },
    { path: "catalog.json", kind: "file", count: inRegistryTotal(v), note: v.registry?.catalogSha ? `sha ${shortSha(v.registry.catalogSha)}` : "not written yet", generated: true },
    { path: "skills/", kind: "dir", count: c.skills.registry, note: c.skills.hostedOnly > 0 ? `${c.skills.hostedOnly} still hosted` : "SKILL.md + LESSONS.md" },
    { path: "practices/", kind: "dir", count: c.practices.registry, note: c.practices.hostedOnly > 0 ? `${c.practices.hostedOnly} still hosted` : "PRACTICE.md + starter/" },
    { path: "memory/", kind: "dir", count: c.memory.registry, note: c.memory.hostedOnly > 0 ? `${c.memory.hostedOnly} still hosted` : "notes + _index.md" },
    { path: "telemetry/", kind: "dir", count: v.telemetry.reposReporting, note: v.telemetry.sink === "registry" ? "counts committed here" : `sink is ${SINK_LABEL[v.telemetry.sink]}` },
    { path: "CODEOWNERS", kind: "file", note: "merging = adopting" },
  ];
}

