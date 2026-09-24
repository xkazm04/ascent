// Folds the signed-in developer's own stored share into their `DeveloperView` (C3, backlog
// develop-2026-09-17 row 46). The loader calls this BEFORE `applyOwnSessionShape`, which skips any
// field already shared, so a field the mentor shared always wins over ascent's own telemetry.
//
// Only sections present in the share are written: a section the developer left out keeps the view's
// honest empty state. `evidence` on a move is ascent's to add from the fleet (C4), never the mentor's,
// so it is null here. The privacy ledger's switchable rows light up from what the share actually
// carried; its never-sent rows are copied untouched, and `careNeverSent` locks them whatever they say.
//
// PURE module, no db import: the Developer render is a client component.

import { validateCareShapePayload } from "./care-shape-contract";
import type { CareSharePayload } from "./care-share-contract";
import { SHARING_LEDGER_OFF, type CareShapeField, type DeveloperView } from "./developer-view";

/** Which shape fields light each switchable ledger row. */
const LEDGER_SHAPE_FIELDS: Record<string, readonly CareShapeField[]> = {
  "Session counts (30d)": ["sessionsPerWeek", "turnsPerSession", "retriesPerSession", "compactionsPerSession"],
  "Plan-mode ratio": ["planModePct"],
  "Tests-before-commit ratio": ["testsBeforeCommitPct"],
  "Skill invokes": ["skillInvokes30d"],
};

/** The ledger for a share: a switchable row is `shared` when the share carried what it names. */
export function careShareLedger(share: CareSharePayload, sharedFields: readonly CareShapeField[]): DeveloperView["setup"]["sharing"] {
  return SHARING_LEDGER_OFF.map((row) => {
    if (row.field === "Moves kept / dropped") return { ...row, shared: share.moves !== undefined };
    const fields = LEDGER_SHAPE_FIELDS[row.field];
    return fields ? { ...row, shared: fields.some((f) => sharedFields.includes(f)) } : { ...row };
  });
}

/** Write the viewer's own share into their view, in place. `sharedAt` is the ISO time it was stored. */
export function applyMentorShare(view: DeveloperView, share: CareSharePayload, sharedAt: string): void {
  if (!view.login) return;
  if (share.profile) view.profile = { ...share.profile, goals: [...share.profile.goals], sharedAt };
  if (share.moves) view.moves = share.moves.map((m) => ({ ...m, evidence: null }));
  if (share.journal) view.journal = [...share.journal].sort((a, b) => b.at.localeCompare(a.at));
  if (share.shape) {
    const shape = validateCareShapePayload(share.shape);
    if (shape.ok) {
      view.shape = shape.shape;
      view.sharedFields = shape.sharedFields;
      view.shapeReasons = shape.shapeReasons;
    }
  }
  view.setup = {
    mentorInstalled: true,
    hookInstalled: share.setup?.hookInstalled ?? false,
    lastShareAt: sharedAt,
    sharing: careShareLedger(share, view.sharedFields),
  };
}
