"use client";

// cross-language-token-parity: the duration ladder consumed from two runtimes. The style-layer copy
// (`--sx-duration-*` on the scope root) is GENERATED from motionLadder.ts, so it cannot drift; the
// legacy hand-authored mirror below is the acceptable floor, a gated mirror: the gate enumerates both
// sets and fails on a missing member, an unequal value, or a phantom. "Retune" moves the authority
// the way a motion retune does; "phantom" adds a step only the mirror knows; "empty" points the
// gate at nothing, and the gate reports a broken instrument rather than parity.

import { useState } from "react";
import { DURATION_MS, parityCheck, STEPS } from "./motionLadder";
import { DENSITY } from "./tokens";
import { BTN, BTN_ON, Readout, Region, TH } from "./sceneParts";

const LEGACY_MIRROR: Record<string, number> = { ...DURATION_MS };

export function ParityRegion() {
  const [retuned, setRetuned] = useState(false);
  const [phantom, setPhantom] = useState(false);
  const [emptied, setEmptied] = useState(false);
  const authority: Record<string, number> = emptied ? {} : retuned ? { ...DURATION_MS, base: 300 } : { ...DURATION_MS };
  const mirror: Record<string, number> = phantom ? { ...LEGACY_MIRROR, tooltip: 150 } : LEGACY_MIRROR;
  const report = parityCheck(authority, mirror);
  const tone = report.status === "parity" ? "text-success-soft" : report.status === "drift" ? "text-warn" : "text-danger";
  const keys = Array.from(new Set([...STEPS, ...Object.keys(mirror)]));
  return (
    <Region technique="cross-language-token-parity" title="One vocabulary, two runtimes" note="Generated where possible; gated where hand-written; and a gate that parsed nothing says so.">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <table className="w-full type-caption">
            <thead>
              <tr>
                <th className={TH}>step</th>
                <th className={TH}>authority (ts)</th>
                <th className={TH}>legacy mirror</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const a = authority[k];
                const m = mirror[k];
                const bad = a !== m;
                return (
                  <tr key={k} className={`border-t border-divider ${bad ? "text-warn" : "text-slate-300"}`} data-parity-row={k} data-parity-bad={bad}>
                    <td className="py-0.5 font-mono">{k}</td>
                    <td className="py-0.5 tabular-nums">{a === undefined ? "absent" : `${a}ms`}</td>
                    <td className="py-0.5 tabular-nums">{m === undefined ? "absent" : `${m}ms`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={retuned ? BTN_ON : BTN} aria-pressed={retuned} onClick={() => setRetuned((r) => !r)}>
              retune base to 300ms
            </button>
            <button type="button" className={phantom ? BTN_ON : BTN} aria-pressed={phantom} onClick={() => setPhantom((p) => !p)}>
              phantom step in the mirror
            </button>
            <button type="button" className={emptied ? BTN_ON : BTN} aria-pressed={emptied} onClick={() => setEmptied((e) => !e)}>
              gate reads an empty file
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Readout label="parity gate" value={<span data-parity={report.status}>{report.status === "parity" ? `parity across ${report.members} members` : report.status === "drift" ? "drift" : "broken instrument"}</span>} tone={tone} />
          <ul className="space-y-0.5 type-caption text-slate-400">
            {report.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
            {report.findings.length === 0 ? <li className="text-slate-600">same members, same values</li> : null}
          </ul>
          <p className="mt-2 type-caption text-slate-500">
            generated mirror: the preview&apos;s row height is <span className="font-mono text-slate-300">{DENSITY.comfortable["row-h"]}px</span> in the chart (script) and{" "}
            <span className="font-mono text-slate-300">--sx-row-h</span> on the root (style), both from tokens.ts. The style copy is build output; nobody edits it.
          </p>
          <p className="type-caption text-slate-500">For a completion, the button waits for the transitionend event, not for a copied number.</p>
        </div>
      </div>
    </Region>
  );
}
