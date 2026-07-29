"use client";

// The knowledge layer, drawn: value-ranked memory recall on top, skill dormancy underneath.
//
// Both halves use the product's OWN taxonomies rather than invented ones — `MEMORY_KINDS` /
// `MEMORY_KIND_LABEL` from src/lib/org/memory-kinds.ts and `SkillUsageVerdict` /
// `usageVerdictLabel` + `DORMANCY_WINDOW_DAYS` from src/lib/org/skill-usage.ts. If the org ever gains
// a memory kind or renames a verdict, this diagram says the new word, because it never learned the
// old one.

import { motion } from "framer-motion";
import { MEMORY_KIND_LABEL, type MemoryKind } from "@/lib/org/memory-kinds";
import { DORMANCY_WINDOW_DAYS, usageVerdictLabel, type SkillUsageVerdict } from "@/lib/org/skill-usage";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";

interface Recalled {
  kind: MemoryKind;
  text: string;
  /** Relevance the recall pass assigned, 0..100 — what "value-ranked" means in one number. */
  value: number;
}

// A plausible recall for one query. Ordered by value, because that is the whole claim: the store
// returns what is WORTH returning under a budget, not the most recent thing written.
const RECALL: Recalled[] = [
  { kind: "procedural", text: "Roll migrations behind the read-path flag, then backfill.", value: 94 },
  { kind: "semantic", text: "billing-api owns the invoice schema; payments-web only reads it.", value: 81 },
  { kind: "episodic", text: "Q2 incident: the retry storm came from the webhook fan-out.", value: 67 },
  { kind: "summary", text: "Three prior migrations, consolidated into one runbook.", value: 52 },
];

const SKILLS: Array<{ name: string; verdict: SkillUsageVerdict; uses: number }> = [
  { name: "pr-review-rubric", verdict: "active", uses: 128 },
  { name: "incident-postmortem", verdict: "active", uses: 46 },
  { name: "schema-migration", verdict: "new", uses: 7 },
  { name: "legacy-batch-runner", verdict: "dormant", uses: 0 },
];

const VERDICT_TONE: Record<SkillUsageVerdict, string> = {
  new: "text-accent",
  active: "text-tone-rising",
  dormant: "text-slate-500",
};

export function KnowledgeLedger() {
  const reduced = usePrefersReducedMotion();
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-divider bg-ink px-3 py-2">
        <span aria-hidden className="font-mono text-xs text-slate-600">
          ?
        </span>
        <span className="truncate font-mono text-xs text-slate-300">
          recall: <span className="text-accent">&quot;how do we ship a schema change safely&quot;</span>
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {RECALL.map((r, i) => (
          <motion.li
            key={r.text}
            className="rounded-lg border border-divider bg-surface/40 p-3"
            // Ranked arrival: the highest-value memory lands first, so the order you SEE is the order
            // the recall pass chose. Non-transform `opacity` is gated explicitly (reducedMotion="user"
            // does not degrade it).
            initial={reduced ? false : { opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, margin: "-12%" }}
            transition={reduced ? { duration: 0 } : { duration: 0.32, delay: 0.1 + i * 0.09 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {MEMORY_KIND_LABEL[r.kind]}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">{r.value}</span>
            </div>
            <p className="mt-1.5 text-sm leading-snug text-slate-300">{r.text}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-divider">
              <motion.span
                className="block h-full rounded-full bg-accent"
                style={reduced ? { width: `${r.value}%` } : undefined}
                initial={reduced ? false : { width: 0 }}
                whileInView={reduced ? undefined : { width: `${r.value}%` }}
                viewport={{ once: false, margin: "-12%" }}
                transition={reduced ? { duration: 0 } : { duration: 0.5, delay: 0.18 + i * 0.09, ease: "easeOut" }}
              />
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="mt-5 border-t border-divider pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Skills library</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">
            {DORMANCY_WINDOW_DAYS}-day window
          </span>
        </div>
        <ul className="mt-2 divide-y divide-divider/70">
          {SKILLS.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate font-mono text-xs text-slate-300">{s.name}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-slate-600">{s.uses} uses</span>
                <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${VERDICT_TONE[s.verdict]}`}>
                  {usageVerdictLabel(s.verdict)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
