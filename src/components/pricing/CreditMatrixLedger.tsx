"use client";

// Variant A — "Ledger". The editorial index direction: one hairline-ruled comparison table with a
// leading Cost column, so scanning DOWN the table the credit/free/included distinction is the first
// thing the eye tracks. Closest sibling to DimensionMatrix — mono heads, tabular figures, no HUD chrome.

import { motion } from "framer-motion";
import { SectionHeading, Surface } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";
import { CreditTagChip, CellMark, PlanHead } from "./creditMatrixAtoms";
import { MATRIX_PLANS, MATRIX_GROUPS, CREDIT_RULE, CREDIT_TAG_META } from "./creditMatrixData";

const FEATURED = "bg-accent/[0.04]"; // subtle down-column tint for the Team (featured) plan

export function CreditMatrixLedger() {
  const reduced = usePrefersReducedMotion();
  return (
    <section className="w-full">
      <SectionHeading
        size="page"
        kicker="Credits & capabilities"
        title="Where your credits actually go"
        intro="One prepaid credit pays for one thing. Read down the Cost column: only a private scan past your monthly allowance ever draws on credits — everything else is free or included."
      />

      <RuleBar />

      <Surface className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <caption className="sr-only">
            Which operations cost scan credits and which capabilities each package includes.
          </caption>
          <thead>
            <tr className="border-b border-divider">
              <th scope="col" className="px-5 py-4 font-mono text-xs uppercase tracking-widest text-slate-500">
                Operation
              </th>
              <th scope="col" className="px-3 py-4 font-mono text-xs uppercase tracking-widest text-slate-500">
                Cost
              </th>
              {MATRIX_PLANS.map((p) => (
                <th key={p.id} scope="col" className={`px-3 py-4 ${p.featured ? FEATURED : ""}`}>
                  <PlanHead plan={p} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_GROUPS.map((g) => (
              <GroupBlock key={g.key} group={g} reduced={reduced} />
            ))}
          </tbody>
        </table>
      </Surface>
    </section>
  );
}

function GroupBlock({ group, reduced }: { group: (typeof MATRIX_GROUPS)[number]; reduced: boolean }) {
  return (
    <>
      <tr className="border-b border-divider bg-surface-strong/30">
        <th colSpan={2 + MATRIX_PLANS.length} scope="colgroup" className="px-5 py-2.5">
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-accent">{group.title}</span>
          <span className="ml-3 text-sm font-normal text-slate-500">{group.intro}</span>
        </th>
      </tr>
      {group.rows.map((r, i) => (
        <motion.tr
          key={r.label}
          className="border-b border-divider/60 last:border-0"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={reduced ? { duration: 0 } : { duration: 0.4, delay: Math.min(i * 0.04, 0.2) }}
        >
          <th scope="row" className="px-5 py-4 align-top font-normal">
            <div className="text-sm font-semibold text-white">{r.label}</div>
            <div className="mt-0.5 max-w-sm text-sm leading-snug text-slate-500">{r.detail}</div>
          </th>
          <td className="px-3 py-4 align-top">
            <CreditTagChip tag={r.tag} />
          </td>
          {MATRIX_PLANS.map((p) => (
            <td key={p.id} className={`px-3 py-4 text-center align-top ${p.featured ? FEATURED : ""}`}>
              <CellMark value={r.cells[p.id]} />
            </td>
          ))}
        </motion.tr>
      ))}
    </>
  );
}

function RuleBar() {
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-3xl text-base text-slate-200">
        <span className="font-mono text-xs uppercase tracking-widest text-accent">The rule ·</span> {CREDIT_RULE}
      </p>
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 font-mono text-xs uppercase tracking-widest text-slate-500">
        {(["credit", "free", "plan"] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span aria-hidden className={t === "credit" ? "text-accent" : "text-slate-400"}>
              {CREDIT_TAG_META[t].glyph}
            </span>
            {CREDIT_TAG_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}
