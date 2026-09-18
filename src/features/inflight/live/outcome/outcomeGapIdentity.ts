// THE DURABLE IDENTITY OF A GAP — what makes one gap ONE row across rescans.
//
// A `Recommendation` row is RECREATED on every scan: scan-persist carries its status forward by
// (dimension, normalized title) and writes it under a NEW id (`src/lib/db/scans-persist.ts` — "a
// carried row is a NEW id, never the old one"). So a gap worked in run 3, rescanned, and worked again
// in run 7 reaches the sheet under two different ids, and a row keyed on the id split it in two. The
// rescan between two CYCLES of one run does the same thing inside a single column.
//
// The identity here is the one scan-persist itself carries status by — dimension + `normalizeRecTitle`
// — read from the PURE module (`@/lib/report/recommendation-identity`, no db import), so the browser and
// the persist path agree on what "the same gap" means. It is resolved from data the payload already
// carries: the lanes' own before/after scans, the diff's closed rows, then the run's server-side
// `batchTitles`. An id none of them can title has no identity, and the row falls back to its id.

import { normalizeRecTitle } from "@/lib/report/recommendation-identity";
import type { LoopLaneOutcome } from "../cockpit/loopTypes";

/** A recommendation's title and dimension, by id — what a row's identity is derived from. */
export type RecTitleIndex = ReadonlyMap<string, { title: string; dimId: string | null }>;

/**
 * Every recommendation id the lanes can title, with its dimension. Scans first (they are the rows the
 * batch was armed from), then the diff's closed rows, then `batchTitles` — the resolution against the
 * `Recommendation` table itself, the one source that survives a lane that never rescanned.
 */
export function recTitleIndex(
  lanes: readonly LoopLaneOutcome[],
  batchTitles?: Readonly<Record<string, { title: string; dimId: string | null }>>,
): RecTitleIndex {
  const out = new Map<string, { title: string; dimId: string | null }>();
  const put = (id: string, title: string, dimId: string | null) => {
    if (!out.has(id) && title.trim()) out.set(id, { title, dimId });
  };
  for (const o of lanes) {
    for (const r of [...(o.after?.recommendations ?? []), ...(o.before?.recommendations ?? [])]) put(r.id, r.title, r.dimId);
    for (const r of o.diff?.recsMovedToDone ?? []) put(r.id, r.title, r.dimId);
  }
  for (const [id, t] of Object.entries(batchTitles ?? {})) put(id, t.title, t.dimId);
  return out;
}

/**
 * The durable key for the recommendation `id` names, or `undefined` when nothing titles it (the caller
 * then keys on the id, which is still right within one scan). Prefixed `rec|` so it can never collide
 * with the id-keyed or headline-keyed fallbacks in `gapKey`.
 */
export function recIdentityOf(id: string | undefined, index: RecTitleIndex): string | undefined {
  if (!id) return undefined;
  const rec = index.get(id);
  if (!rec) return undefined;
  const title = normalizeRecTitle(rec.title);
  return title ? `rec|${rec.dimId ?? ""}|${title}` : undefined;
}
