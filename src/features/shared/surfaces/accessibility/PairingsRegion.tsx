"use client";

// assistive-tech-divergence: "supported" is a written list of reader x browser pairs, each result
// DATED; unlisted cells are untested, never green. The announcer's keyed remount is a pairing
// workaround — load-bearing code that looks redundant — so it carries what it serves, what was seen
// without it, and when that was last checked; proposing its deletion returns the failure ranking
// (silence > stale > verbosity) and the re-measure condition instead of a merge.

import { useState } from "react";
import { PAIRINGS, UNHELD } from "./fixtures";
import { BTN, Region } from "./sceneParts";

const TODAY = "2026-09-06"; // the scene's fixed clock: fixtures never read Date.now
const STALE_DAYS = 45;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function PairingsRegion() {
  const [proposed, setProposed] = useState(false);
  return (
    <Region technique="assistive-tech-divergence" title="The delivery layer is a grid" note="Held pairings, dated. Everything outside the list is untested. A workaround names its pairing or it gets deleted by the next cleanup.">
      <table className="w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">pairing</th>
            <th className="font-normal">pre-populated region</th>
            <th className="font-normal">identical repeat</th>
            <th className="font-normal">measured</th>
          </tr>
        </thead>
        <tbody>
          {PAIRINGS.map((p) => {
            const age = daysBetween(p.measured, TODAY);
            return (
              <tr key={p.reader} className="border-t border-divider text-slate-300" data-pairing={`${p.reader}/${p.browser}`}>
                <td className="py-1">
                  {p.reader} <span className="text-slate-500">· {p.browser}</span>
                </td>
                <td className={`py-1 ${p.prePopulated === "silent" ? "text-warn" : ""}`}>{p.prePopulated}</td>
                <td className={`py-1 ${p.repeat === "silent" ? "text-warn" : ""}`}>{p.repeat}</td>
                <td className={`py-1 tabular-nums ${age > STALE_DAYS ? "text-danger" : "text-slate-500"}`}>
                  {p.measured}
                  {age > STALE_DAYS ? " · stale" : ""}
                </td>
              </tr>
            );
          })}
          {UNHELD.map((p) => (
            <tr key={p.reader} className="border-t border-divider text-slate-500" data-pairing-untested={`${p.reader}/${p.browser}`}>
              <td className="py-1">
                {p.reader} · {p.browser}
              </td>
              <td className="py-1" colSpan={3}>
                untested — not held, not passing
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 rounded-lg border border-divider p-2">
        <p className="type-caption text-slate-200">workaround: remount the live node per utterance, even for identical text</p>
        <p className="type-caption text-slate-500">serves: VoiceOver · Safari and NVDA · Firefox — observed without it: an identical repeat was silent — last checked 2026-08-30</p>
        <button type="button" className={`${BTN} mt-2`} onClick={() => setProposed(true)} aria-expanded={proposed}>
          propose deleting it
        </button>
        {proposed ? (
          <div className="mt-2 space-y-1 type-caption" data-deletion="refused">
            <p className="text-warn">Refused until re-measured on the pairings it serves. Nothing fails when it goes; the defect just stops being visible.</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-slate-400">
              <li>silence — the user never receives the message (worst)</li>
              <li>a wrong or stale announcement — trust in the channel decays</li>
              <li>verbosity, an interruption, a message spoken twice — the price worth paying</li>
            </ol>
          </div>
        ) : null}
      </div>
    </Region>
  );
}
