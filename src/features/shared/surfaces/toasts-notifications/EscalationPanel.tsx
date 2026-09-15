"use client";

// os-escalation: a simulated desktop. The send-time decision is printed per event: the user's cell for
// the kind, the level's eligibility, the permission the app MODELS (asked in context, denial stated),
// and focus-awareness against the surface the message is about. The outbox is the platform's list:
// a note is withdrawn when the news is read in-app, updated in place on a repeat, and marked failed
// (never silently dropped) when the platform refuses — the toast and the ledger row still stand.

import type { Action } from "./desk";
import type { Desk } from "./useDesk";
import { KINDS, blockedKinds } from "./escalation";
import { EVENTS, KIND_META, type Surface } from "./fixtures";
import { BTN, BTN_ON, Readout, Region, TD, TH } from "./sceneParts";

const SURFACES: (Surface | "none")[] = ["scans", "billing", "access", "none"];

export function EscalationRegion({ desk }: { desk: Desk }) {
  const { state, dispatch } = desk;
  const os = state.os;
  const blocked = blockedKinds(os);
  const set = (patch: Extract<Action, { type: "os:set" }>["patch"]) => dispatch({ type: "os:set", patch });
  return (
    <Region technique="os-escalation" title="Escalation, not a mirror" note="Only news that justifies pulling the user back leaves the app. Never about what they are looking at; never without consent asked in context.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-divider p-2">
          <p className="type-caption text-slate-300">the window</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={os.foregrounded ? BTN_ON : BTN} onClick={() => set({ foregrounded: !os.foregrounded })} aria-pressed={os.foregrounded}>
              {os.foregrounded ? "foregrounded" : "backgrounded"}
            </button>
            <button type="button" className={os.platformUp ? BTN_ON : BTN} onClick={() => set({ platformUp: !os.platformUp })} aria-pressed={os.platformUp}>
              {os.platformUp ? "platform up" : "platform refusing"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Visible surface">
            {SURFACES.map((s) => (
              <button key={s} type="button" className={os.visibleSurface === s ? BTN_ON : BTN} onClick={() => set({ visibleSurface: s })} aria-pressed={os.visibleSurface === s}>
                {s === "none" ? "elsewhere" : s}
              </button>
            ))}
          </div>
          <Readout label="permission" value={<span data-permission={os.permission}>{os.permission}</span>} tone={os.permission === "denied" ? "text-danger-soft" : "text-slate-200"} />
          {os.permission === "unasked" ? (
            <div className="rounded-md border border-dashed border-divider p-2">
              <p className="type-micro text-slate-400">Asked in context — the moment a channel is wanted, never at launch:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <button type="button" className={BTN} onClick={() => dispatch({ type: "os:request", grant: true })}>
                  notify me when a scan finishes → allow
                </button>
                <button type="button" className={BTN} onClick={() => dispatch({ type: "os:request", grant: false })}>
                  → deny
                </button>
              </div>
            </div>
          ) : null}
          {blocked.length ? (
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 type-micro text-warn" data-blocked={blocked.length}>
              OS delivery is blocked for {blocked.length} kinds you asked for. Restore it in system settings; until then they land in-app and on the record.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={BTN} onClick={() => dispatch({ type: "emit", ev: EVENTS.scanFinished(state.fleet[3]?.name ?? "delta-04") })}>
              raise: scan finished
            </button>
            <button type="button" className={BTN} onClick={() => dispatch({ type: "emit", ev: EVENTS.approvalRequest("j.novak") })}>
              raise: approval
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-divider p-2">
          <p className="type-caption text-slate-300">event × channel</p>
          <table className="mt-1 w-full type-micro">
            <thead>
              <tr className="text-slate-500">
                <th className={TH}>kind</th>
                <th className={TH}>in-app</th>
                <th className={TH}>OS</th>
              </tr>
            </thead>
            <tbody>
              {KINDS.slice(0, 7).map((k) => (
                <tr key={k} className="text-slate-300" data-pref={k}>
                  <td className={TD} title={KIND_META[k].why}>{KIND_META[k].label}</td>
                  {(["inApp", "os"] as const).map((ch) => (
                    <td key={ch} className={TD}>
                      <input type="checkbox" className="accent-[var(--color-accent)]" checked={os.prefs[k][ch]} onChange={(e) => dispatch({ type: "os:pref", kind: k, channel: ch, on: e.target.checked })} aria-label={`${KIND_META[k].label} via ${ch === "os" ? "OS" : "in-app"}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="mt-3 space-y-1" aria-label="Platform notification list" data-outbox>
        {os.outbox.length === 0 ? <li className="type-caption text-slate-600">platform list: empty</li> : null}
        {os.outbox.slice(0, 5).map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-2 rounded-md border border-divider px-2 py-1" data-note={n.id} data-note-status={n.status}>
            <span className={`truncate type-caption ${n.status === "sent" ? "text-slate-200" : n.status === "failed" ? "text-danger-soft" : "text-slate-600 line-through"}`}>
              {n.title}
              {n.count > 1 ? ` ×${n.count}` : ""}
            </span>
            <span className="flex shrink-0 items-center gap-2 type-micro text-slate-500">
              {n.status}
              {n.status === "sent" ? (
                <button type="button" className={BTN} onClick={() => dispatch({ type: "os:open", id: n.id })} aria-label={`Open from the platform: ${n.title}`}>
                  click-through → {n.surface}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <Readout label="sends refused by the platform" value={<span data-os-failures={os.failures}>{os.failures}</span>} tone={os.failures ? "text-danger-soft" : "text-slate-200"} />
      </div>
    </Region>
  );
}
