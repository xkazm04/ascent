// Prism unit economics. No sessions is an onboarding frame, not a zero. A missing cost is a void.
import { Frame, HairlineGrid, Lede, SectionHead, StatTile } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";
import { UnitEconomicsFlow } from "./UnitEconomicsFlow";
import { UnitEconomicsTableV2 } from "./UnitEconomicsTable.v2";
import { usd } from "./UnitEconomicsTable";
import { Unknown } from "../deliveryV2Marks";

export function UnitEconomicsV2({ slug, view, periodTitle }: { slug: string; view: UnitEconomicsView; periodTitle: string }) {
  const f = view.fleet;
  const period = periodTitle.toLowerCase();
  if (f.sessions === 0) {
    return (
      <Frame>
        <SectionHead eyebrow="Cost" title="Unit economics" named="needs a session id." lede={periodTitle} />
        <Lede className="mt-3">
          Adoption metrics (seats, sessions, tokens) cannot tell you what a unit of AI work costs, because agents are
          billed per <em>attempt</em> and not per result. This panel is that arithmetic, and it needs per-session
          telemetry: the Claude Code exporter has to send a <code className="text-slate-200">session.id</code> resource
          attribute. No agent sessions were recorded in {period}. Connect it on{" "}
          <a href={orgTabHref(slug, "integrations")} className="focus-ring text-slate-200 underline hover:text-white">
            Integrations
          </a>
          . Day-bucketed spend, if you have it, still powers the ROI panel above.
        </Lede>
      </Frame>
    );
  }
  const sessions = `${f.sessions.toLocaleString()} agent session${f.sessions === 1 ? "" : "s"}`;
  return (
    <Frame>
      <SectionHead eyebrow="Cost" title="Unit economics" named={sessions} lede={periodTitle} />
      <div className="mt-6">
        <UnitEconomicsFlow fleet={f} reposWithoutDenominator={f.reposWithoutDenominator} />
      </div>
      <HairlineGrid className="mt-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Sessions" value={f.sessions.toLocaleString()} sub="attempts recorded" />
        <StatTile
          label="Produced code"
          value={f.producedRate == null ? <Unknown /> : `${f.producedRate}%`}
          sub={`${f.producedCode.toLocaleString()} of ${f.sessions.toLocaleString()}`}
        />
        <StatTile
          label="Agent spend"
          value={f.costCents > 0 ? usd(f.costCents) : <Unknown label="no cost source" />}
          sub={f.costCents > 0 ? "in this period" : "no cost source"}
        />
        <StatTile
          label="Per producing session"
          value={f.costPerProducingSession == null ? <Unknown label="no session produced code" /> : usd(f.costPerProducingSession)}
          sub={f.costPerProducingSession == null ? "no session produced code" : "cost divided by sessions with output"}
        />
        <StatTile
          label="Per merged AI change"
          value={f.costPerMergedAiChange == null ? <Unknown label="no merged AI change" /> : usd(f.costPerMergedAiChange)}
          sub={f.costPerMergedAiChange == null ? "no merged AI change" : `over ${f.mergedAiChanges.toLocaleString()} merges`}
        />
      </HairlineGrid>
      <div className="mt-6">
        <UnitEconomicsTableV2 view={view} />
      </div>
    </Frame>
  );
}
