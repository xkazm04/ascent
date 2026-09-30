// Per-repo reconciliation. Locked money stays empty. A planned repo at $0 shows $0.
// A repo with no telemetry stays unknown. Verdicts are the model's word, not a hue.
import Link from "next/link";
import { CELL, CELL_NUM, DataTable, HEAD_CELL } from "@/components/kit";
import { fmtMoney, VERDICT_META, type AiDeliveryModel, type AiRepoRoi, type Verdict } from "./aiDeliveryModel";
import { Unknown } from "../deliveryV2Marks";

const GLYPH: Record<Verdict, string> = { working: "✓", ungoverned: "▲", idle: "◆", shadow: "◆", starter: "·" };

function namedTool(tool: string): string | null {
  return /[A-Za-z0-9]/.test(tool) ? tool : null;
}

function MoneyCell({ locked, text, empty }: { locked: boolean; text: string | null; empty: string }) {
  if (locked) return <Unknown label="no cost source" />;
  if (text == null) return <Unknown label={empty} />;
  return <>{text}</>;
}

function VerdictWord({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span title={meta.blurb}>
      <span className="sr-only">{meta.label}</span>
      <span aria-hidden>
        <span className="mr-1">{GLYPH[verdict]}</span>
        {meta.label}
      </span>
    </span>
  );
}

function Row({ r, locked }: { r: AiRepoRoi; locked: boolean }) {
  const tool = namedTool(r.tool);
  const dollars = !locked && r.planned ? (r.monthlySpend > 0 ? fmtMoney(r.monthlySpend) : "$0") : null;
  const per = !locked && r.costPerAiPr != null ? `$${r.costPerAiPr.toLocaleString()}` : null;
  return (
    <tr>
      <td className={CELL}>
        <Link href={`/report/${r.fullName}`} className="focus-ring text-white hover:underline">{r.name}</Link>
      </td>
      <td className={CELL}>{locked || !tool ? <Unknown label={locked ? "no cost source" : "not measured"} /> : tool}</td>
      <td className={CELL_NUM}>
        <MoneyCell locked={locked} text={r.planned ? String(r.seats) : null} empty="not allocated" />
      </td>
      <td className={CELL_NUM}>
        <MoneyCell locked={locked} text={dollars} empty="not measured" />
      </td>
      <td className={CELL_NUM}>
        {r.aiInvolvedRate}% <span className="text-slate-400">{r.aiPRs} PR</span>
      </td>
      <td className={CELL_NUM}>
        {r.governedRate == null ? <span title="too few AI PRs to measure"><Unknown label="too few AI PRs" /></span> : `${r.governedRate}%`}
      </td>
      <td className={CELL_NUM}>
        <MoneyCell locked={locked} text={per} empty={r.aiPRs > 0 ? "no spend" : "no AI PRs"} />
      </td>
      <td className={CELL_NUM}>
        <VerdictWord verdict={r.verdict} />
      </td>
    </tr>
  );
}

export function AiRoiLedgerTableV2({ model }: { model: AiDeliveryModel }) {
  const locked = model.fidelity === "none";
  return (
    <DataTable
      density="compact"
      stickyFirstCol
      minWidth={820}
      size="sm"
      caption="AI spend reconciled against AI output and governance, per repository, highest-concern first"
      head={
        <tr>
          <th className={HEAD_CELL}>Repo</th>
          <th className={HEAD_CELL}>Tool</th>
          <th className={`${HEAD_CELL} text-right`}>Seats</th>
          <th className={`${HEAD_CELL} text-right`}>$/mo</th>
          <th className={`${HEAD_CELL} text-right`}>AI reach</th>
          <th className={`${HEAD_CELL} text-right`} title="AI PRs with an approving review">Governed</th>
          <th className={`${HEAD_CELL} text-right`} title="spend divided by AI-attributed PRs">$/AI-PR</th>
          <th className={`${HEAD_CELL} text-right`}>Verdict</th>
        </tr>
      }
    >
      {model.repos.map((r) => (
        <Row key={r.fullName} r={r} locked={locked} />
      ))}
    </DataTable>
  );
}
