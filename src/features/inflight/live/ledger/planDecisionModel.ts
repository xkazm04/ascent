// The inbox's verdict, from form fields to `PlanDecisionBody` — pure, so "a revise needs a note" and
// "the budget is a whole number of cycles" are facts about a function.
//
// Only the SHAPE is checked here (required text, numbers that parse). The ranges — at most 50 cycles, a
// USD budget the column can store — are the server's (`parseDecisionBody`), and its 400 message is shown
// inline verbatim: a second copy of those limits in the browser is how the two would drift apart.

import type { PlanDecision, PlanDecisionBody } from "@/lib/local/runner-types";

export const DEFAULT_BUDGET_CYCLES = 3;

export interface DecisionFields {
  fence: readonly string[];
  cycles: string;
  usd: string;
  note: string;
}

export type DecisionDraft = { ok: true; body: PlanDecisionBody } | { ok: false; error: string };

export function decisionBody(verb: PlanDecision, f: DecisionFields): DecisionDraft {
  const note = f.note.trim();
  if (verb === "revise") {
    return note ? { ok: true, body: { decision: "revise", note } } : { ok: false, error: "Say what to change — the next planning session is shown your note." };
  }
  if (verb === "reject") {
    return note ? { ok: true, body: { decision: "reject", note } } : { ok: false, error: "Give a reason — a rejection dismisses these items for good, and the reason is what the next scan reads." };
  }
  if (f.fence.length === 0) return { ok: false, error: "An empty fence would let the direction move nothing — keep at least one module prefix." };
  const cycles = Number(f.cycles.trim());
  if (!Number.isInteger(cycles) || cycles < 1) return { ok: false, error: "The cycle budget must be a whole number of at least 1." };
  const body: PlanDecisionBody = { decision: "approve", note, fence: [...f.fence], budgetCycles: cycles };
  const usdRaw = f.usd.trim();
  if (usdRaw) {
    const usd = Number(usdRaw);
    if (!Number.isFinite(usd) || usd <= 0) return { ok: false, error: "A spend budget must be a positive amount of US dollars — or leave it empty for none." };
    body.budgetUsd = usd;
  }
  return { ok: true, body };
}
