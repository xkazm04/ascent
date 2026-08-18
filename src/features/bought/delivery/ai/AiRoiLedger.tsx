// Table view — "AI P&L". The mental model is a finance statement: the fleet's AI spend read like a
// one-page profit-and-loss a VP Eng / CFO would sign off. A headline ledger of the money numbers, one
// plain-language verdict line, then a dense hairline table — one row per repo — that reconciles spend
// against what the AI actually produced (AI-attributed PRs) and whether that work was governed. Every
// number that isn't money is real (git-derived); money is the noCostSource connector layer.
//
// Editorial/instrument voice: TILE_LEDGER money row, mono tabular figures, verdict chips carry the
// judgement. Server-safe (no hooks) — the client module renders it for the Table view.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { OrgTable, Meter } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { fmtMoney, type AiDeliveryModel, type AiRepoRoi } from "./aiDeliveryModel";
import { VerdictChip } from "./aiShared";

function Money({
  label,
  value,
  sub,
  color,
  locked,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** No connected provider reports COST — render the money cells empty with a connect prompt rather
   *  than a fabricated dollar figure. */
  locked?: boolean;
}) {
  return (
    <div className="bg-ink p-4">
      <Kicker tone="muted">{label}</Kicker>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: locked ? "#475569" : color ?? "#e2e8f0" }}>
        {locked ? "—" : value}
      </div>
      {(locked || sub) && <div className="mt-0.5 font-mono text-xs text-slate-500">{locked ? "connect a provider" : sub}</div>}
    </div>
  );
}

function verdictLine(m: AiDeliveryModel["summary"]): string {
  const govPhrase = m.governedAiShare == null ? "governance not yet measurable" : `${m.governedAiShare}% of it reviewed`;
  const bits = [`${fmtMoney(m.totalMonthlySpend)}/mo across ${m.totalSeats} seats`, `AI reaches ${m.aiShareOfPRs}% of merged PRs`, govPhrase];
  const tail: string[] = [];
  if (m.idleSpend > 0) tail.push(`${fmtMoney(m.idleSpend)}/mo idle`);
  if (m.ungovernedSpend > 0) tail.push(`${fmtMoney(m.ungovernedSpend)}/mo ungoverned`);
  return `${bits.join(" · ")}${tail.length ? `: ${tail.join(", ")}.` : "."}`;
}

function LedgerRow({ r, noCostSource }: { r: AiRepoRoi; noCostSource: boolean }) {
  // W3c: with no cost source there IS no spend layer — the model no longer synthesizes one, so these
  // cells are empty rather than blurred-but-populated. Adoption (AI reach) and governance are always
  // real (git-derived) and render normally either way.
  const sample = (
    <span className="text-slate-600" title="No provider reports cost: connect one for spend figures">
      —
    </span>
  );
  return (
    <tr className="text-slate-300">
      <td className="px-4 py-2">
        <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-white transition hover:text-accent">
          {r.name}
        </Link>
      </td>
      <td className="px-3 py-2 font-mono text-sm text-slate-400">{noCostSource ? sample : r.tool}</td>
      <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-slate-400">{noCostSource ? sample : r.planned ? r.seats : "—"}</td>
      <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-white">{noCostSource ? sample : r.monthlySpend > 0 ? fmtMoney(r.monthlySpend) : "—"}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <Meter value={r.aiInvolvedRate} color={scoreHex(r.aiInvolvedRate)} className="w-16" size="sm" />
          <span className="w-14 text-right font-mono text-sm tabular-nums text-slate-400">
            {r.aiPRs} <span className="text-slate-600">PR</span>
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-center font-mono text-sm tabular-nums">
        {r.governedRate == null ? (
          <span className="text-slate-600" title="too few AI PRs to measure">—</span>
        ) : (
          <span style={{ color: scoreHex(r.governedRate) }}>{r.governedRate}%</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-slate-200">
        {noCostSource ? sample : r.costPerAiPr == null ? <span className="text-slate-600">—</span> : `$${r.costPerAiPr.toLocaleString()}`}
      </td>
      <td className="px-3 py-2 text-right">
        <VerdictChip verdict={r.verdict} />
      </td>
    </tr>
  );
}

export function AiRoiLedger({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const s = model.summary;
  const noCostSource = model.fidelity === "none";
  return (
    <div className="space-y-4">
      {/* headline money ledger — the $-denominated tiles lock when spend is noCostSource (no provider). */}
      <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-3 xl:grid-cols-6">
        <Money label="AI spend / mo" value={fmtMoney(s.totalMonthlySpend)} sub={`${fmtMoney(s.annualSpend)}/yr · ${s.totalSeats} seats`} locked={noCostSource} />
        <Money label="AI reach" value={`${s.aiShareOfPRs}%`} sub="of merged PRs" color={scoreHex(s.aiShareOfPRs)} />
        <Money
          label="Governed AI"
          value={s.governedAiShare == null ? "—" : `${s.governedAiShare}%`}
          sub={s.governedAiShare == null ? "no sample" : "of AI PRs reviewed"}
          color={s.governedAiShare == null ? undefined : scoreHex(s.governedAiShare)}
        />
        <Money label="Cost / AI PR" value={s.costPerAiPr == null ? "—" : `$${s.costPerAiPr.toLocaleString()}`} sub="fleet efficiency" locked={noCostSource} />
        <Money label="Idle spend / mo" value={s.idleSpend > 0 ? fmtMoney(s.idleSpend) : "$0"} sub="reclaim candidates" color={s.idleSpend > 0 ? "#f97316" : undefined} locked={noCostSource} />
        <Money label="Ungoverned / mo" value={s.ungovernedSpend > 0 ? fmtMoney(s.ungovernedSpend) : "$0"} sub="AI $ at risk" color={s.ungovernedSpend > 0 ? "#ef4444" : undefined} locked={noCostSource} />
      </div>

      {/* the takeaway — in noCostSource mode state only the real (git) facts + a connect prompt, never fake $. */}
      {noCostSource ? (
        <p className="text-sm text-slate-400">
          AI reaches <span className="font-mono text-slate-200">{s.aiShareOfPRs}%</span> of merged PRs
          {s.governedAiShare != null && (
            <>
              , <span className="font-mono text-slate-200">{s.governedAiShare}%</span> reviewed
            </>
          )}
          , both real, from git. Spend, idle, and ROI are a deterministic sample until you{" "}
          <Link href={`/org/${slug}/integrations`} className="text-accent transition hover:underline">
            connect a provider
          </Link>
          .
        </p>
      ) : (
        <p className="text-sm text-slate-300">{verdictLine(s)}</p>
      )}

      {/* per-repo reconciliation ledger */}
      <OrgTable
        minWidth={820}
        caption="AI spend reconciled against AI output and governance, per repository, highest-concern first"
        head={
          <tr>
            <th className="px-4 py-2 text-left">Repo</th>
            <th className="px-3 py-2 text-left">Tool</th>
            <th className="px-3 py-2 text-right">Seats</th>
            <th className="px-3 py-2 text-right">$/mo</th>
            <th className="px-3 py-2 text-right">AI reach</th>
            <th className="px-3 py-2 text-center" title="AI PRs with an approving review">Governed</th>
            <th className="px-3 py-2 text-right" title="spend ÷ AI-attributed PRs">$/AI-PR</th>
            <th className="px-3 py-2 text-right">Verdict</th>
          </tr>
        }
      >
        {model.repos.map((r) => (
          <LedgerRow key={r.fullName} r={r} noCostSource={noCostSource} />
        ))}
      </OrgTable>
    </div>
  );
}
