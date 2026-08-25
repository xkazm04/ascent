// WHAT SHE OFFERED — one open proposal, displayed.
//
// A proposal is the seam between "she said something" and "something happened": nothing she suggests
// takes effect until a person answers it. This card is the DISPLAY half of that seam. It renders from
// the boot payload's `proposals` (already filtered to `status: "open"` by the route) and it makes no
// decision — the accept/decline path and the API behind it are a separate work package, and inventing
// a request shape for a route this file does not own is how two halves ship that never met.
//
// So the card states the ask and says plainly that it is waiting. It does NOT render a dead button:
// a control that looks live and does nothing costs more trust than an absent one.
//
// `payload` is decoded JSON out of a TEXT column and its shape is kind-specific by design (there is
// deliberately no `outcome` column), so the summary reader below tries the fields a payload is likely
// to carry and falls back to naming the kind rather than printing `[object Object]`.

import { Kicker } from "@/components/ui";
import type { AthenaProposalRecord } from "@/lib/db/athena-proposals";

/**
 * The one named kind, as a LITERAL. `IDENTITY_DIFF_KIND` lives in `@/lib/db/athena-proposals`, which
 * imports Prisma at module scope — a value import of it from a client component drags the server graph
 * into the browser bundle and fails `next build` (tsc and the unit tests both pass first). The literal
 * is pinned to the real constant in `AthenaProposalCard.test.ts`, which runs under node and CAN import
 * it, so a rename still fails a test instead of silently retitling every card.
 */
const IDENTITY_DIFF = "identity_diff";

/** A human title for a proposal kind: `identity_diff` is the one named kind; the rest are action ids. */
export function proposalTitle(kind: string): string {
  if (kind === IDENTITY_DIFF) return "A change to what she believes about this org";
  return kind.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The ask, in one line, from whichever field this kind's payload put it in. */
export function proposalSummary(payload: Record<string, unknown>): string | null {
  for (const key of ["summary", "reason", "title", "description", "line"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const ops = payload.ops;
  if (Array.isArray(ops) && ops.length > 0) {
    return `${ops.length} edit${ops.length === 1 ? "" : "s"} to her self-model.`;
  }
  return null;
}

export function AthenaProposalCard({ proposal }: { proposal: AthenaProposalRecord }) {
  const summary = proposalSummary(proposal.payload);
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/[0.06] px-3.5 py-2.5">
      <Kicker>Awaiting a decision</Kicker>
      <p className="mt-1 text-sm font-semibold text-white">{proposalTitle(proposal.kind)}</p>
      {summary && <p className="mt-1 text-xs leading-relaxed text-slate-300">{summary}</p>}
    </div>
  );
}
