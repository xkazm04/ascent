"use client";

// Fleet foundation rollout — the Repositories tab's install-and-instrument surface (moonshot #35).
//
// Three columns, one row per repo: did Ascent open the `.ai/` install PR here, does this repo report
// its own conformance back, and what did it last report. The bulk bar installs across every repo that
// hasn't got the PR yet; the per-row action provisions (or removes) report-back behind a typed
// confirmation.
//
// Two of the three columns can be honestly empty and the empties mean different things: "—" under
// conformance is NEVER REPORTED (not 0%), and "not provisioned" is not "off". Those two facts used to
// be a paragraph under the table; they are now the grid's `missing` voids, which structurally cannot
// print a number (docs/ORG-UX-REDESIGN.md §2.4, foundationViz.ts) — the reader can no longer fill the
// gap with an assumption, rather than being asked not to.
//
// Role is NOT prefetched: the panel renders for anyone who can read the tab and the route answers 403
// if they can't perform the action. That is the deliberate trade — a prefetched role would be a second
// place for the authorization answer to live, and it is the one that would drift.

import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { ThemeId } from "@/lib/theme/theme";
import { FoundationRolloutV1 } from "./FoundationRollout.v1";
import { FoundationRolloutV2 } from "./FoundationRollout.v2";
import { useFoundationRollout } from "./useFoundationRollout";

export function FoundationRolloutPanel({
  slug,
  rows,
  theme = "altimeter",
}: {
  slug: string;
  rows: FoundationRolloutRow[];
  theme?: ThemeId;
}) {
  const state = useFoundationRollout(slug, rows);
  if (rows.length === 0) return null;
  return theme === "prism" ? (
    <FoundationRolloutV2 rows={rows} state={state} />
  ) : (
    <FoundationRolloutV1 rows={rows} state={state} />
  );
}
