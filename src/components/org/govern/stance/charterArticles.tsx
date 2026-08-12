// Variant A (Charter) — the four articles of the published stance, as editorial document sections.
// Co-located sub-components so StanceCharter.tsx stays the orchestrator and stays under 300 LOC.
// Server-safe (no hooks/handlers).

import { Kicker } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { TIER_HEX, TOOL_STATUS_HEX, type AiStanceDoc } from "./stanceMock";

const ROMAN = ["I", "II", "III", "IV", "V"];

/** A numbered article: a hairline-ruled editorial section with a mono ordinal in the margin. */
export function Article({ n, title, standfirst, children }: { n: number; title: string; standfirst: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-divider pt-6">
      <div className="flex gap-5">
        <div aria-hidden className="w-10 shrink-0 pt-1 font-mono text-2xl tabular-nums text-slate-700">
          {ROMAN[n - 1]}
        </div>
        <div className="min-w-0 flex-1">
          <Kicker>Article {ROMAN[n - 1]}</Kicker>
          <h3 className="mt-1.5 text-xl font-medium text-white">{title}</h3>
          <p className="mt-1.5 max-w-2xl text-base text-slate-300">{standfirst}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function ArticleTools({ doc }: { doc: AiStanceDoc }) {
  return (
    <ul className="divide-y divide-divider">
      {doc.tools.map((t) => (
        <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
          <span
            className="w-24 shrink-0 font-mono text-xs uppercase tracking-[0.18em]"
            style={{ color: TOOL_STATUS_HEX[t.status] }}
          >
            {t.status}
          </span>
          <span className="font-mono text-base text-slate-100">{t.name}</span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">{t.vendor}</span>
          <span className="w-full pl-24 text-sm text-slate-400 sm:w-auto sm:flex-1 sm:pl-0">{t.note}</span>
          <span className="font-mono text-sm tabular-nums text-slate-500">{t.reposUsing} repos</span>
        </li>
      ))}
    </ul>
  );
}

export function ArticleZones({ doc }: { doc: AiStanceDoc }) {
  return (
    <ul className="space-y-3">
      {doc.zones.map((z) => (
        <li key={z.id} className="rounded-xl border border-divider bg-surface-strong/40 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="font-mono text-base text-slate-100">{z.pattern}</code>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              {z.scope} scope · {z.repos.length} repos bound
            </span>
          </div>
          <p className="mt-1.5 text-sm text-slate-400">{z.reason}</p>
          <p className="mt-1.5 font-mono text-sm" style={{ color: z.violations ? "#ef4444" : "#10b981" }}>
            {z.violations ? `${z.violations} AI-attributed change${z.violations === 1 ? "" : "s"} observed inside this zone` : "No breaches observed"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ArticleTiers({ doc }: { doc: AiStanceDoc }) {
  return (
    <ol className="grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2">
      {doc.tiers.map((t) => (
        <li key={t.id} className="bg-ink p-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg tabular-nums" style={{ color: TIER_HEX[t.id] }}>
              {t.id}
            </span>
            <span className="text-base font-medium text-white">{t.name}</span>
            <span className="ml-auto font-mono text-sm tabular-nums text-slate-500">{t.repos.length} repos</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{t.blurb}</p>
          <p className="mt-2 text-sm text-slate-200">{t.review}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.examples.map((e) => (
              <code key={e} className="rounded-full border border-divider px-2 py-0.5 font-mono text-xs text-slate-500">
                {e}
              </code>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ArticleProvenance({ doc }: { doc: AiStanceDoc }) {
  return (
    <ul className="space-y-3">
      {doc.provenance.map((p) => (
        <li key={p.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-base text-slate-100">
              {p.label}
              <span className="ml-2 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: p.enforced ? "#10b981" : "#f97316" }}>
                {p.enforced ? "enforced" : "advisory"}
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums" style={{ color: scoreHex(p.coverage) }}>
              {p.coverage}% of fleet
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{p.requirement}</p>
          <Meter className="mt-1.5" size="sm" value={p.coverage} color={scoreHex(p.coverage)} ariaLabel={`${p.label} fleet coverage`} />
        </li>
      ))}
    </ul>
  );
}
