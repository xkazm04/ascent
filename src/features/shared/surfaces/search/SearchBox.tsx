"use client";

// query-parsing: the box. Raw text goes through the one door and the recognized structure comes back
// as chips — typed clauses (a negated one, an unknown value shown broken), phrases, excluded words,
// the tokens the door refused and the prefix it kept literal — so the grammar is learned by seeing what
// was understood. Below: the rung the ladder answered from (labelled), the scope that was searched,
// and the three empty states spelled apart: no matches, degraded, engine failure with retry.

import { Field, TextInput } from "@/components/ui";
import { RUNGS } from "./search";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Chip, Readout, Region } from "./sceneParts";

const SCOPE = "name ×3 · owner ×1.5 · description ×1";

export function SearchBox({ s }: { s: FleetSearch }) {
  const { parsed: p, exec } = s;
  const rung = exec.kind === "ok" ? exec.rung : null;
  const degraded = rung !== null && rung > 0 && exec.kind === "ok" && exec.hits.size > 0;
  const stripClause = (i: number) => {
    // Removing a chip edits the text it came from: the chip is the deletion affordance.
    const c = p.clauses[i];
    if (!c) return;
    const token = `${c.negated ? "-" : ""}${c.field}:`;
    const re = new RegExp(`(^|\\s)${token.replace(/[-]/g, "\\-")}\\S+`, "i");
    s.setText(s.text.replace(re, "$1").replace(/\s{2,}/g, " ").trim());
  };
  const state = exec.kind === "failure" ? "failure" : exec.hits.size === 0 ? "empty" : degraded ? "degraded" : "ok";

  return (
    <Region technique="query-parsing" title="One door between your words and the engine" note='Try: status:fail -lang:go "session events"  ·  résumé  ·  note:keep  ·  a  ·  an unbalanced "quote'>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <Field label={`Search repositories — scope: ${SCOPE}`}>
            <TextInput value={s.text} onChange={(e) => s.setText(e.target.value)} placeholder="words, “phrases”, field:value, -excluded" aria-label="Search repositories" autoComplete="off" />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5" data-chips>
            {p.clauses.map((c, i) => (
              <Chip key={`${c.field}:${c.value}:${i}`} tone={c.known ? (c.negated ? "warn" : "idle") : "danger"} onRemove={() => stripClause(i)} title={c.known ? undefined : "not in the vocabulary — lifted, shown broken, matches nothing"}>
                <span data-clause={c.field} data-known={c.known}>
                  {c.negated ? "not " : ""}
                  {c.field} = {c.value}
                  {c.known ? "" : " ?"}
                </span>
              </Chip>
            ))}
            {p.phrases.map((ph) => (
              <Chip key={ph.join(" ")} tone="idle">
                <span data-phrase>“{ph.join(" ")}”</span>
              </Chip>
            ))}
            {p.negTerms.map((t) => (
              <Chip key={`-${t}`} tone="warn">
                −{t}
              </Chip>
            ))}
            {p.terms.map((t) => (
              <Chip key={`t-${t}`} tone="default">
                <span data-term>{t}</span>
              </Chip>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            <Readout label="refused by the door" value={p.dropped.length ? p.dropped.map((d) => `"${d}"`).join(" ") : "—"} tone={p.dropped.length ? "text-warn" : "text-slate-500"} />
            <Readout label="kept literal" value={p.literalPrefixes.length ? p.literalPrefixes.join(" ") : "—"} tone="text-slate-400" />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-divider p-3" data-search-state={state}>
          {exec.kind === "failure" ? (
            <>
              <p className="type-body-sm text-danger" role="alert">
                Nothing was searched: {exec.message}.
              </p>
              <button type="button" className={BTN} onClick={() => s.setDown(false)}>
                retry
              </button>
            </>
          ) : (
            <>
              <Readout label="answered from rung" value={<span data-rung={rung}>{`${rung! + 1} · ${RUNGS[rung!]}`}</span>} tone={degraded ? "text-warn" : "text-slate-200"} />
              <Readout label="matched" value={`${exec.hits.size.toLocaleString()} of ${exec.searched.toLocaleString()} searched`} />
              {degraded ? (
                <p className="type-caption text-warn">Showing results matching {rung === 1 ? "all your words, phrases relaxed" : rung === 2 ? "any of your words" : "your words as prefixes"} — not the query as written.</p>
              ) : exec.hits.size === 0 ? (
                <p className="type-caption text-slate-400">No matches at any rung. The search ran over {exec.searched.toLocaleString()} rows; broaden the words or drop a clause.</p>
              ) : (
                <p className="type-caption text-slate-500">As written: every word, every phrase intact, every clause applied.</p>
              )}
            </>
          )}
          <button type="button" className={BTN} onClick={() => s.setDown(!s.down)} aria-pressed={s.down}>
            {s.down ? "bring the engine up" : "simulate engine failure"}
          </button>
        </div>
      </div>
    </Region>
  );
}
