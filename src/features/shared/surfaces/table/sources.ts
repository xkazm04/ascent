// Source excerpts for the mechanism drawer — verbatim from the scene's own files (ledger.ts,
// useLedger.ts, LedgerRow.tsx, LedgerTable.tsx, LedgerFooter.tsx, SplitToolbar.tsx). Kept as string
// constants so the drawer needs no build step; when the code moves, these move with it in the same commit.

export const SRC_PAGINATION = `// ledger.ts — the cursor is the ordering tuple of the last delivered row, sealed with its order
export function encodeCursor(last: Repo, sort: Sort): string {
  return btoa(JSON.stringify([sort.col, sort.dir, sortValue(last, sort.col), last.id]));
}
export function decodeCursor(cursor: string, sort: Sort) {
  const [col, dir, value, id] = JSON.parse(atob(cursor));
  if (col !== sort.col || dir !== sort.dir) return null; // minted under another order: refused, not replayed
  return { value, id };
}
// runQuery — the next-window predicate compares the WHOLE tuple; the total is a bound when the scan is not paid
if (c) start = filtered.findIndex((r) => cmpValues(sortValue(r, q.sort.col), c.value, q.sort.dir) > 0 || (… === 0 && r.id > c.id));
total: exactTotal ? { kind: "exact", n: filtered.length } : { kind: "bound", hasMore },
nextCursor: hasMore && last ? encodeCursor(last, q.sort) : null,
// LedgerFooter.tsx — the count carries its predicate
const predicate = l.query.filter ? \`matching “\${l.query.filter}”\` : "in the fleet, no filter";
v.total.kind === "exact" ? \`\${start}–\${end} of \${v.total.n} \${predicate}\` : \`\${start}–\${end} of \${end}\${v.total.hasMore ? "+" : ""} \${predicate}\`
// useLedger.ts — the walk ledger: which step first delivered each identity; delivered again later = a repeat
const at = first.get(r.id);
if (at === undefined) first.set(r.id, step);
else if (at !== step) repeats += 1;`;

export const SRC_SORTING = `// ledger.ts — columns are data; the comparator is typed, absent-last, and ends on identity
export const COLUMNS = [
  { id: "name",    kind: "text",    align: "left",  firstDir: "asc"  },
  { id: "score",   kind: "number",  align: "right", firstDir: "desc" },
  { id: "status",  kind: "rank",    align: "left",  firstDir: "desc" },   // STATUS_RANK, never the alphabet
  { id: "scanned", kind: "instant", align: "right", firstDir: "desc" }, …
];
export const DEFAULT_SORT: Sort = { col: "score", dir: "desc" };      // there is always a sort
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
function cmpValues(va, vb, dir) {
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;   // ONE home: last, either way
  const c = typeof va === "string" && typeof vb === "string" ? collator.compare(va, vb) : va - vb;
  return dir === "asc" ? c : -c;
}
export function compare(a: Repo, b: Repo, sort: Sort): number {
  const c = cmpValues(sortValue(a, sort.col), sortValue(b, sort.col), sort.dir);
  if (c !== 0) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // the tiebreaker is identity, never a timestamp or a label
}
// useLedger.ts — first click: the type's direction; second: reverse; third: the NAMED default
const sort = cur.col !== col ? { col, dir: firstDir } : cur.dir === firstDir ? { col, dir: firstDir === "asc" ? "desc" : "asc" } : DEFAULT_SORT;
// LedgerTable.tsx — announced, and a real button
<th scope="col" aria-sort={active ? (l.shownSort.dir === "asc" ? "ascending" : "descending") : undefined}>
  <button type="button" className="focus-ring …" onClick={() => l.cycleSort(c.id, c.firstDir)}>`;

export const SRC_PERFORMANCE = `// LedgerRow.tsx — rung 2: the view model is formatted once per delivery; rung 3: memo on identity + own booleans
export function toVM(r: Repo): RowVM { return { id: r.id, level: r.level === null ? "—" : \`L\${r.level}\`, scoreHex: …, commits: r.commits.toLocaleString(), … }; }
export const LedgerRow = memo(function LedgerRow({ vm, index, selected, entering, reduced, onRender, onToggle }) {
  useEffect(onRender); // every commit of this row is one tick; memo is what keeps the ticks at one per toggle
  return <tr data-id={vm.id} aria-selected={selected} …>;
});
// useLedger.ts — the tick lands in a DOM node, never in state
const onRowRender = useCallback(() => {
  log.current.n += 1;
  if (log.current.el) log.current.el.textContent = String(log.current.n);
}, []);
// LedgerTable.tsx — rows keyed by identity, each handed ITS booleans, not the sets
const vms = useMemo(() => l.rows.map(toVM), [l.rows]);
<LedgerRow key={vm.id} vm={vm} selected={l.selected.has(vm.id)} entering={!l.seen.has(vm.id)} onRender={l.onRowRender} onToggle={l.toggle} … />
// useLedger.ts — the sequence is a derivation of NAMED inputs; \`rows\` keeps its identity across a toggle
const view = useMemo(() => (regime === "client" ? (snapshot ? runQuery(snapshot, query, true) : null) : served), [regime, snapshot, query, served]);
const toggle = useCallback((id) => { log.current.n = 0; setSelected((s) => …); }, []);
// ledger.ts — the rung is a runtime decision from the count the surface was handed
export function rungFor(volume: number): { rung: 2 | 3; why: string } {
  if (volume <= PAGE_SIZE) return { rung: 2, why: "one page holds the whole set: …" };
  return { rung: 3, why: \`the window caps the mount at \${PAGE_SIZE} rows; … Rung 4 is refused: …\` };
}`;

export const SRC_LOADING = `// ledger.ts — the body state is a function of four inputs; presence of rows dominates; empty needs settled
export function bodyState(inFlight, rowCount, settled, error): BodyState {
  if (error && rowCount === 0) return "error";
  if (inFlight && rowCount === 0) return "empty-loading";
  if (rowCount > 0) return inFlight ? "populated-refreshing" : "populated";
  return settled ? "empty-settled" : "empty-loading";
}
// sceneParts.tsx — the ghost is invisible for its first 150ms in BOTH modes; widths seeded by position
export const ghostAnimation = (reduced) => reduced ? \`ledger-hold 1ms linear 150ms both\` : \`ledger-ghost-in 200ms ease-out 150ms both\`;
<tr aria-hidden data-ghost="true" style={{ animation: ghostAnimation(reduced) }}>
  <span className="inline-block h-3 rounded bg-slate-800" style={{ width: \`\${ghostWidth(i, j)}%\` }} />
// LedgerTable.tsx — chrome always; the body branches; refreshing dims rows and never covers them
<OrgTable head={<tr>{COLUMNS.map(…)}</tr>}>
  {l.state === "empty-loading" ? <GhostRows count={8} reduced={reduced} /> : null}
  {l.state === "empty-settled" ? <p>No repositories {predicate}.</p> … <button onClick={() => l.setFilter("")}>clear the filter</button> : null}
  {l.state === "error" ? <td role="alert"><p className="text-danger">Could not read the fleet.</p> … <button onClick={l.refresh}>retry</button></td> : null}
  {vms.map((vm, i) => <LedgerRow key={vm.id} … />)}
// useLedger.ts — a filter change clears (those rows answered another predicate); a page or sort change keeps them dimmed
const setFilter = (filter) => apply({ filter, sort: query.sort, window: firstWindow(regime) }, /* clear */ true, 1, true);
apply({ ...query, sort, window: firstWindow(regime) }, /* clear */ false, 1, true); // cycleSort: the rows stay, dimmed
// LedgerTable.tsx — the entrance guard: decided during render against the TABLE-scoped seen-set, marked by the entrance's own animationend
<LedgerRow entering={!l.seen.has(vm.id)} … />
el.addEventListener("animationend", (e) => { const id = e.target.closest("[data-id]")?.dataset.id; if (id) markSeen(id); });
// LedgerRow.tsx — reduced is a 1ms epsilon, never "none", so the marking event still fires
style={{ animation: entering ? riseAnimation(index, reduced) : "none" }}`;

export const SRC_SPLIT = `// ledger.ts — the all-client bet, written down and refused past it
export const ALL_CLIENT_BOUND = 5_000;
export const regimeAllowed = (regime, volume) => regime === "server" || volume <= ALL_CLIENT_BOUND;
// one executor for both tiers; the response ECHOES the query it answered
export function runQuery(data, q, exactTotal): Response {
  … return { rows, total, nextCursor, echo: q };
}
// useLedger.ts — all-client: every axis runs here over the held snapshot; all-server: every axis is a request
const view = useMemo(() => (regime === "client" ? (snapshot ? runQuery(snapshot, query, true) : null) : served), …);
const apply = (next, clear, step, reset) => { setQuery(next); if (regime === "server") dispatch(next, "window", clear, failNext, step, reset); … };
// latest-wins: a superseded response is dropped, never applied
const id = ++reqId.current;
land(id, target, runQuery(data, q, data.length <= ALL_CLIENT_BOUND), data, fail, step, reset); // the server answers with what it holds NOW
setTimeout(() => { if (id !== reqId.current) return; … setServed(answer); }, LATENCY_MS);
// the forbidden knob: the header reorders the window, the request never hears about it
if (splitSort && regime === "server") { setLocalSort(sort); return; }
const rows = useMemo(() => (splitSort && regime === "server" ? sortRepos(windowRows, localSort) : windowRows).filter((r) => matches(r, quickFind)), …);
// SplitToolbar.tsx — honest labels for scope
<Field label={server ? "Search the fleet" : "Filter repositories"} …>
<Field label="Find in these 25 loaded rows" hint="client-side narrowing of the window; the footer keeps the server's count">
<p data-split={forbidden ? "forbidden" : "clean"}>{forbidden ? "Broken by construction: the header claims … but the window was cut under …" : "Clean: …"}</p>`;
