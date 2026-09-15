"use client";

// semantic-level-selection: the level is chosen from the entity, not from the tooling. The same pair at
// byte, line and field level yields three different "difference" counts; the phantom count is what
// text-diffing a structured entity manufactures, and positional alignment is the trap inside the level.
// The normalization ledger is one function with one version, listed here as the contract it is.

import { useMemo } from "react";
import type { Signal } from "./fixtures";
import { diffFields, LEDGER, LEDGER_VERSION, type Alignment, type DiffResult, type Level } from "./kernel";
import { Chip, Readout, Region } from "./parts";

const LEVELS: readonly { id: Level; hint: string }[] = [
  { id: "bytes", hint: "identical or not — a pre-check, never a presentation level" },
  { id: "lines", hint: "right for text; here a serialized entity, so formatting churn becomes edits" },
  { id: "fields", hint: "the entity's own schema; equality chosen per field; lists aligned by key" },
];

export function LevelRegion({
  level,
  onLevel,
  alignment,
  onAlignment,
  base,
  cand,
  result,
}: {
  level: Level;
  onLevel: (l: Level) => void;
  alignment: Alignment;
  onAlignment: (a: Alignment) => void;
  base: readonly Signal[];
  cand: readonly Signal[];
  result: DiffResult | null;
}) {
  // What positional alignment would have claimed, counted so the surface can say what it avoided.
  const spuriousPositional = useMemo(() => {
    const keyed = diffFields(base, cand, "keyed", 0).differences;
    const positional = diffFields(base, cand, "positional", 0).differences;
    return Math.max(0, positional - keyed);
  }, [base, cand]);
  const hint = LEVELS.find((l) => l.id === level)?.hint ?? "";

  return (
    <Region technique="semantic-level-selection" title="Semantic level" note="Diff each thing at its own level: fields for structured data, text for text. The surface states its level, so an unmarked row is a scoped claim.">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Comparison level">
          {LEVELS.map((l) => (
            <Chip key={l.id} on={level === l.id} onClick={() => onLevel(l.id)} label={`Level ${l.id}`}>
              {l.id}
            </Chip>
          ))}
          <span className="mx-1 text-slate-700">|</span>
          {(["keyed", "positional"] as Alignment[]).map((a) => (
            <Chip key={a} on={alignment === a} onClick={() => onAlignment(a)} label={`Alignment ${a}`}>
              {a}
            </Chip>
          ))}
        </div>
        <p className="type-caption text-slate-500">{hint}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="stated level" value={result ? result.predicate : "—"} />
          <Readout label="differences" value={result ? (result.remainderKnown ? result.differences.toLocaleString("en-US") : "not counted") : "—"} />
          <Readout label="phantom edits (line level)" value={result?.level === "lines" ? result.spurious.toLocaleString("en-US") : "n/a at this level"} tone={result?.level === "lines" && result.spurious > 0 ? "text-warn" : "text-slate-200"} />
          <Readout label="spurious under positional" value={spuriousPositional.toLocaleString("en-US")} tone={alignment === "positional" && spuriousPositional > 0 ? "text-warn" : "text-slate-200"} />
        </div>
        <div data-ledger-version={LEDGER_VERSION}>
          <p className="type-caption text-slate-500">normalization ledger v{LEDGER_VERSION} — one function, every kernel and fallback calls it:</p>
          <ul className="mt-1 space-y-0.5">
            {LEDGER.map((e) => (
              <li key={e.id} className="type-caption"><span className="font-mono text-slate-300">{e.id}</span> <span className="text-slate-500">— {e.why}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </Region>
  );
}
