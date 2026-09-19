// Client-safe taxonomy and study availability for the UI surface library.
import { SURFACE_STUDIES } from "./surface-studies";

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

export type SurfaceRecord = SurfaceSubjectRef & { techniqueSlugs: readonly string[] };

export const SURFACE_CATALOG: readonly SurfaceRecord[] = SURFACE_SUBJECTS.flatMap(subject => {
  const techniqueSlugs = SURFACE_STUDIES[subject.slug];
  return techniqueSlugs ? [{ ...subject, techniqueSlugs }] : [];
});

export function surfaceRecord(slug: string): SurfaceRecord | null {
  return SURFACE_CATALOG.find(subject => subject.slug === slug) ?? null;
}

export function isSurfaceShowcased(slug: string): boolean {
  return surfaceRecord(slug) !== null;
}
