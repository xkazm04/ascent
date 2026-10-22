// THE CALLS PANEL - a spend figure opened to the calls it counted.
//
// A SERVER COMPONENT - no `"use client"`, no hooks, no handlers. The page reads the rows
// (`listLedgerCalls`, over the same window as every panel) when `?calls=` parses; this renders them.
//
// Three lists, never one: failed calls apart (a failed call that still cost money must not hide in
// the priced list), the priced calls most expensive first, then the unpriced ones, each tagged with
// its one reason from the pricing rule, and a fix line only where a configuration change would ever
// close the gap. DISPLAY ONLY: nothing here feeds a credit, a quota or a charge.

import { Surface } from "@/components/ui";
import { LANE_LABEL, type UsageLane } from "@/lib/llm/meter";
import type { UsageEventRow } from "@/lib/db/usage-events";
import type { LedgerCalls } from "@/lib/db/usage-ledger-read";
import {
  REASON_COPY,
  callsFilterLabel,
  closeCallsHref,
  groupCalls,
  groupInputs,
  isScanFilter,
  summarizeUnpriced,
  unpricedReason,
  type CallsFilter,
  type UnpricedReason,
} from "./usageCallsModel";

function usd(micros: number): string {
  const v = micros / 1_000_000;
  return v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function laneName(lane: string): string {
  return LANE_LABEL[lane as UsageLane] ?? `Unrecognized lane (${lane})`;
}

/** "2026-10-21 14:03 UTC" - every date on /usage is UTC. */
function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function tokens(r: UsageEventRow): string {
  if (r.inputTokens == null && r.outputTokens == null) return "no tokens reported";
  return `${(r.inputTokens ?? 0).toLocaleString()} in · ${(r.outputTokens ?? 0).toLocaleString()} out`;
}

function CallRow({ r, reason }: { r: UsageEventRow; reason: UnpricedReason | null }) {
  const copy = reason ? REASON_COPY[reason] : null;
  return (
    <li className="flex items-baseline justify-between gap-3 py-2" data-testid="call-row">
      <div className="min-w-0">
        <p className="truncate type-mono-sm text-slate-300">
          {r.provider}/{r.model}
        </p>
        <p className="type-micro text-slate-500">
          {when(r.createdAt)} · {laneName(r.lane)} · {r.repoFullName ?? "org-wide"}
          {r.teamKey ? ` · ${r.teamKey}` : ""} · {tokens(r)}
          {r.status !== "success" ? ` · ${r.status}` : ""}
        </p>
        {copy && (
          <p className="type-micro text-slate-400">
            <span className="text-slate-300">{copy.label}.</span> {copy.why}
            {copy.fix && <span className="block text-warn">{copy.fix}</span>}
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono tabular-nums text-slate-200">
        {r.costMicros == null ? <span className="text-slate-500">no estimate</span> : usd(r.costMicros)}
      </span>
    </li>
  );
}

function Section({ title, rows }: { title: string; rows: UsageEventRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-4" aria-label={title}>
      <h3 className="type-label tracking-widest text-slate-500">{title}</h3>
      <ul className="divide-y divide-divider/60">
        {rows.map((r) => (
          <CallRow key={r.id} r={r} reason={unpricedReason(r)} />
        ))}
      </ul>
    </section>
  );
}

const ORDER: UnpricedReason[] = ["unknown-model", "byom", "no-usage", "zero-cost"];

export function CallsPanel({
  org,
  days,
  filter,
  calls,
}: {
  org: string;
  days: number;
  filter: CallsFilter;
  /** `null` when the ledger read failed. */
  calls: LedgerCalls | null;
}) {
  const byReason = calls ? summarizeUnpriced(calls.unpricedGroups.map(groupInputs)) : null;
  const groups = calls ? groupCalls(calls.rows) : null;
  return (
    <Surface className="mt-6 p-6" id="calls">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="type-body font-semibold text-white">
          Calls <span className="font-normal text-slate-500">· {callsFilterLabel(filter)} · last {days}d (UTC)</span>
        </h2>
        <a href={closeCallsHref(org, days)} className="focus-ring type-body-sm text-slate-400 underline underline-offset-2 hover:text-white">
          Close
        </a>
      </div>
      {isScanFilter(filter) && (
        <p className="mt-2 type-body-sm text-slate-500">
          Scan-lane calls are counted from stored scans, not from this call ledger, so they are not listed here.
        </p>
      )}
      {!calls || !groups || !byReason ? (
        <p className="mt-3 type-body-sm text-slate-400">The call ledger could not be read just now. Refresh in a moment.</p>
      ) : calls.calls === 0 ? (
        <p className="mt-3 type-body-sm text-slate-400">
          No ledger calls match this figure in the window. A repository&apos;s scans are counted in the Scan ledger, not here.
        </p>
      ) : (
        <>
          <p className="mt-2 type-body-sm text-slate-400">
            {calls.calls.toLocaleString()} call{calls.calls === 1 ? "" : "s"} in this window
            {calls.calls > calls.rows.length ? `; the ${calls.rows.length} most expensive are listed` : ""}.
          </p>
          {ORDER.some((k) => byReason[k] > 0) && (
            <ul className="mt-3 space-y-1 type-body-sm" aria-label="Why calls are unpriced">
              {ORDER.filter((k) => byReason[k] > 0).map((k) => (
                <li key={k} className="text-slate-400">
                  <span className="font-mono text-slate-200">{byReason[k].toLocaleString()}</span>{" "}
                  <span className="text-slate-300">{REASON_COPY[k].label}</span>: {REASON_COPY[k].why}
                  {REASON_COPY[k].fix && <span className="block text-warn">{REASON_COPY[k].fix}</span>}
                </li>
              ))}
            </ul>
          )}
          <Section title="Failed calls" rows={groups.failed} />
          <Section title="Priced calls" rows={groups.priced} />
          <Section title="Unpriced calls" rows={groups.unpriced} />
        </>
      )}
    </Surface>
  );
}
