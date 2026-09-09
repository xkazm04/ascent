import { SURFACE_SUBJECTS, surfaceRecord } from "@/lib/org/surface-catalog";

export const descriptions: Record<string, string> = {
  table: "Bring order to the details.",
  feed: "Follow what changed, as it happens.",
  "data-viz": "Make the shape of your data visible.",
  "canvas-graph": "See how everything connects.",
  "diff-comparison": "Understand exactly what changed.",
  "file-browsing": "Find your way through a collection.",
  search: "A short path from question to answer.",
  motion: "Give every movement a purpose.",
  accessibility: "A good experience, through every input.",
  "adaptive-fidelity-tiers": "Keep the experience in reach.",
  "async-ui-states": "Make waiting feel understood.",
  "design-tokens": "One vocabulary. Many expressions.",
  "status-vocabulary": "Make the state unmistakable.",
  "toasts-notifications": "The right message, at the right moment.",
};
// Only the studies authored here are interactive in v2. An original showcase added later
// remains reference-only until a corresponding v2 study is implemented.
const studySlugs = new Set([
  "table",
  "feed",
  "data-viz",
  "canvas-graph",
  "diff-comparison",
  "file-browsing",
  "search",
  "motion",
  "accessibility",
  "adaptive-fidelity-tiers",
  "async-ui-states",
  "design-tokens",
  "status-vocabulary",
  "toasts-notifications",
]);
export const subjects = SURFACE_SUBJECTS.map((s) => ({
  ...s,
  record: surfaceRecord(s.slug),
  interactive: studySlugs.has(s.slug),
}));
export const categories = [
  { id: "all", title: "All surfaces" },
  { id: "data-display", title: "Data" },
  { id: "feedback-and-style", title: "Feedback & style" },
  { id: "shell-and-navigation", title: "Navigation" },
  { id: "input-and-editing", title: "Input" },
  { id: "published-surfaces", title: "Publishing" },
];
export type Subject = (typeof subjects)[number];
