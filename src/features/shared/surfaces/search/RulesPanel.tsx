"use client";

// typed-filter-language: the rule box. An expression typed at authoring time through the one door;
// the verdict renders beside the input and names the node; an accepted rule runs against every row on
// the current page; a persisted rule that no longer types is marked broken on the surface it governs,
// and its lane shows nothing rather than everything. The validity table runs live.

import { useMemo, useState } from "react";
import { Field, TextArea } from "@/components/ui";
import { compileRule, toRuleRow, TYPING_CONTEXT } from "./rules";
import { SEED_RULES, VALIDITY_TABLE } from "./ruleTable";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Readout, Region } from "./sceneParts";

export function RulesPanel({ s }: { s: FleetSearch }) {
  const [src, setSrc] = useState(SEED_RULES[0].src);
  const [activeId, setActiveId] = useState(SEED_RULES[0].id);
  const verdict = useMemo(() => compileRule(src), [src]);
  const persisted = useMemo(() => SEED_RULES.map((r) => ({ ...r, verdict: compileRule(r.src) })), []);
  const active = persisted.find((r) => r.id === activeId)!;
  const rows = s.pageRows.map((r) => r.repo);
  const passing = verdict.ok ? rows.filter((r) => verdict.run(toRuleRow(r))) : [];

  return (
    <Region technique="typed-filter-language" title="A program, typed before it runs" note="The search box tolerates; the rule box refuses. Every node gets a type from a closed set before the first row is seen.">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <Field label={`rule — identifiers: ${Object.keys(TYPING_CONTEXT).join(", ")}`} error={verdict.ok ? null : `${verdict.message} — problem occurred here: ${verdict.snippet || "end of rule"}`}>
            <TextArea value={src} onChange={(e) => setSrc(e.target.value)} rows={2} aria-label="Filter rule" spellCheck={false} />
          </Field>
          <div className="mt-2 space-y-1">
            <Readout label="verdict" value={<span data-verdict={verdict.ok ? "ok" : "refused"}>{verdict.ok ? "well-typed: bool" : "refused"}</span>} tone={verdict.ok ? "text-success-soft" : "text-danger"} />
            <Readout label="pass on this page" value={<span data-rule-passing={passing.length}>{verdict.ok ? `${passing.length} of ${rows.length}` : "not evaluated"}</span>} />
          </div>
          <ul className="mt-2 space-y-0.5" data-rule-lane>
            {verdict.ok ? passing.slice(0, 4).map((r) => (
              <li key={r.id} className="type-caption text-slate-300">
                <span className="font-mono">{r.owner}/{r.name}</span> <span className="text-slate-600">· L{r.level} · {r.status} · {r.tags.join(",")}</span>
              </li>
            )) : null}
          </ul>
        </div>
        <div>
          <p className="type-label uppercase tracking-[0.2em] text-slate-500">persisted rules</p>
          <ul className="mt-1 space-y-1" data-persisted-rules>
            {persisted.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <button type="button" className={BTN} onClick={() => (setActiveId(r.id), setSrc(r.src))} aria-current={r.id === activeId ? "true" : undefined}>
                  {r.name}
                </button>
                <span className={`type-caption ${r.verdict.ok ? "text-success-soft" : "text-danger"}`} data-rule-load={r.verdict.ok ? "valid" : "broken"}>
                  {r.verdict.ok ? "valid" : "broken at load"}
                </span>
              </li>
            ))}
          </ul>
          {!active.verdict.ok ? (
            <p className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-2 type-caption text-danger" role="alert">
              “{active.name}” no longer types ({active.verdict.message}). Its lane shows nothing — not everything, not a silent subset — until it is repaired.
            </p>
          ) : null}
        </div>
      </div>
      <table className="mt-3 w-full type-caption" data-validity-table>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">expression</th>
            <th className="font-normal">verdict</th>
            <th className="font-normal">rule</th>
          </tr>
        </thead>
        <tbody>
          {VALIDITY_TABLE.map((row) => {
            const v = compileRule(row.src);
            const agrees = v.ok === (row.verdict === "ok");
            return (
              <tr key={row.src} className="border-t border-divider text-slate-300" data-validity={agrees ? "agrees" : "disagrees"}>
                <td className="py-0.5 pr-2 font-mono text-slate-400">{row.src}</td>
                <td className={`py-0.5 pr-2 ${v.ok ? "text-success-soft" : "text-danger"}`}>{v.ok ? "ok" : "refused"}</td>
                <td className="py-0.5 text-slate-500">{row.why}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Region>
  );
}
