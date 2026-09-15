// Unit economics (W3a) — what a unit of AI work actually costs, on the Delivery tab.
//
// Port's AI-SDLC research names the reason only ~a third of engineering leaders report meaningful AI
// ROI: they measure ADOPTION (seats, sessions, tokens) instead of OUTCOMES. Agents cost per ATTEMPT,
// so a 30% no-output rate makes the real cost per completed unit ~1.43× the naive per-session figure.
// This panel is that arithmetic, over `AgentSession` rows the org's own agents reported.
//
// THREE THINGS IT REFUSES TO SAY. All three used to be a paragraph of "How to read this" under the
// tiles; all three are now carried by the drawing or by a chip beside it (docs/ORG-UX-REDESIGN.md §2):
//
//   1. It never calls a session a FAILURE — "produced code" / "did not", named for what was observed.
//      → `PRODUCED_HINT`, disclosed on the flow's WhyChip.
//   2. It never claims a PER-PR cost: telemetry carries no PR number, so cost per merged AI change is
//      an ALLOCATION over repo × period. → `ALLOCATION_HINT`.
//   3. It never divides by zero and calls the result free. A repo with no merged AI change has NO
//      DENOMINATOR. → an em dash in the table, and the excluded-repo count as its own chip.
//
// And the one the ribbon enforces rather than states: with no cost source the money stage is a VOID
// that breaks the chain, never an estimate and never a zero.
//
// Server-safe — no hooks, no handlers.

import { Card, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";
import { UnitEconomicsFlow } from "./UnitEconomicsFlow";
import { UnitEconomicsTable, usd } from "./UnitEconomicsTable";

export function UnitEconomics({ slug, view, periodTitle }: { slug: string; view: UnitEconomicsView; periodTitle: string }) {
  const f = view.fleet;

  // No attempts recorded is an honest state with an actionable cause, not an error and not a zero —
  // and it is the (O) Onboarding destination for the argument this panel exists to make.
  if (f.sessions === 0) {
    return (
      <Card>
        <SectionHeader size="sm" title="Unit economics" description={periodTitle} />
        <p className="mt-3 type-body-sm text-slate-400">
          Adoption metrics — seats, sessions, tokens — cannot tell you what a unit of AI work costs, because agents
          are billed per <em>attempt</em> and not per result. This panel is that arithmetic, and it needs per-session
          telemetry: the Claude Code exporter has to send a{" "}
          <code className="font-mono text-slate-300">session.id</code> resource attribute. No agent sessions were
          recorded in {periodTitle.toLowerCase()}. Connect it on{" "}
          <a href={orgTabHref(slug, "integrations")} className="focus-ring text-accent hover:text-white">
            Integrations
          </a>
          . Day-bucketed spend, if you have it, still powers the ROI panel above.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      {/* §2.3 — unit and window only. */}
      <SectionHeader
        size="sm"
        title="Unit economics"
        description={`${f.sessions.toLocaleString()} agent session${f.sessions === 1 ? "" : "s"} · ${periodTitle}`}
      />

      {/* §2.2 — first sight is the chain, not a sentence about the chain. */}
      <div className="mt-4">
        <UnitEconomicsFlow fleet={f} reposWithoutDenominator={f.reposWithoutDenominator} />
      </div>

      <div className={`${TILE_LEDGER} mt-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`}>
        <Tile label="Sessions" value={f.sessions.toLocaleString()} sub="attempts recorded" />
        <Tile
          label="Produced code"
          value={f.producedRate == null ? "—" : `${f.producedRate}%`}
          sub={`${f.producedCode.toLocaleString()} of ${f.sessions.toLocaleString()}`}
        />
        <Tile label="Agent spend" value={f.costCents > 0 ? usd(f.costCents) : "—"} sub={f.costCents > 0 ? "in this period" : "no cost source"} />
        <Tile
          label="Per producing session"
          value={f.costPerProducingSession == null ? "—" : usd(f.costPerProducingSession)}
          sub={f.costPerProducingSession == null ? "no session produced code" : "cost ÷ sessions with output"}
        />
        <Tile
          label="Per merged AI change"
          value={f.costPerMergedAiChange == null ? "—" : usd(f.costPerMergedAiChange)}
          sub={f.costPerMergedAiChange == null ? "no merged AI change" : `over ${f.mergedAiChanges.toLocaleString()} merges`}
        />
      </div>

      <div className="mt-4">
        <UnitEconomicsTable view={view} />
      </div>
    </Card>
  );
}
