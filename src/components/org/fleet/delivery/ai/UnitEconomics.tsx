// Unit economics (W3a) — what a unit of AI work actually costs, on the Delivery tab.
//
// Port's AI-SDLC research names the reason only ~a third of engineering leaders report meaningful AI
// ROI: they measure ADOPTION (seats, sessions, tokens) instead of OUTCOMES. Agents cost per ATTEMPT,
// so a 30% no-output rate makes the real cost per completed unit ~1.43× the naive per-session figure.
// This panel is that arithmetic, over `AgentSession` rows the org's own agents reported.
//
// THREE THINGS IT REFUSES TO SAY, and the refusals are the panel:
//
//   1. It never calls a session a FAILURE. A session with no commit is very often a question, a code
//      read, or a debugging pass. The measure is "produced code" / "did not" — named for exactly what
//      it observed, with the interpretation left to the reader who knows their own team.
//   2. It never claims a PER-PR cost. Claude Code's telemetry carries no PR number, so a session→PR
//      link would be a repo+time-window guess. Cost per merged AI change is an ALLOCATION over
//      repo × period, labelled as one, with its denominator printed beside it.
//   3. It never divides by zero and calls the result free. A repo that merged no AI-attributed change
//      in the window has NO DENOMINATOR — an em dash, not a number.
//
// Server-safe — no hooks, no handlers.

import { Card, OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";

/** Cents → "$1.23" / "$1,234". Whole dollars above $100, where cents are noise. */
function usd(cents: number): string {
  const d = cents / 100;
  return d >= 100 ? `$${Math.round(d).toLocaleString()}` : `$${d.toFixed(2)}`;
}

/** A nullable figure with the reason it is absent in the tooltip — never a fabricated zero. */
function Absent({ reason }: { reason: string }) {
  return (
    <span className="font-mono tabular-nums text-slate-500" title={reason}>
      —
    </span>
  );
}

export function UnitEconomics({ slug, view, periodTitle }: { slug: string; view: UnitEconomicsView; periodTitle: string }) {
  const f = view.fleet;

  // No attempts recorded is an honest state with an actionable cause, not an error and not a zero.
  if (f.sessions === 0) {
    return (
      <Card>
        <SectionHeader
          size="sm"
          title="Unit economics"
          description="What a unit of AI work costs: cost per session that produced code, and cost per merged AI-attributed change."
        />
        <p className="mt-3 text-sm text-slate-400">
          No agent sessions recorded in {periodTitle.toLowerCase()}. This reads per-session telemetry, which needs the
          Claude Code exporter to send a <code className="font-mono text-slate-300">session.id</code> resource attribute.
          Connect it on{" "}
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
      <SectionHeader
        size="sm"
        title="Unit economics"
        description={`Measured over ${f.sessions.toLocaleString()} agent ${f.sessions === 1 ? "session" : "sessions"} in ${periodTitle.toLowerCase()}. Cost per unit of work is the number adoption metrics can't give you: agents are billed per attempt, not per result.`}
      />

      <div className={`${TILE_LEDGER} mt-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`}>
        <Tile label="Sessions" value={f.sessions.toLocaleString()} sub="attempts recorded" />
        <Tile
          label="Produced code"
          value={f.producedRate == null ? "—" : `${f.producedRate}%`}
          sub={`${f.producedCode.toLocaleString()} of ${f.sessions.toLocaleString()}`}
        />
        <Tile label="Agent spend" value={usd(f.costCents)} sub="in this period" />
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

      <p className="mt-4 rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">How to read this</span>{" "}
        <strong className="font-medium text-slate-200">&ldquo;Produced code&rdquo; is not a success rate.</strong> A
        session with no commit is often a question, a code read or a debugging pass: the measure says what was observed
        and leaves the judgement to you.{" "}
        <strong className="font-medium text-slate-200">Cost per merged AI change is an allocation</strong>, not a
        per-PR price: the telemetry carries no pull-request id, so spend is divided across the AI-attributed changes
        that merged in the same repository and period, and the denominator is printed beside it.
        {f.reposWithoutDenominator > 0 && (
          <>
            {" "}
            <strong className="font-medium text-amber-200">
              {f.reposWithoutDenominator}{" "}
              {f.reposWithoutDenominator === 1 ? "repository is" : "repositories are"} excluded from that ratio
            </strong>{" "}
            for having agent spend but no merged AI-attributed change in the window. Their spend is real and is
            included in &ldquo;Agent spend&rdquo; above.
          </>
        )}
      </p>

      <div className="mt-4">
        <OrgTable
          caption="Per-repository unit economics"
          minWidth={720}
          head={
            <tr className="text-left">
              <th className="px-4 py-3">Repository</th>
              <th className="px-4 py-3 text-right">Sessions</th>
              <th className="px-4 py-3 text-right">Produced code</th>
              <th className="px-4 py-3 text-right">Spend</th>
              <th className="px-4 py-3 text-right">Per producing session</th>
              <th className="px-4 py-3 text-right">Per merged AI change</th>
            </tr>
          }
        >
          {view.rows.map((r) => (
            <tr key={r.repoFullName}>
              <td className="px-4 py-3 text-white">{r.repoFullName}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{r.sessions}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                {r.producedRate == null ? <Absent reason="No sessions" /> : `${r.producedRate}%`}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{usd(r.costCents)}</td>
              <td className="px-4 py-3 text-right">
                {r.costPerProducingSession == null ? (
                  <Absent reason="No session in this repo produced a commit or PR" />
                ) : (
                  <span className="font-mono tabular-nums text-white">{usd(r.costPerProducingSession)}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {r.costPerMergedAiChange == null ? (
                  <Absent reason="No AI-attributed change merged in this repo during the period: no denominator, which is not the same as free" />
                ) : (
                  <span className="font-mono tabular-nums text-white" title={`over ${r.mergedAiChanges} merged AI changes`}>
                    {usd(r.costPerMergedAiChange)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </OrgTable>
      </div>
    </Card>
  );
}
