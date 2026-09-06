"use client";

// severity-taxonomy: the closed level set and the ONE mapping table every other region reads, rendered
// from severity.ts itself (the table on screen IS the authority, not a copy). The classifier below
// assigns a level by the consequence question, shows that actionability is the orthogonal bit, and
// demotes a recovery to info.

import { useState } from "react";
import { EVENTS } from "./fixtures";
import { SEVERITIES, SEVERITY_TABLE, demoteForRecovery, politenessFor, slotsFor } from "./severity";
import { BTN, BTN_ON, Region, TD, TH } from "./sceneParts";

const SAMPLES = [
  { label: "retry loop recovered after 11 attempts", ev: EVENTS.rescanRecovered("alloy-01"), note: "the system's effort is invisible; the user's stake is nil" },
  { label: "approval request from a teammate", ev: EVENTS.approvalRequest("m.kovar"), note: "not bad news — but it must not evaporate" },
  { label: "background rescan failed, will retry alone", ev: { ...EVENTS.rescanFailed("basalt-02"), verb: null }, note: "already failed; nothing for the user to do" },
  { label: "credential expired overnight", ev: EVENTS.credentialExpired(), note: "will degrade if unaddressed; the user must act" },
  { label: "scan engine unreachable", ev: EVENTS.engineDown(), note: "the product cannot do its job until a human acts" },
] as const;

export function SeverityRegion() {
  const [pick, setPick] = useState(0);
  const s = SAMPLES[pick];
  const row = SEVERITY_TABLE[s.ev.severity];
  const slots = slotsFor(s.ev.severity);
  const recovered = demoteForRecovery(s.ev.severity);
  return (
    <Region technique="severity-taxonomy" title="One vocabulary drives everything" note="Five levels, closed. Level is chosen by consequence — what if the user never sees this? — and every channel derives from the row.">
      <div className="overflow-x-auto">
        <table className="w-full type-micro">
          <thead>
            <tr className="text-slate-500">
              <th className={TH}>level</th>
              <th className={TH}>tone</th>
              <th className={TH}>dwell</th>
              <th className={TH}>dismiss</th>
              <th className={TH}>ledger</th>
              <th className={TH}>OS</th>
              <th className={TH}>announce</th>
            </tr>
          </thead>
          <tbody>
            {SEVERITIES.map((sev) => {
              const r = SEVERITY_TABLE[sev];
              const c = slotsFor(sev);
              return (
                <tr key={sev} className="text-slate-300" data-level={sev}>
                  <td className={TD}>
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 ${c.border} ${c.bg} ${c.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />
                      {sev}
                    </span>
                  </td>
                  <td className={TD}>{r.tone}</td>
                  <td className={`${TD} font-mono tabular-nums`}>{r.dwellMs ? `${r.dwellMs / 1000}s` : "none"}</td>
                  <td className={TD}>{r.dismiss}</td>
                  <td className={TD}>{r.ledger}</td>
                  <td className={TD}>{r.osEligible}</td>
                  <td className={TD}>{r.politeness}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Classify a message">
        {SAMPLES.map((x, i) => (
          <button key={x.label} type="button" className={i === pick ? BTN_ON : BTN} onClick={() => setPick(i)} aria-pressed={i === pick}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-divider p-2 type-caption" data-classified={s.ev.severity} data-obligation={s.ev.actionRequired}>
        <p className="text-slate-500">
          If never seen: <span className="text-slate-300">{row.consequence}</span> — {s.note}.
        </p>
        <p className="mt-1">
          <span className={`rounded-md border px-1.5 ${slots.border} ${slots.bg} ${slots.text}`}>{s.ev.severity}</span>
          <span className="ml-2 text-slate-400">action required: {s.ev.actionRequired ? "yes → persists, ledger obligation" : "no → transient, dwell from the row"}</span>
        </p>
        <p className="mt-1 text-slate-500">
          announce: {politenessFor(s.ev.severity, !!s.ev.blocking)} · when this recovers it is announced as <span className="text-slate-300">{recovered}</span>, never at {s.ev.severity}.
        </p>
      </div>
    </Region>
  );
}
