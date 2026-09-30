// Prism AI ledger. Money locks when fidelity is none. A connected zero stays $0.
// Git rates still render. Spend-derived verdicts are whatever the model already classified.
import Link from "next/link";
import { HairlineGrid, Lede, StatTile } from "@/components/kit";
import { fmtMoney, type AiDeliveryModel, type AiDeliverySummary } from "./aiDeliveryModel";
import { AiRoiLedgerTableV2 } from "./AiRoiLedgerTable.v2";
import { REVIEW_TARGET } from "../PrSignalsBand";
import { coverageTone, Toned, Unknown } from "../deliveryV2Marks";

function takeaway(s: AiDeliverySummary): string {
  const gov = s.governedAiShare == null ? "governance not yet measurable" : `${s.governedAiShare}% of it reviewed`;
  const bits = [`${fmtMoney(s.totalMonthlySpend)}/mo across ${s.totalSeats} seats`, `AI reaches ${s.aiShareOfPRs}% of merged PRs`, gov];
  const tail: string[] = [];
  if (s.idleSpend > 0) tail.push(`${fmtMoney(s.idleSpend)}/mo idle`);
  if (s.ungovernedSpend > 0) tail.push(`${fmtMoney(s.ungovernedSpend)}/mo ungoverned`);
  return `${bits.join(" · ")}${tail.length ? `: ${tail.join(", ")}.` : "."}`;
}

export function AiRoiLedgerV2({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const s = model.summary;
  const locked = model.fidelity === "none";
  const spend = locked ? <Unknown label="no cost source" subject="AI spend" /> : fmtMoney(s.totalMonthlySpend);
  const perPr = locked ? (
    <Unknown label="no cost source" subject="cost per AI PR" />
  ) : s.costPerAiPr == null ? (
    <Unknown label={s.totalAiPRs > 0 ? "no spend" : "no AI PRs"} />
  ) : (
    `$${s.costPerAiPr.toLocaleString()}`
  );
  return (
    <div className="space-y-4">
      <HairlineGrid className="sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="AI spend / mo" value={spend} sub={locked ? "connect a provider" : `${fmtMoney(s.annualSpend)}/yr · ${s.totalSeats} seats`} />
        <StatTile label="AI reach" value={`${s.aiShareOfPRs}%`} sub="of merged PRs" />
        <StatTile
          label="Governed AI"
          value={s.governedAiShare == null ? <Unknown label="too few AI PRs" /> : <Toned tone={coverageTone(s.governedAiShare, REVIEW_TARGET)}>{s.governedAiShare}%</Toned>}
          sub={s.governedAiShare == null ? "no sample" : "of AI PRs reviewed"}
        />
        <StatTile label="Cost / AI PR" value={perPr} sub={locked ? "connect a provider" : "fleet efficiency"} />
        <StatTile
          label="Idle spend / mo"
          value={locked ? <Unknown label="no cost source" subject="idle spend" /> : <Toned tone={s.idleSpend > 0 ? "risk" : undefined}>{s.idleSpend > 0 ? fmtMoney(s.idleSpend) : "$0"}</Toned>}
          sub={locked ? "connect a provider" : "reclaim candidates"}
        />
        <StatTile
          label="Ungoverned / mo"
          value={locked ? <Unknown label="no cost source" subject="ungoverned spend" /> : <Toned tone={s.ungovernedSpend > 0 ? "risk" : undefined}>{s.ungovernedSpend > 0 ? fmtMoney(s.ungovernedSpend) : "$0"}</Toned>}
          sub={locked ? "connect a provider" : "AI dollars at risk"}
        />
      </HairlineGrid>
      {locked ? (
        <Lede>
          {s.seatSource && s.totalSeats > 0 && (
            <>
              {s.seatSource} reports <span className="text-slate-200">{s.totalSeats} seats</span> for the org. Repository seat allocation is unknown.{" "}
            </>
          )}
          AI reaches <span className="text-slate-200">{s.aiShareOfPRs}%</span> of merged PRs
          {s.governedAiShare != null && (
            <>
              , <span className="text-slate-200">{s.governedAiShare}%</span> reviewed
            </>
          )}
          , both real, from git. Spend, idle, and ROI have no cost source until you{" "}
          <Link href={`/org/${slug}/integrations`} className="text-slate-200 underline hover:text-white">
            connect a provider
          </Link>
          .
        </Lede>
      ) : (
        <Lede>{takeaway(s)}</Lede>
      )}
      <AiRoiLedgerTableV2 model={model} />
    </div>
  );
}
