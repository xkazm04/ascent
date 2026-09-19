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
export const subjects = SURFACE_SUBJECTS.map((subject) => {
  const record = surfaceRecord(subject.slug);
  return { ...subject, record, interactive: record !== null };
});
export const categories = [
  { id: "all", title: "All surfaces" },
  { id: "data-display", title: "Data" },
  { id: "feedback-and-style", title: "Feedback & style" },
  { id: "shell-and-navigation", title: "Navigation" },
  { id: "input-and-editing", title: "Input" },
  { id: "published-surfaces", title: "Publishing" },
];
export type Subject = (typeof subjects)[number];
