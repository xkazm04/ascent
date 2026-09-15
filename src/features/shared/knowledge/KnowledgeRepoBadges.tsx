// The churn a repo's column carries between sweeps: contexts whose verdicts lost their context
// (`orphaned`), contexts that arrived unjudged (`arrived`), and a registry map built against an older
// `context-map.json` than the repo has now (`mapBehind`). Rendered only when non-zero / true — a
// zero badge would be decoration, and the composer says what to do about each of them.
//
// A badge is a state vocabulary by another name, so each one is routed through the kit's
// `StateSwatch` and carries the kit's canonical caveat: orphaned verdicts are `superseded` (the map
// KEEPS them under `orphans` rather than deleting them, so the earlier judgement stays auditable),
// an arrived context is `not-judged` (a fresh subscription nobody has read), and a behind map is
// `declared` (it asserts subscriptions against a context map the repo has already moved past).
// Nothing here paints its own state — that is what stops this tab, Memory and Practices becoming
// three dialects of the same idea.
//
// Spans, not buttons: the column header IS a button, and a control cannot nest a control. The
// swatches are `aria-hidden` for the same reason — the badge's own words are the accessible name.

import { chipButtonClass } from "@/components/ui";
import { STATE_HINT, StateSwatch, type VizState } from "@/components/org/viz";
import type { KnowledgeRepo } from "@/lib/org/knowledge-shape";

const BADGE = "px-1.5 py-0 type-micro normal-case tracking-normal inline-flex items-center gap-1";

/** Why THIS badge is in THIS state, appended to the kit's sentence about what the state means. */
const REASON = {
  orphaned: "The verdicts stand but their contexts are gone from context-map.json; the map retains them under `orphans`.",
  arrived: "These contexts were absent from the previous map, so every pair on them is an unjudged subscription.",
  "map-behind": "The registry map was built against an older context-map.json revision than the repo carries now.",
} as const;

type Badge = { key: keyof typeof REASON; text: string; tone: "idle" | "danger"; state: VizState };

export function KnowledgeRepoBadges({ repo }: { repo: KnowledgeRepo }) {
  const items: Badge[] = [];
  if (repo.orphaned > 0) items.push({ key: "orphaned", text: `${repo.orphaned} orphaned`, tone: "idle", state: "superseded" });
  if (repo.arrived > 0) items.push({ key: "arrived", text: `${repo.arrived} new`, tone: "idle", state: "not-judged" });
  if (repo.mapBehind) items.push({ key: "map-behind", text: "map behind", tone: "danger", state: "declared" });
  if (!items.length) return null;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {items.map((b) => (
        <span key={b.key} className={chipButtonClass(b.tone, BADGE)} title={`${STATE_HINT[b.state]} ${REASON[b.key]}`}>
          <span aria-hidden className="inline-flex">
            <StateSwatch state={b.state} size={8} />
          </span>
          {b.text}
        </span>
      ))}
    </span>
  );
}
