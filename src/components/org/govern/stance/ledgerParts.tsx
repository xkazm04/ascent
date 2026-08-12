// Variant C (Ledger) — the revision timeline, the clause-adoption rows, and the per-repo compliance
// table. Co-located so StanceLedger.tsx stays the orchestrator and under 300 LOC. Server-safe.

import { Kicker } from "@/components/ui";
import { MeterRow, OrgTable } from "@/components/org/shared/ui";
import { scoreHex, reportPermalink } from "@/lib/ui";
import type { AiStanceDoc } from "./stanceMock";
import { AckMark, ComplianceBar, TierBadge, complianceVerdict } from "./stanceShared";

/** The stance's revision history — a policy is a contract, and a contract has amendments. */
export function VersionTimeline({ doc }: { doc: AiStanceDoc }) {
  return (
    <ol className="relative space-y-5 border-l border-divider pl-5">
      {doc.history.map((v, i) => {
        const current = i === 0;
        const lagging = current ? doc.repos.filter((r) => r.ack !== "current").length : 0;
        return (
          <li key={v.version} className="relative">
            <span
              aria-hidden
              className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full"
              style={{ backgroundColor: current ? "#3b9eff" : "#1e293b", outline: current ? "3px solid #3b9eff22" : undefined }}
            />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className={`font-mono text-base tabular-nums ${current ? "text-accent" : "text-slate-400"}`}>{v.version}</span>
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
                {v.date} · {v.author}
              </span>
              {current && (
                <span className="rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-xs uppercase tracking-[0.18em] text-accent">
                  in force
                </span>
              )}
            </div>
            <p className="mt-1 text-base text-slate-200">{v.summary}</p>
            <ul className="mt-1.5 space-y-0.5">
              {v.changes.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-slate-500">
                  <span aria-hidden className="select-none text-slate-700">·</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            {current && lagging > 0 && (
              <p className="mt-2 font-mono text-sm text-orange-300">
                {lagging} repo{lagging === 1 ? "" : "s"} have not adopted this amendment
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Clause-level adoption: which parts of the contract the fleet actually honours. */
export function ClauseAdoption({ doc }: { doc: AiStanceDoc }) {
  const total = Math.max(1, doc.repos.length);
  const rows: { label: string; value: number; note: string }[] = [
    {
      label: "Tool allowlist",
      value: Math.round((doc.repos.filter((r) => r.ack !== "unacked").length / total) * 100),
      note: `${doc.tools.filter((t) => t.status === "forbidden").length} tools forbidden`,
    },
    {
      label: "No-AI zones",
      value: Math.round((doc.repos.filter((r) => r.violations === 0).length / total) * 100),
      note: `${doc.zones.reduce((a, z) => a + z.violations, 0)} breaches on record`,
    },
    {
      label: "Review tiers",
      value: Math.round((doc.repos.filter((r) => r.ack === "current").length / total) * 100),
      note: `${doc.repos.filter((r) => r.tier === "T2" || r.tier === "T3").length} repos at T2+`,
    },
    ...doc.provenance.map((p) => ({
      label: p.label,
      value: p.coverage,
      note: p.enforced ? "enforced in CI" : "advisory only",
    })),
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <MeterRow
            layout="labelled"
            label={r.label}
            value={r.value}
            display={`${r.value}%`}
            color={scoreHex(r.value)}
            valueColor={scoreHex(r.value)}
            valueClassName="w-12 font-mono text-sm tabular-nums"
          />
          <p className="ml-36 pl-3 text-sm text-slate-500">{r.note}</p>
        </div>
      ))}
    </div>
  );
}

/** The ledger proper: one row per repo, one column per obligation. */
export function ComplianceLedger({ doc }: { doc: AiStanceDoc }) {
  const rows = [...doc.repos].sort((a, b) => a.compliance - b.compliance);
  return (
    <OrgTable
      caption="Per-repo compliance with the current AI stance"
      minWidth={880}
      head={
        <tr>
          <th className="px-4 py-2.5 text-left font-normal">Repository</th>
          <th className="px-4 py-2.5 text-left font-normal">Tier</th>
          <th className="px-4 py-2.5 text-left font-normal">Acknowledged</th>
          <th className="px-4 py-2.5 text-right font-normal">Provenance</th>
          <th className="px-4 py-2.5 text-right font-normal">Breaches</th>
          <th className="px-4 py-2.5 text-left font-normal">Compliance</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.fullName}>
          <td className="px-4 py-3">
            <a href={reportPermalink(r.fullName, null, doc.org)} className="focus-ring font-mono text-sm text-slate-200 hover:text-accent">
              {r.fullName}
            </a>
            <p className="text-sm text-slate-500">{complianceVerdict(r)}</p>
          </td>
          <td className="px-4 py-3">
            <TierBadge tier={r.tier} />
          </td>
          <td className="px-4 py-3">
            <AckMark ack={r.ack} showLabel={false} />
            <span className="ml-2 font-mono text-sm text-slate-400">{r.ackVersion ?? "never"}</span>
          </td>
          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums" style={{ color: scoreHex(r.provenance) }}>
            {r.provenance}%
          </td>
          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums" style={{ color: r.violations ? "#ef4444" : "#475569" }}>
            {r.violations || "—"}
          </td>
          <td className="px-4 py-3">
            <ComplianceBar repo={r} />
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}

/** Header rail: the contract's identity card — version, owner, cadence, next review. */
export function ContractHeader({ doc }: { doc: AiStanceDoc }) {
  const meta: [string, string][] = [
    ["Version", doc.version],
    ["Effective", doc.effective],
    ["Owner", doc.owner],
    ["Cadence", doc.reviewCadence],
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
      {meta.map(([k, v]) => (
        <div key={k} className="bg-ink px-5 py-3.5">
          <Kicker tone="muted">{k}</Kicker>
          <p className="mt-1 font-mono text-sm text-slate-200">{v}</p>
        </div>
      ))}
    </div>
  );
}
