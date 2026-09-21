// THE DRIVE'S MEASUREMENT — the fleet scored for a set of repos from their LATEST persisted scans.
//
// Relocated out of `drive.ts` (spark theater-upgrade, 2026-09-18) so the standing runner's wiring
// (`runner-control.ts`) can take the same reading without importing the bounded driver; `drive.ts`
// re-exports it, so every existing caller is unchanged.

import { getOrgRollup } from "@/lib/db";
import { fleetGreenness, repoGreenness } from "@/lib/maturity/green";
import type { DriveMeasurement } from "@/lib/local/drive-types";

/** Score the fleet for a set of repos from their LATEST persisted scans — the same read the
 *  projects door and the fleet colours use, restricted to the drive's scope. */
export async function measureDrive(orgSlug: string, repos: readonly string[]): Promise<DriveMeasurement> {
  const rollup = await getOrgRollup(orgSlug);
  const dimsByRepo = new Map<string, { dimId: string; score: number; signalScore?: number; llmScore?: number }[]>();
  // Dimensions the repo's LATEST reading could not measure — D2/D3/D4 when that reading was a local
  // scan with no GitHub-side fold to carry. Demanding L5 on them would set the drive an impossible
  // target and spend its whole rope proving it, which is the failure `dry`/`ceiling` exist to avoid.
  const unmeasurableByRepo = new Map<string, string[]>();
  for (const r of rollup?.repos ?? []) {
    if (!r.latest) continue;
    dimsByRepo.set(r.fullName, r.latest.dims);
    if (r.latest.unmeasurableDims?.length) unmeasurableByRepo.set(r.fullName, r.latest.unmeasurableDims);
  }
  const perRepo = repos.map((name) => repoGreenness(name, dimsByRepo.get(name) ?? [], unmeasurableByRepo.get(name) ?? []));
  const fleet = fleetGreenness(perRepo);
  return {
    debt: fleet.totalDebt,
    green: fleet.green,
    greenCount: fleet.greenCount,
    inScope: perRepo.length,
    remaining: fleet.remaining.filter((r) => !r.unscanned).map((r) => r.fullName),
    unscanned: perRepo.filter((r) => r.unscanned).map((r) => r.fullName),
    // Carried so the cockpit can SAY which dimensions the verdict was reached without. A green light
    // standing on six dimensions is a different claim from one standing on nine, and a drive that
    // stops without disclosing the difference is the same silence this whole change removes.
    notMeasurable: perRepo
      .filter((r) => r.unmeasurable.length > 0)
      .map((r) => ({ repo: r.fullName, dims: r.unmeasurable })),
  };
}
