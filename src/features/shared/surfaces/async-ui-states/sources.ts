// Source excerpts for the mechanism drawer — verbatim from this scene's own files (asyncState.ts,
// asyncHooks.ts, useRepoSearch.ts, BusyButton.tsx and the panels). String constants so the drawer
// needs no build step; when the code moves, these move with it in the same commit.

export const SRC_STATE = `// asyncState.ts — the derivation; the ORDER is the model
export function deriveState(i: RegionInputs): RegionState {
  if (i.held > 0) return i.superseded ? "superseded" : i.inFlight ? "refreshing" : "settled-data";
  if (i.error) return "failed";
  if (i.inFlight) return "loading";
  if (i.settled) return "settled-empty";
  return "loading";                       // unstarted ≈ loading
}
// asyncHooks.ts — inputs come from the request machinery; a token makes latest-wins mechanical
const seq = ++latest.current;
setError(null);                           // a retry clears the error when it STARTS
setOutstanding((n) => n + 1);
const t = setTimeout(() => {
  setOutstanding((n) => n - 1);
  if (seq !== latest.current) { setDropped((d) => d + 1); return; }  // stale: never applied
  setSettled(true);                       // sticky: success or failure, the first completion settles
  if (job.fail) { setError(job.fail); return; }                        // held content survives
  setContent(job.rows); setAppliedKey(opts.key ?? "");
}, job.latencyMs);`;

export const SRC_GHOST = `// asyncState.ts — the invisibility window rides on the placeholder, in BOTH modes
export const GHOST_DELAY_MS = QUIET_PLACEHOLDER_DELAY_MS;   // 150, from Ascent's deferPolicy.ts
export function ghostAnimation(reduced) {
  return reduced ? \`async-hold 1ms linear \${GHOST_DELAY_MS}ms both\`
                 : \`async-ghost-in 200ms ease-out \${GHOST_DELAY_MS}ms both\`;
}
export function ghostWidth(row, col) { const v = ((row * 7 + col * 13) * 2654435761) >>> 0; return 40 + (v % 50); }
// sceneParts.tsx — the same ROW class (h-7) the content uses, hidden from the tree
<ul aria-hidden data-ghost="true" style={{ animation: ghostAnimation(reduced) }}>
  {Array.from({ length: count }, (_, i) => <li className={rowClass}>
    <span className="h-3 rounded bg-slate-800" style={{ width: \`\${ghostWidth(i, 0)}%\` }} /> …
// ListPanel.tsx — the ghost renders in exactly one state
{state === "loading" ? <GhostRows count={PAGE_SIZE} reduced={reduced} rowClass={ROW} />
 : state === "settled-empty" ? <p data-empty="no-match">No repositories match …</p>
 : <ul ref={listRef}>…rows…</ul>}`;

export const SRC_BUSY = `// BusyButton.tsx — the call site hands over the promise; the button owns the rest
const press = () => {
  if (inFlight.current) { onAttempt?.(false); return; }   // synchronous disarm, before any re-render
  inFlight.current = true;
  setBusy(true);
  const bound = new Promise<Outcome>((resolve) => { timer = setTimeout(() => resolve("timeout"), BUSY_TIMEOUT_MS); });
  const work = Promise.resolve().then(onPress).then(() => "ok", () => "failed");
  Promise.race([work, bound])
    .then((o) => { if (alive.current) onOutcome?.(o); })
    .finally(() => { clearTimeout(timer); inFlight.current = false; if (alive.current) setBusy(false); });
};
<button onClick={press} disabled={busy} aria-busy={busy} className="… min-w-[7.5rem]">
  {busy ? <span aria-hidden className="h-3 w-3 rounded-full border-2 border-t-accent" style={{ animation: reduced ? "none" : "async-spin 700ms linear infinite" }} /> : null}
  <span>{busy ? busyLabel : label}</span>
</button>
// QueuePanel.tsx — two clicks in one task; the second must find the door closed
const btn = root.current?.querySelector('[data-item="fu-1"] button'); btn?.click(); btn?.click();`;

export const SRC_EMPTY = `// asyncState.ts — branch on the RAW collection, not the filtered one
export function emptyCause(raw, filtered, world) {
  if (filtered > 0) return null;
  if (world.hiddenByRole) return "permission";
  if (raw > 0) return "no-match";
  if (world.prerequisiteMissing) return "prerequisite";
  return world.queueSemantics ? "drained" : "first-run";
}
// EmptyPanel.tsx — picking a world is a context change; empty renders only once settled
useEffect(() => { void issue({ rows: [], latencyMs }, { drop: true, tag: world }); }, [issue, world]);
{state === "loading" ? <GhostRows count={3} … />
 : copy ? <div data-empty={cause} data-tone={copy.tone}>
            <p>{copy.tone === "clear" ? "✓ " : null}{copy.title}</p>
            <p>{copy.body}</p>
            {copy.action ? <button>{copy.action}</button> : null}
          </div> : null}`;

export const SRC_FAILURE = `// asyncState.ts — one mapping at the user's altitude; the action follows the class
export const FAILURE_COPY = {
  unreachable:  { title: "Couldn’t load alerts — the service didn’t respond.", action: "retry" },
  unauthorized: { title: "You’re signed out of this org’s alerts.",           action: "sign-in" },
};
// FailurePanel.tsx — nothing held: a first-class failure state; retry reissues THIS request
{state === "failed" && copy ? (
  <div role="alert" data-failure={region.error}>
    <p>{escalated ? "Still can’t reach the alerts service." : copy.title}</p>
    {copy.action === "retry" ? <BusyButton label="Retry" onPress={load} … /> : <button>Sign in</button>}
  </div>) : <ul data-rows>…</ul>}
// rows held: degrade, never destroy — the failure is admitted beside them, with staleness
{held && region.error ? (
  <p role="status" data-ambient-failure>Last refresh failed · showing alerts as of {region.ageS}s ago <BusyButton label="retry" onPress={load} /></p>
) : null}`;

export const SRC_ARRIVAL = `// ListPanel.tsx — one edge plays the cascade; reduced takes the "already seen" branch
const arrival = region.appliedTag === "arrival";
const entering = rows.map((r) => arrival && !reduced && !has(r.id));
<li key={r.id} data-id={r.id} style={{ animation: entering[i] ? riseAnimation(i) : "none" }} />
// settled rows are marked on commit; an entering row marks itself when its entrance completes
useEffect(() => { const ids = rows.filter((r) => !(arrival && !reduced && !has(r.id))).map((r) => r.id); if (ids.length) mark(ids); }, …);
el.addEventListener("animationend", (e) => { const id = e.target.closest("[data-id]")?.dataset.id; if (id) mark([id]); });
// asyncHooks.ts — the set lives with the SURFACE, not the rows; reset is an explicit call
export function useSeenSet() {
  const [seen, setSeen] = useState(() => new Set());
  const has = (id) => seen.has(id);
  const mark = (ids) => setSeen((s) => ids.every((id) => s.has(id)) ? s : new Set([...s, ...ids]));
  const reset = () => setSeen(new Set());   // the identifying change only — never a poll
}
// asyncState.ts — small offsets, fast items, capped
export const CASCADE = { stepMs: 40, itemMs: 160, countCap: 8 };`;

export const SRC_KEYS = `// asyncState.ts — declared ONCE, where the key is defined
export const KEY_CLASS = { term: "identifying", page: "windowing", sort: "windowing" };
// useRepoSearch.ts — the input side: the window the held content answers, recorded at issue time
export const windowKey = (page, sort) => \`page \${page} · \${sort}\`;
issue({ rows, latencyMs }, { key: windowKey(q.page, q.sort), drop: axis === "identifying", tag });
const superseded = region.content.length > 0 && region.appliedKey !== windowKey(page, sort);
// the consumer table, applied by the handlers — one direction only
const search = (t) => { setTerm(t); setPage(1); seen.reset(); listRef.current?.scrollTo?.({ top: 0 }); run({ term: t, page: 1, sort }, "identifying", "arrival"); };
const turnPage = (p) => { setPage(p); run({ term, page: p, sort }, "windowing", "window"); };   // term untouched
// ListPanel.tsx — superseded marks the CONTENT region, not an ambient indicator
<div className={superseded ? "opacity-50" : ""} data-content={state} data-superseded={superseded}>`;
