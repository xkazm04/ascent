// Source excerpts for the mechanism drawer — verbatim from this scene's own files (store.ts,
// navState.ts, useSelection.ts, mutations.ts, previewCache.ts, kinds.ts and the regions). String
// constants so the drawer needs no build step; when the code moves, these move in the same commit.

export const SRC_LISTING = `// store.ts — one directory read under the contract: shallow, policy-filtered, per-entry error policy
export function listDir(store, dirId, sort): Listing {
  const dir = store.entries.get(dirId);
  if (!dir || !dir.isDir) return { ...base, status: "missing" };
  if (!dir.readable) return { ...base, status: "unreadable" };      // "could not read this" — not empty
  let skipped = 0, hidden = 0; const all = [];
  for (const e of children(store, dirId)) {
    if (isHidden(e)) hidden += 1;          // declared exclusion, applied by this one reader
    else if (!e.readable) skipped += 1;    // skip-and-count: the walk continues, the count is disclosed
    else all.push(e);
  }
  all.sort(compare(sort));                 // containers first, then the key, tiebreak on identity
  return { dirId, tick: store.tick, status: all.length === 0 && skipped === 0 ? "empty" : "ok", all, skipped, hidden };
}
// ListingRegion.tsx — the view is a cache taken at a tick; the gap is the admitted staleness window
view of {dirName} as of t{listing.tick} · store at t{vault.store.tick}   {stale ? "stale" : "current"}
// useVault.ts — refresh replaces the DATA, never the session
const fresh = listDir(at, where.location, where.sort);
setListing(fresh);
if (keep) sel.reconcile(new Set(fresh.all.map((e) => e.id)));`;

export const SRC_NAV = `// navState.ts — ONE object, persisted as a unit, restored by identity (a merge with the live store)
export function serialize(nav, store) {
  return JSON.stringify({ v: NAV_VERSION, location: nav.location, locationPath: path, expanded: [...nav.expanded], sort: nav.sort, filter: [...nav.filter] });
}
export function hydrate(blob, store) {
  for (const id of strings(raw.expanded)) {
    if (isDir(id)) { expanded.add(id); kept += 1; }   // still exists → re-expand
    else droppedExpanded += 1;                          // gone → drop silently; the store exercised its authority
  }
  if (isDir(wanted)) location = wanted;
  else { relocated = true;                              // walk UP the saved path to the nearest surviving ancestor
    for (let i = path.length - 1; i >= 0; i--) if (isDir(path[i])) { location = path[i]; break; } }
  ...
}
// useVault.ts — persist on change, never on exit
const writeNav = (next, at = store) => { setNav(next); setBlob(serialize(next, at)); };
// NavRegion.tsx — tree and trail are two renderings of one value
const trail = pathOf(vault.store, vault.nav.location);
const shown = trail.length > 4 ? [trail[0], null, ...trail.slice(-2)] : trail;   // collapse the middle`;

export const SRC_SELECTION = `// useSelection.ts — identities plus an anchor and a focus; range resolves in visual order AT the gesture
export type Selection = { mode: "ids"; ids: ReadonlySet<string> } | { mode: "predicate"; exclude: ReadonlySet<string> };
const click = (id, mods, order) => {
  setFocus(id);
  setSel((cur) => {
    if (mods.range && anchor) {
      const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);   // positional for one instant…
      return { mode: "ids", ids: new Set(span) };                     // …stored as identities
    }
    if (mods.toggle) { /* add or remove one, leave the rest */ }
    return { mode: "ids", ids: new Set([id]) };                       // plain activation replaces
  });
  if (!mods.range) setAnchor(id);
};
// after a refresh: intersect by identity — survivors stay, vanished drop out, counted
const ids = new Set([...sel.ids].filter((id) => live.has(id)));
if (ids.size !== sel.ids.size) { setDropped((d) => d + (sel.ids.size - ids.size)); setSel({ mode: "ids", ids }); }
// select-all against a windowed listing is two honest gestures
selectLoaded(loaded)  → { mode: "ids", ids: new Set(loaded) }          // "40 loaded"
selectMatching()      → { mode: "predicate", exclude: new Set() }     // resolved by the store at fire time`;

export const SRC_MUTATIONS = `// mutations.ts — THE guard door: every move-shaped intent (move-to AND trash) builds its op list here
export function planMove(store, ids, targetId) {
  for (const id of ids) {
    if (id === ROOT || id === TRASH) refused.push({ id, name, reason: "root" });
    else if (id === targetId) refused.push({ id, name, reason: "onto-itself" });
    else if (e?.isDir && isDescendant(store, targetId, id)) refused.push({ id, name, reason: "into-own-descendant" });
    else ops.push(id);
  }
}
// independent application, per-item TYPED outcome; one failure never aborts the rest
for (const id of ops) {
  const e = cur.entries.get(id);
  if (!e) { outcomes.push({ id, outcome: "gone", detail: "source no longer exists" }); continue; }
  const clash = siblingNamed(cur, targetId, e.name, id);
  if (clash && policy === "skip") outcomes.push({ id, outcome: "conflict-skipped", detail: \`a different item already holds "\${e.name}"\` });
  else if (clash && policy === "replace") { …delete clash…; outcomes.push({ id, outcome: "replaced", detail: \`destroyed \${clash.kind} "\${clash.name}"\` }); }
  else if (clash) { …keepBothName…; outcomes.push({ id, outcome: "kept-both", detail: \`now "\${name}"\` }); }
  else outcomes.push({ id, outcome: "moved" });
}
export const TRASH_CAP = 20;   // the trash names its reaper: past the cap the oldest are removed
// MutationsRegion.tsx — the count carries its predicate
{run.report.verb}: {run.report.succeeded} of {run.report.attempted} — {failed.length} failed`;

export const SRC_PREVIEWS = `// previewCache.ts — the key names the recomputation: identity + content version
export const thumbKey = (e) => \`\${e.id}@v\${e.version}\`;
get(e) {
  const hit = this.map.get(key);
  if (hit) { this.map.delete(key); this.map.set(key, hit); this.stats.hits += 1; return hit; }   // LRU touch
  const made = decode(e);                       // { state: "ok", bars } | { state: "failed", reason }
  if (made.state === "failed") this.stats.failures += 1;   // failure is cached too
  this.map.set(key, made);
  while (this.map.size > this.budget) { this.map.delete(oldest); this.stats.evictions += 1; }  // the reaper, named here
  return made;
}
export function rungFor(e, thumb) {
  if (ceiling === 1) return 1;
  if (e.kind === "image") return thumb?.state === "ok" ? ceiling : 1;   // a failed thumbnail leaves the icon, not a hole
  return ceiling;
}
// PreviewRegion.tsx — decode only for images in the mounted window; one cache for the region's life
const images = useMemo(() => vault.visible.filter((e) => e.kind === "image").slice(0, TILES), [vault.visible]);
for (const e of images) thumbs.set(e.id, cache.get(e));`;

export const SRC_KINDS = `// kinds.ts — one closed vocabulary, one classifier; every consumer derives from it
export const KIND_ORDER = ["folder", "document", "image", "data", "audio", "other"] as const;   // declared rank
export const KINDS: Record<Kind, KindSpec> = {
  folder:   { label: "Folder",   glyph: "▸", maxRung: 1, ext: [], container: true },
  document: { label: "Document", glyph: "¶", maxRung: 3, ext: ["md", "txt"] },
  image:    { label: "Image",    glyph: "▦", maxRung: 3, ext: ["png", "svg", "jpg"] },
  other:    { label: "Other",    glyph: "·", maxRung: 1, ext: [] },   // a real bucket, not a bug
};
export function classify(name, isDir) {
  if (isDir) return "folder";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";   // the cheapest reliable signal, said out loud
  for (const k of KIND_ORDER) if (KINDS[k].ext.includes(ext)) return k;
  return "other";
}
// store.ts — sort by kind reads the declared order; containers first whatever the key
if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
const c = sort === "kind" ? kindRank(a.kind) - kindRank(b.kind) : …;
// KindsRegion.tsx — counts under the current scope; a stranded filter is disclosed
const stranded = active.filter((k) => (kindCounts[k] ?? 0) === 0);`;
