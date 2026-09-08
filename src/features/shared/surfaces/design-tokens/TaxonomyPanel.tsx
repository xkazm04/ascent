"use client";

// token-taxonomy: the two layers side by side (raw ramp, then roles with their one-sentence
// definitions and their binding per theme), and the admission desk: a candidate name is judged by
// the grammar (no value in the name, no call site in the name) and by the three tests a token must
// pass to earn existence. The default answer is "use the nearest role"; a name is minted only when
// all three hold.

import { useState } from "react";
import { COLOR_ROLES, PRIMITIVES, ROLE_DEFINITION, THEMES } from "./tokens";
import { BTN, BTN_ON, Readout, Region, TH } from "./sceneParts";

const VALUE_IN_NAME = /(gr[ae]y|blue|red|green|azure|slate|amber|\d{2,})/i;
const ADDRESS_IN_NAME = /(page|screen|settings|header|footer|modal|sidebar|table|form)/i;
const GRAMMAR = /^[a-z]+(-[a-z]+){0,3}$/;

export function judgeName(name: string): { ok: boolean; reason: string } {
  const n = name.trim();
  if (!n) return { ok: false, reason: "type a candidate" };
  if (VALUE_IN_NAME.test(n)) return { ok: false, reason: "refused: the value is in the name; names carry intent, bindings carry values" };
  if (ADDRESS_IN_NAME.test(n)) return { ok: false, reason: "refused: a street address, not a role; roles describe a class of use" };
  if (!GRAMMAR.test(n)) return { ok: false, reason: "refused: the grammar is <axis>-<role>[-<variant>][-<state>]" };
  return { ok: true, reason: "grammar holds; now the three tests" };
}

const TESTS = [
  { id: "recurring", label: "recurring intent: several sites share the same decision, not the same value" },
  { id: "variance", label: "theme- or policy-variance: the answer could plausibly differ by theme or redesign" },
  { id: "definable", label: "owner-answerable: one sentence says when to use it over its neighbours" },
] as const;
type TestId = (typeof TESTS)[number]["id"];

const RAMP = Object.entries(PRIMITIVES.slate) as [string, string][];

export function TaxonomyRegion() {
  const [name, setName] = useState("border-subtle");
  const [passed, setPassed] = useState<Record<TestId, boolean>>({ recurring: true, variance: true, definable: false });
  const judged = judgeName(name);
  const passes = TESTS.filter((t) => passed[t.id]).length;
  const earns = judged.ok && passes === TESTS.length;
  return (
    <Region technique="token-taxonomy" title="A name earns its place" note="Primitives feed roles; roles feed components; nothing skips a layer. Admission is guarded.">
      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="type-caption text-slate-500">layer 1: the raw ramp (authors of roles only)</p>
          <div className="mt-1 flex gap-1" aria-label="slate ramp">
            {RAMP.map(([step, hex]) => (
              <span key={step} className="h-5 w-6 rounded-sm border border-divider" style={{ background: hex }} title={`slate-${step}`} />
            ))}
          </div>
          <p className="mt-3 type-caption text-slate-500">layer 2: roles, one sentence each, bound per theme</p>
          <table className="mt-1 w-full type-caption">
            <thead>
              <tr>
                <th className={TH}>role</th>
                <th className={TH}>when</th>
                <th className={TH}>dark</th>
                <th className={TH}>light</th>
              </tr>
            </thead>
            <tbody>
              {COLOR_ROLES.map((role) => (
                <tr key={role} className="border-t border-divider text-slate-300">
                  <td className="py-0.5 font-mono">{role}</td>
                  <td className="py-0.5 text-slate-500">{ROLE_DEFINITION[role]}</td>
                  <td className="py-0.5">
                    <span className="inline-block h-3 w-5 rounded-sm border border-divider align-middle" style={{ background: THEMES.dark[role] }} />
                  </td>
                  <td className="py-0.5">
                    <span className="inline-block h-3 w-5 rounded-sm border border-divider align-middle" style={{ background: THEMES.light[role] }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <label className="block">
            <span className="type-caption text-slate-400">candidate token</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="focus-ring mt-1 w-full rounded-md border border-divider bg-surface/40 px-2 py-1 font-mono type-caption text-slate-200" aria-label="Candidate token name" />
          </label>
          <p className="type-caption text-slate-500" data-name-ok={judged.ok}>
            {judged.reason}
          </p>
          <div className="flex flex-wrap gap-1">
            {["gray-700-text", "settings-page-header-border", "border-subtle"].map((s) => (
              <button key={s} type="button" className={BTN} onClick={() => setName(s)}>
                try {s}
              </button>
            ))}
          </div>
          <ul className="space-y-1">
            {TESTS.map((t) => (
              <li key={t.id}>
                <button type="button" className={`${passed[t.id] ? BTN_ON : BTN} w-full text-left`} aria-pressed={passed[t.id]} onClick={() => setPassed((p) => ({ ...p, [t.id]: !p[t.id] }))}>
                  {passed[t.id] ? "pass" : "fail"}: {t.label}
                </button>
              </li>
            ))}
          </ul>
          <Readout label="verdict" value={<span data-admission={earns ? "minted" : "nearest-role"}>{earns ? "earns a name" : "use the nearest role"}</span>} tone={earns ? "text-success-soft" : "text-warn"} />
        </div>
      </div>
    </Region>
  );
}
