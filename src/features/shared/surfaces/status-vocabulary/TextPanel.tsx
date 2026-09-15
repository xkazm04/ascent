"use client";

// untrusted-label-rendering: rename the first repository in the ledger to anything — markup, a
// 100-character name with no spaces, a right-to-left run, a string that spells a status token. The
// `Label` primitive renders a text node (no markup door exists), truncates with the full value
// recoverable, isolates bidi, and the name never reaches a pill: colour keys on the status column.
// vocabulary-evolution-checklist: adding a member is a four-layer transaction; toggle the steps and
// the preview pill shows what a user sees when a competent person did three of the four. Rename is
// a label change; retirement runs top-down.

import { useState } from "react";
import { Field, TextInput } from "@/components/ui";
import { HOSTILE_SAMPLES } from "./fixtures";
import { Label, LABEL_MAX } from "./primitives";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { ROLE_SLOTS } from "./vocabulary";

export function LabelRegion({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  return (
    <Region technique="untrusted-label-rendering" title="Text, never markup — and never vocabulary" note="Rename the first ledger row. The author is outside the repo, so the primitive decides escaping, geometry and identity once.">
      <Field label="Repository name · outside-authored">
        <TextInput type="text" value={name} onChange={(e) => onRename(e.target.value)} className="type-mono-sm" />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {HOSTILE_SAMPLES.map((s) => (
          <button key={s.key} type="button" className={BTN} onClick={() => onRename(s.value)}>
            {s.key}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="rendered" value={<Label text={name} />} />
        <Readout label="length" value={`${name.length} chars · ${name.length > LABEL_MAX ? "truncated, full value in title" : "fits"}`} />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        A name that reads &quot;critical&quot; is still a name: the pill beside it keys on <code>row.status</code>, never on content. Content flows into a dead end; tokens are minted by the repo.
      </p>
    </Region>
  );
}

const ADD_STEPS = [
  "establish the vocabulary does not already exist",
  "extend the authority (the closed type)",
  "mirror the storage constraint",
  "regenerate + commit the wire artifact",
  "add the label to the catalog, every locale",
  "extend the one presentation table",
  "re-affirm the unknown direction",
] as const;
type Mode = "add" | "rename" | "retire";
const RETIRE_STEPS = ["stop producing; migrate stored rows", "verify zero at rest and in flight", "narrow the table and the catalog", "narrow the wire type, regenerate, narrow the constraint"];

/** What the ledger would show for the new member `retrying` given which steps were discharged. */
export function previewFor(done: readonly boolean[]): { text: string; className: string; verdict: string } {
  const n = ROLE_SLOTS.neutral;
  if (!done[1] || !done[3]) return { text: "retrying", className: `${n.border} ${n.bg} ${n.text}`, verdict: "the consumer never learned the member: a bare string crossed the wire, so the unknown path renders it" };
  if (!done[2]) return { text: "—", className: `border-danger/40 bg-danger/10 text-danger-soft`, verdict: "the type allows what storage rejects: the write fails before any row exists" };
  if (!done[4]) return { text: "retrying", className: `border-accent/40 bg-accent/10 text-accent`, verdict: "no catalog entry: the raw token ships, in every language at once" };
  if (!done[5]) return { text: "Retrying", className: "", verdict: "no presentation entry: a colourless pill with no classes (Record<Union,…> would have refused to compile)" };
  return { text: "◔ Retrying", className: "border-accent/40 bg-accent/10 text-accent", verdict: done[6] ? "all four layers in one change; the fallback direction re-affirmed" : "renders — but the fallback direction was not re-checked" };
}

export function EvolutionRegion() {
  const [mode, setMode] = useState<Mode>("add");
  const [done, setDone] = useState<boolean[]>(() => ADD_STEPS.map(() => false));
  const toggle = (i: number) => setDone((d) => d.map((v, j) => (j === i ? !v : v)));
  const preview = previewFor(done);
  return (
    <Region technique="vocabulary-evolution-checklist" title="Four layers, one change" note="Discharge the steps for a new member `retrying` and watch what a user would see meanwhile.">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Evolution mode">
        {(["add", "rename", "retire"] as const).map((m) => (
          <button key={m} type="button" className={m === mode ? BTN_ON : BTN} onClick={() => setMode(m)} aria-pressed={m === mode}>
            {m}
          </button>
        ))}
      </div>
      {mode === "add" ? (
        <>
          <ul className="mt-3 space-y-1">
            {ADD_STEPS.map((s, i) => (
              <li key={s}>
                <label className="flex items-center gap-2 type-caption text-slate-300">
                  <input type="checkbox" checked={done[i]} onChange={() => toggle(i)} className="accent-[var(--color-accent)]" />
                  <span className="text-slate-600">{i + 1}.</span> {s}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1">
            <Readout label="a user sees" value={<span className={`inline-flex rounded-full border px-2 py-0.5 type-caption ${preview.className}`} data-preview={preview.text}>{preview.text}</span>} />
            <p className="type-caption text-slate-500" data-verdict>{preview.verdict}</p>
          </div>
        </>
      ) : mode === "rename" ? (
        <div className="mt-3 space-y-1 type-caption text-slate-400">
          <p className="text-slate-200">There is no in-place rename.</p>
          <p>A stored token is identity — it survives in rows, exports and other systems&apos; automations. What a rename usually wants is a <span className="text-slate-200">label</span> change: edit the catalog entry (<code>&quot;status.warned&quot;</code>) and the token never moves.</p>
          <p>If the token itself must change: add the new member → migrate stored data → retire the old one, retirement gated on measured zero occurrences.</p>
        </div>
      ) : (
        <ol className="mt-3 space-y-1 type-caption text-slate-300">
          {RETIRE_STEPS.map((s, i) => (
            <li key={s}>
              <span className="text-slate-600">{i + 1}.</span> {s}
            </li>
          ))}
          <li className="pt-1 text-slate-500">Top-down: deleting the label or the table entry first ships the unknown path to exactly the rows that still exist.</li>
        </ol>
      )}
    </Region>
  );
}
