// The ONE producer of the org's anonymous care aggregate (C4, challenge 2026-10-22d developer-0): the
// Contributors tab's Care section and a consenting developer's own `orgBands` both read what this
// returns, so the two can never apply different floors.
//
// Suppression is enforced HERE, in the producer, never at the surface (people-analytics-ethics,
// producer-enforced-suppression): a withheld value is not in the output for a surface to forget to hide.
//   POPULATION   under CHAMPION_MIN_POP the whole aggregate is the empty view: suppressed, not thinned.
//   PER FIELD    a shape band needs CARE_BAND_MIN_SHARERS people who sent a NUMBER for that field;
//                otherwise a field some sharers sent gets the typed gap `below-sharer-floor`.
//   KEPT MOVES   a title is free text, and a title kept by one or two people names them. A title is
//                shown only when CARE_KEPT_MOVE_MIN distinct sharers kept it (naming-population-floor).
// The input is already consent-filtered and anonymous (`getOrgCareCohort`); nothing here can name
// anyone because nothing here is handed a name. Asks and outcomes stay honestly empty: the share
// contract carries no source for either.
//
// PURE module, no db import.

import { validateCareShapePayload } from "./care-shape-contract";
import type { CareSharePayload } from "./care-share-contract";
import {
  CARE_BAND_MIN_SHARERS,
  CARE_SHAPE_ORDER,
  careBandFromSharers,
  emptyOrgView,
  type CareMoveCategory,
  type CareOrgView,
} from "./developer-view";

/** Distinct sharers who must have KEPT a move title before the title is shown. Same k as the bands. */
export const CARE_KEPT_MOVE_MIN = CARE_BAND_MIN_SHARERS;

/** At most this many kept moves are listed. */
export const CARE_TOP_KEPT_MOVES = 10;

/** The anonymous cohort the producer reads. Structurally the cohort reader's result: payloads only. */
export interface CareOrgCohort {
  shares: readonly CareSharePayload[];
}

const titleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/** The most common value, ties broken by the smallest, so the pick never depends on input order. */
function mode<T extends string>(values: readonly T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]![0];
}

interface KeptGroup {
  keptBy: number;
  titles: string[];
  categories: CareMoveCategory[];
  promotable: number;
}

function keptMoves(shares: readonly CareSharePayload[]): CareOrgView["topKeptMoves"] {
  const groups = new Map<string, KeptGroup>();
  for (const share of shares) {
    // One sharer counts once per title, however many of their moves carry it.
    const seen = new Set<string>();
    for (const move of share.moves ?? []) {
      if (move.state !== "kept") continue;
      const key = titleKey(move.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const g = groups.get(key) ?? { keptBy: 0, titles: [], categories: [], promotable: 0 };
      g.keptBy += 1;
      g.titles.push(move.title.trim().replace(/\s+/g, " "));
      g.categories.push(move.category);
      if (move.registryPromotable) g.promotable += 1;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.keptBy >= CARE_KEPT_MOVE_MIN)
    .map((g) => ({ title: mode(g.titles), keptBy: g.keptBy, category: mode(g.categories), promotable: g.promotable * 2 > g.keptBy }))
    .sort((a, b) => b.keptBy - a.keptBy || a.title.localeCompare(b.title))
    .slice(0, CARE_TOP_KEPT_MOVES);
}

/** Build the floored org aggregate from the workspace population and its consenting cohort. */
export function buildCareOrgAggregate(population: number, cohort: CareOrgCohort): CareOrgView {
  const view = emptyOrgView(population);
  if (view.belowFloor) return view;

  const values = new Map<string, number[]>();
  let sharing = 0;
  for (const share of cohort.shares) {
    if (!share.shape) continue;
    const shape = validateCareShapePayload(share.shape);
    if (!shape.ok) continue;
    let sent = false;
    for (const field of shape.sharedFields) {
      const v = shape.shape[field];
      if (v == null) continue;
      sent = true;
      values.set(field, [...(values.get(field) ?? []), v]);
    }
    if (sent) sharing += 1;
  }
  for (const field of CARE_SHAPE_ORDER) {
    const result = careBandFromSharers(values.get(field) ?? []);
    // A field nobody shared stays out of both maps, exactly as in the empty view: there is nothing to
    // withhold. A field SOME shared but too few is a suppression, and is named as one.
    if (result.band) view.shapeBands[field] = result.band;
    else if (result.reason === "below-sharer-floor") view.bandGaps[field] = result.reason;
  }
  view.adoption = { setUp: cohort.shares.length, sharing };
  view.topKeptMoves = keptMoves(cohort.shares);
  return view;
}
