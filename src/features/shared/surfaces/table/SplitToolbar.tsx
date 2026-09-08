"use client";

// client-server-split: the ledger's toolbar. Two clean regimes — all-client (the snapshot is held; filter,
// sort and window run here, instantly) and all-server (every axis is a request; the response echoes
// the query it answered). The all-client bet is written down as ALL_CLIENT_BOUND and REFUSED past it,
// not tuned. The search control is honest about scope: "filter" over a complete set, "search the
// fleet" over the server, and a separately labelled "find in these 25" that never claims to be
// search. The forbidden knob sorts the loaded page on the client under a server window — and the
// region says so the moment the header claims an order the request never heard.

import { Field, TextInput } from "@/components/ui";
import { ALL_CLIENT_BOUND } from "./ledger";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import type { Ledger } from "./useLedger";

export function SplitRegion({ l, volume }: { l: Ledger; volume: number }) {
  const server = l.regime === "server";
  const bet = volume > ALL_CLIENT_BOUND ? "expired" : volume === ALL_CLIENT_BOUND ? "at the bound" : "within";
  const forbidden = server && l.splitSort;
  const echo = l.view?.echo;

  return (
    <Region technique="client-server-split" title="Who owns the axes" note="An axis belongs to the tier that can see every row its answer depends on. All here, or all there — never a sort below a window that truncates.">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Regime">
            <button type="button" className={server ? BTN : BTN_ON} onClick={() => l.setRegime("client")} disabled={!l.regimeAllowed("client")} aria-pressed={!server}>
              all-client
            </button>
            <button type="button" className={server ? BTN_ON : BTN} onClick={() => l.setRegime("server")} aria-pressed={server}>
              all-server
            </button>
            <span className="type-caption text-slate-500" data-bet={bet}>
              bet: {ALL_CLIENT_BOUND.toLocaleString()} rows · fleet {volume.toLocaleString()} → {bet}
              {bet === "expired" ? " — all-client refused" : ""}
            </span>
          </div>
          <Field label={server ? "Search the fleet" : "Filter repositories"} hint={server ? "a request; the count is the server's" : "over the complete snapshot"}>
            <TextInput value={l.query.filter} onChange={(e) => l.setFilter(e.target.value)} placeholder="name contains…" />
          </Field>
          {server ? (
            <Field label="Find in these 25 loaded rows" hint="client-side narrowing of the window; the footer keeps the server's count">
              <TextInput value={l.quickFind} onChange={(e) => l.setQuickFind(e.target.value)} placeholder="find in results…" />
            </Field>
          ) : null}
        </div>
        <div className="space-y-1">
          <Readout label="filter" value={server ? "server" : "client (snapshot)"} />
          <Readout label="sort" value={forbidden ? "client, over the loaded page" : server ? "server" : "client (snapshot)"} tone={forbidden ? "text-danger" : "text-slate-200"} />
          <Readout label="window" value={server ? "server (keyset)" : "client (offset)"} />
          <Readout label="latency" value={server ? "650ms per axis change" : "0ms after the snapshot"} />
          <Readout label="echo" value={echo ? `filter=“${echo.filter}” sort=${echo.sort.col}:${echo.sort.dir} ${echo.window.kind}` : "—"} />
          {server ? (
            <label className="mt-2 flex items-center gap-1.5 type-caption text-slate-400">
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={l.splitSort} onChange={(e) => l.setSplitSort(e.target.checked)} />
              sort the loaded page on the client (the mistake)
            </label>
          ) : null}
          <p className="type-caption" data-split={forbidden ? "forbidden" : "clean"}>
            {forbidden ? (
              <span className="text-danger">Broken by construction: the header claims “{l.shownSort.col} {l.shownSort.dir}” but the window was cut under “{l.query.sort.col} {l.query.sort.dir}”. A true statement about 25 rows dressed as one about the set.</span>
            ) : (
              <span className="text-slate-500">Clean: {server ? "every axis is a request, answered with its echo." : "every axis runs over the whole snapshot the client holds."}</span>
            )}
          </p>
        </div>
      </div>
    </Region>
  );
}
