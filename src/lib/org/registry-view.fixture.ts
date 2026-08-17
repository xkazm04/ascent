// Fixture `RegistryView`s for the Registry tab's prototype round, selected by `?demo=<state>`.
//
// The real loader (registry-view.ts) can only honestly report `unmapped` until the OrgRegistry table +
// indexer land (R2), so every rich state the three variants must render — the indexed dashboard, a
// scaffold PR waiting on a merge, a migration half-done, an index error, hosted-mirror mode, a missing
// App permission — comes from here. Pure data, no imports beyond the types: safe on the server and in
// a client component.
//
//   ?demo=indexed          the registry dashboard, healthy
//   ?demo=scaffold_pr_open the scaffold PR is open, waiting on a CODEOWNER merge
//   ?demo=migrating        indexed, skills merged, practices PR open, memory not started
//   ?demo=error            indexed once, last index attempt failed
//   ?demo=hosted           hosted-mirror mode (ascent writes, git mirrors) — the "stay hosted" path
//   ?demo=no-permission    unmapped, App lacks contents:write, candidate repos offered
//   ?demo=unmapped         the empty onboarding stepper, with a candidate list

import {
  DEFAULT_REGISTRY_NAME,
  registryHowTo,
  type RegistryActivityEntry,
  type RegistryCandidate,
  type RegistryView,
} from "./registry-view";

export const REGISTRY_DEMO_STATES = [
  "unmapped",
  "no-permission",
  "scaffold_pr_open",
  "indexed",
  "migrating",
  "error",
  "hosted",
] as const;

export type RegistryDemoState = (typeof REGISTRY_DEMO_STATES)[number];

function isDemoState(v: string | undefined): v is RegistryDemoState {
  return !!v && (REGISTRY_DEMO_STATES as readonly string[]).includes(v);
}

const CANDIDATES: RegistryCandidate[] = [
  { fullName: "acme/ai-registry", private: true, defaultBranch: "main", hasLayout: true, pushedAt: "2026-08-16T09:12:00.000Z" },
  { fullName: "acme/engineering-handbook", private: true, defaultBranch: "main", hasLayout: false, pushedAt: "2026-08-14T17:40:00.000Z" },
  { fullName: "acme/platform-standards", private: false, defaultBranch: "trunk", hasLayout: false, pushedAt: "2026-07-30T11:05:00.000Z" },
  { fullName: "acme/claude-skills", private: true, defaultBranch: "main", hasLayout: true, pushedAt: "2026-08-11T08:22:00.000Z" },
];

const ACTIVITY: RegistryActivityEntry[] = [
  { at: "2026-08-17T08:41:00.000Z", kind: "index", title: "Indexed at 4f1c9ae — 18 skills · 11 practices · 42 notes", url: "#" },
  { at: "2026-08-17T08:40:00.000Z", kind: "catalog", title: "catalog.json rewritten by ascent[bot]", url: "#" },
  { at: "2026-08-17T07:58:00.000Z", kind: "skill-version", title: "skills/pr-review-rigor → v2.1 (D4 review depth)", url: "#" },
  { at: "2026-08-16T19:12:00.000Z", kind: "lesson", title: "LESSONS.md appended on skills/test-first-loop (acme/billing-api)", url: "#" },
  { at: "2026-08-16T16:03:00.000Z", kind: "memory", title: "memory/decision/postgres-over-dynamo.md added (confidence 0.82)", url: "#" },
  { at: "2026-08-16T11:47:00.000Z", kind: "practice", title: "practices/agents-md-contract starter refreshed (D2)", url: "#" },
  { at: "2026-08-15T15:20:00.000Z", kind: "skill-version", title: "skills/scan-before-write → v1.4", url: "#" },
  { at: "2026-08-15T09:02:00.000Z", kind: "index", title: "Indexed at 9b7e102 — no changes", url: "#" },
  { at: "2026-08-14T18:31:00.000Z", kind: "memory", title: "memory/gotcha/pglite-boot-drift.md superseded", url: "#" },
  { at: "2026-08-14T10:15:00.000Z", kind: "practice", title: "practices/security-scanning-baseline added (D9)", url: "#" },
];

function indexedBase(slug: string): RegistryView {
  const fullName = `${slug}/${DEFAULT_REGISTRY_NAME}`;
  return {
    status: "indexed",
    registry: {
      fullName,
      url: `https://github.com/${fullName}`,
      defaultBranch: "main",
      canonical: true,
      mode: "git_native",
      telemetrySink: "api",
      lastIndexedAt: "2026-08-17T08:41:00.000Z",
      lastIndexSha: "4f1c9ae3d7b21c05f8a9",
      catalogSha: "b02d551f9c4e77aa1330",
      webhookHealthy: true,
    },
    counts: {
      skills: { registry: 18, hostedOnly: 0 },
      practices: { registry: 11, hostedOnly: 0 },
      memory: { registry: 42, hostedOnly: 3 },
      lessons: 27,
    },
    migration: {
      skills: { state: "merged", moved: 18, total: 18, prUrl: "https://github.com/x/pull/12" },
      practices: { state: "merged", moved: 11, total: 11, prUrl: "https://github.com/x/pull/13" },
      memory: { state: "merged", moved: 42, total: 45, prUrl: "https://github.com/x/pull/14" },
    },
    fleet: {
      reposTotal: 34,
      reposPointing: 27,
      reposSynced30d: 22,
      adoption: { inSync: 19, stale: 6, diverged: 2, localOnly: 7 },
    },
    activity: ACTIVITY,
    telemetry: { invokes30d: 1_284, reposReporting: 19, sink: "api" },
    howTo: registryHowTo(fullName),
    permission: { contentsWrite: true },
    candidates: [],
  };
}

function unmappedBase(slug: string, contentsWrite: boolean): RegistryView {
  const fullName = `${slug}/${DEFAULT_REGISTRY_NAME}`;
  return {
    status: "unmapped",
    counts: {
      skills: { registry: 0, hostedOnly: 14 },
      practices: { registry: 0, hostedOnly: 9 },
      memory: { registry: 0, hostedOnly: 38 },
      lessons: 0,
    },
    migration: {
      skills: { state: "not-started", moved: 0, total: 14 },
      practices: { state: "not-started", moved: 0, total: 9 },
      memory: { state: "not-started", moved: 0, total: 38 },
    },
    fleet: { reposTotal: 34, reposPointing: 0, reposSynced30d: 0, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 12 } },
    activity: [],
    telemetry: { invokes30d: 0, reposReporting: 0, sink: "off" },
    howTo: registryHowTo(fullName),
    permission: contentsWrite ? { contentsWrite: true } : { contentsWrite: false, installUrl: "https://github.com/apps/ascent/installations/new" },
    candidates: CANDIDATES,
  };
}

/** Returns a fixture view for a recognized `?demo=` value, or null so the real loader runs. */
export function fixtureRegistryView(slug: string, demo: string | undefined): RegistryView | null {
  if (!isDemoState(demo)) return null;

  if (demo === "unmapped") return unmappedBase(slug, true);
  if (demo === "no-permission") return unmappedBase(slug, false);

  if (demo === "scaffold_pr_open") {
    const v = unmappedBase(slug, true);
    const fullName = `${slug}/${DEFAULT_REGISTRY_NAME}`;
    return {
      ...v,
      status: "scaffold_pr_open",
      scaffoldPrUrl: `https://github.com/${fullName}/pull/1`,
      registry: {
        fullName,
        url: `https://github.com/${fullName}`,
        defaultBranch: "main",
        canonical: true,
        mode: "git_native",
        telemetrySink: "api",
        lastIndexedAt: null,
        lastIndexSha: null,
        catalogSha: null,
        webhookHealthy: false,
      },
      candidates: [],
      activity: [
        { at: "2026-08-17T09:02:00.000Z", kind: "catalog", title: "Scaffold PR #1 opened by ascent[bot] — 6 files", url: "#" },
      ],
    };
  }

  if (demo === "migrating") {
    const v = indexedBase(slug);
    return {
      ...v,
      counts: {
        skills: { registry: 14, hostedOnly: 0 },
        practices: { registry: 0, hostedOnly: 9 },
        memory: { registry: 0, hostedOnly: 38 },
        lessons: 4,
      },
      migration: {
        skills: { state: "merged", moved: 14, total: 14, prUrl: "https://github.com/x/pull/12" },
        practices: { state: "pr-open", moved: 0, total: 9, prUrl: "https://github.com/x/pull/15" },
        memory: { state: "not-started", moved: 0, total: 38 },
      },
      fleet: { reposTotal: 34, reposPointing: 6, reposSynced30d: 4, adoption: { inSync: 4, stale: 2, diverged: 0, localOnly: 11 } },
      telemetry: { invokes30d: 62, reposReporting: 3, sink: "api" },
      activity: ACTIVITY.slice(0, 5),
    };
  }

  if (demo === "error") {
    const v = indexedBase(slug);
    return {
      ...v,
      status: "error",
      registry: { ...v.registry!, webhookHealthy: false, lastIndexedAt: "2026-08-15T09:02:00.000Z", lastIndexSha: "9b7e1024c8fa5511bd07" },
      error: {
        message: "skills/pr-review-rigor/SKILL.md — frontmatter missing required `version`; 3 more files skipped",
        at: "2026-08-17T08:41:00.000Z",
      },
      activity: [
        { at: "2026-08-17T08:41:00.000Z", kind: "index", title: "Index failed at 4f1c9ae — 4 files rejected", url: "#" },
        ...ACTIVITY.slice(2),
      ],
    };
  }

  // hosted — the explicit "stay hosted" outcome: ascent stays the writer, the repo is a mirror.
  const v = indexedBase(slug);
  return {
    ...v,
    registry: { ...v.registry!, mode: "hosted_mirror", telemetrySink: "off", canonical: true },
    counts: { skills: { registry: 0, hostedOnly: 14 }, practices: { registry: 0, hostedOnly: 9 }, memory: { registry: 0, hostedOnly: 38 }, lessons: 0 },
    migration: {
      skills: { state: "n/a", moved: 0, total: 14 },
      practices: { state: "n/a", moved: 0, total: 9 },
      memory: { state: "n/a", moved: 0, total: 38 },
    },
    fleet: { reposTotal: 34, reposPointing: 0, reposSynced30d: 0, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 12 } },
    telemetry: { invokes30d: 0, reposReporting: 0, sink: "off" },
    activity: ACTIVITY.filter((a) => a.kind === "catalog" || a.kind === "index").slice(0, 3),
  };
}
