// The UI surfaces catalog — the typed list of repo-shipped showcases of the registry's ui-surfaces
// subjects (spark ui-surfaces-showcase, 2026-09-06). Client-safe, no React: imported by the server
// tab, the client scene, the Knowledge reader's deep link and the bijection test alike.
//
// Two lists, deliberately separate:
//   - `SURFACE_SUBJECTS` is a STATIC MIRROR of the software-engineering bundle's ui-surfaces branch
//     (`taxonomy.json`, registry order) — every subject the gallery must show a card for, showcased
//     or not. A subject missing here is a subject the gallery cannot admit it has no scene for.
//   - `SURFACE_CATALOG` is what has actually been authored: one record per scene, keyed by the
//     subject slug, with the registry digest the scene was authored against so the tab can say
//     "current" or "authored against an older subject" once joined to the org's index mirror
//     (src/lib/org/surface-freshness.ts). The scene bodies themselves are loaded lazily through
//     `src/features/shared/surfaces/surfaceBodies.ts`; `surfaceCatalog.test.ts` pins the bijection.
//
// Registration is a two-line edit (a record here, an `import()` in the body map); the `/surface`
// skill does it, and the test refuses a record without a body or a body without a record.

export type SurfaceSubcategory =
  | "data-display"
  | "feedback-and-style"
  | "input-and-editing"
  | "published-surfaces"
  | "shell-and-navigation";

export type SurfaceSubjectRef = { slug: string; subcategory: SurfaceSubcategory; title: string };

/** Gallery section order — the taxonomy's own order — with the titles it declares. */
export const SURFACE_SUBCATEGORIES: readonly { id: SurfaceSubcategory; title: string }[] = [
  { id: "data-display", title: "Data display" },
  { id: "input-and-editing", title: "Input and editing" },
  { id: "shell-and-navigation", title: "Shell and navigation" },
  { id: "feedback-and-style", title: "Feedback and style" },
  { id: "published-surfaces", title: "Published surfaces" },
];

const s = (subcategory: SurfaceSubcategory, slug: string, title: string): SurfaceSubjectRef => ({ slug, subcategory, title });

/** All 33 ui-surfaces subjects, in `taxonomy.json` order. Mirror — never derived at runtime. */
export const SURFACE_SUBJECTS: readonly SurfaceSubjectRef[] = [
  s("data-display", "table", "Table"),
  s("data-display", "feed", "Feed"),
  s("data-display", "data-viz", "Data visualization"),
  s("data-display", "canvas-graph", "Canvas graph"),
  s("data-display", "diff-comparison", "Diff comparison"),
  s("data-display", "file-browsing", "File browsing"),
  s("data-display", "search", "Search"),
  s("input-and-editing", "form", "Form"),
  s("input-and-editing", "ui-controls", "UI controls"),
  s("input-and-editing", "draft-editing", "Draft editing"),
  s("input-and-editing", "drag-drop", "Drag and drop"),
  s("input-and-editing", "undo-history", "Undo history"),
  s("input-and-editing", "wizard-flows", "Wizard flows"),
  s("input-and-editing", "schema-driven-ui", "Schema-driven UI"),
  s("input-and-editing", "batch-undo-commit-window", "Batch undo commit window"),
  s("shell-and-navigation", "app-shell", "App shell"),
  s("shell-and-navigation", "modal-stack", "Modal stack"),
  s("shell-and-navigation", "session-resume", "Session resume"),
  s("shell-and-navigation", "guided-tours", "Guided tours"),
  s("shell-and-navigation", "chat-transcript", "Chat transcript"),
  s("shell-and-navigation", "media-playback", "Media playback"),
  s("feedback-and-style", "async-ui-states", "Async UI states"),
  s("feedback-and-style", "status-vocabulary", "Status vocabulary"),
  s("feedback-and-style", "toasts-notifications", "Toasts and notifications"),
  s("feedback-and-style", "motion", "Motion system"),
  s("feedback-and-style", "design-tokens", "Design tokens"),
  s("feedback-and-style", "accessibility", "Accessibility"),
  s("feedback-and-style", "adaptive-fidelity-tiers", "Adaptive fidelity tiers"),
  s("published-surfaces", "lazy-section-addressability", "Lazy section addressability"),
  s("published-surfaces", "long-form-reading-surface", "Long-form reading surface"),
  s("published-surfaces", "docs-content-model", "Docs content model"),
  s("published-surfaces", "authoring-block-vocabulary", "Authoring block vocabulary"),
  s("published-surfaces", "public-claim-provenance", "Public claim provenance"),
];

export type SurfaceRecord = {
  slug: string;
  subcategory: SurfaceSubcategory;
  title: string;
  summary: string;
  /** The registry subject digest (`sha256:…`, from the bundle index) the scene was read against. */
  authoredAgainst: { digest: string; verifiedOn: string /* YYYY-MM-DD */ };
  /** Every technique the scene embodies — each one a `[data-technique]` region and a drawer entry. */
  techniqueSlugs: readonly string[];
};

/** The three fixture volumes a scene's data knob offers. Scenes must accept all three. */
export const SURFACE_VOLUMES = [50, 5_000, 50_000] as const;
export type SurfaceVolume = (typeof SURFACE_VOLUMES)[number];

export const SURFACE_CATALOG: readonly SurfaceRecord[] = [
  {
    slug: "motion",
    subcategory: "feedback-and-style",
    title: "Motion system",
    summary:
      "An instrument panel that speaks one named motion vocabulary: presets with fallbacks, three engines side by side, frames written outside React, budgets that go red, a one-shot guard, a merged pause signal.",
    authoredAgainst: { digest: "sha256:89022fde06571042", verifiedOn: "2026-09-06" },
    techniqueSlugs: [
      "gesture-decomposition",
      "preset-vocabulary",
      "engine-selection",
      "performance-discipline",
      "taste-budgets",
      "one-shot-guarding",
      "reduced-motion-mechanics",
      "content-bearing-degradation",
      "unprompted-motion-lifecycle",
      "loop-pause-governance",
    ],
  },
  {
    slug: "accessibility",
    subcategory: "feedback-and-style",
    title: "Accessibility",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:e7079c6845ba0270", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "adaptive-fidelity-tiers",
    subcategory: "feedback-and-style",
    title: "Adaptive fidelity tiers",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:b28d9f28795d6750", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "async-ui-states",
    subcategory: "feedback-and-style",
    title: "Async UI states",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:4d89ccb3b7b69ed0", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "design-tokens",
    subcategory: "feedback-and-style",
    title: "Design tokens",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:285d0bf6dac74e64", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "status-vocabulary",
    subcategory: "feedback-and-style",
    title: "Status vocabulary",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:0bdc30b0870393c6", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "toasts-notifications",
    subcategory: "feedback-and-style",
    title: "Toasts and notifications",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:4c6dc8858a53f603", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "canvas-graph",
    subcategory: "data-display",
    title: "Canvas graph",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:9eedbc25626767bc", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "data-viz",
    subcategory: "data-display",
    title: "Data visualization",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:b6657691892c6b9b", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "diff-comparison",
    subcategory: "data-display",
    title: "Diff comparison",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:0df03bbd2dcbaf5d", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "feed",
    subcategory: "data-display",
    title: "Feed",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:23236fee1ffbf827", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "file-browsing",
    subcategory: "data-display",
    title: "File browsing",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:ae56dce70c40004c", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "search",
    subcategory: "data-display",
    title: "Search",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:54682051824eb2b3", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
  {
    slug: "table",
    subcategory: "data-display",
    title: "Table",
    summary: "Authoring in progress: the scene is being written by the /surface run.",
    authoredAgainst: { digest: "sha256:6a77e71f01e80b19", verifiedOn: "2026-09-06" },
    techniqueSlugs: [],
  },
];

const BY_SLUG: ReadonlyMap<string, SurfaceRecord> = new Map(SURFACE_CATALOG.map((r) => [r.slug, r]));

export function isSurfaceShowcased(slug: string): boolean {
  return BY_SLUG.has(slug);
}

export function surfaceRecord(slug: string): SurfaceRecord | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * Per `.ai/manifest.yaml` `scope.out_of_scope_categories`, the whole input-and-editing subcategory is
 * out of this repo's scope: Ascent has no editing surface of its own, so a scene there would
 * showcase a standard the repo never consumes. The gallery still lists them (an absence inside an
 * out-of-scope category is stated, never hidden) and the `/surface` skill refuses them without
 * `--force`.
 */
export function isSurfaceOutOfScope(slug: string): boolean {
  return SURFACE_SUBJECTS.find((x) => x.slug === slug)?.subcategory === "input-and-editing";
}
