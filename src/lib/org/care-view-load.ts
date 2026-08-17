// The SERVER-ONLY loader for the Care view. Split from `care-view.ts` (types + pure helpers) on the
// repo's established `*-load.ts` pattern — see `skill-usage-load.ts` / `skill-outcomes-load.ts`.
//
// Why the split is load-bearing here: every Care variant is a client component and needs the pure
// derivations (`CARE_SHAPE_LABEL`, `careShapeValue`, `careMovesByState`). If those lived in the same
// module as this `@/lib/db` import, the database layer would be dragged across the client boundary and
// `next build` would fail even with `tsc` and the unit tests green (the exact failure mode recorded in
// the "build not in the gate" note).

import { isPersonalOrg } from "@/lib/db";
import { emptyOrgView, emptyPersonalView, type CareView } from "./care-view";

/**
 * Resolve the Care view for `slug`.
 *
 * `opts.demo` selects a FIXTURE view model (prototype only, `?demo=`); the fixture module is imported
 * lazily so it stays out of the live path for a real workspace.
 *
 * The REAL path decides the mode with `isPersonalOrg` and then returns an honest EMPTY state: nothing
 * has been shared (personal) / the population is below the floor (org). C3/C4 replace the empties with
 * reads of the personal mentor tables and the floored aggregate; the mode decision below is final.
 */
export async function getCareView(slug: string, opts?: { demo?: string }): Promise<CareView> {
  const demo = opts?.demo?.trim();
  if (demo) {
    const { careFixture } = await import("./care-view.fixture");
    const view = careFixture(demo);
    if (view) return view;
  }

  const personal = await isPersonalOrg(slug).catch(() => false);
  return personal ? { mode: "personal", personal: emptyPersonalView() } : { mode: "org", org: emptyOrgView(0) };
}
