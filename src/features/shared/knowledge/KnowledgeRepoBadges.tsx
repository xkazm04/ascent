// The churn a repo's column carries between sweeps: contexts whose verdicts lost their context
// (`orphaned`), contexts that arrived unjudged (`arrived`), and a registry map built against an older
// `context-map.json` than the repo has now (`mapBehind`). Rendered only when non-zero / true — a
// zero badge would be decoration, and the composer says what to do about each of them.
//
// Spans, not buttons: the column header IS a button, and a control cannot nest a control.

import { chipButtonClass } from "@/components/ui";
import type { KnowledgeRepo } from "@/lib/org/knowledge-shape";

const BADGE = "px-1.5 py-0 type-micro normal-case tracking-normal";

export function KnowledgeRepoBadges({ repo }: { repo: KnowledgeRepo }) {
  const items: { key: string; text: string; tone: "idle" | "danger" }[] = [];
  if (repo.orphaned > 0) items.push({ key: "orphaned", text: `${repo.orphaned} orphaned`, tone: "idle" });
  if (repo.arrived > 0) items.push({ key: "arrived", text: `${repo.arrived} new`, tone: "idle" });
  if (repo.mapBehind) items.push({ key: "map-behind", text: "map behind", tone: "danger" });
  if (!items.length) return null;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {items.map((b) => (
        <span key={b.key} className={chipButtonClass(b.tone, BADGE)}>
          {b.text}
        </span>
      ))}
    </span>
  );
}
