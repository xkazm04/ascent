// Org dashboard "Proposals" tab (In flight) — every piece of proposed work waiting on a decision, in
// ONE ledger: the gaps the scans left open (the former Follow-ups tab, merged here 2026-09-15) and
// the loop's pending proposals (what a run armed and nobody has ruled on yet — previously only
// decidable cell-by-cell on the Live tab's outcome sheet).
//
// SERVER component, filename PINNED as ProposalsTab.tsx (docs/ORG-TABS-REFACTOR.md). `?tab=followups`
// still resolves here: the org page redirects the old id so links already in inboxes keep working.
//
// Reads: the scoped backlog WITH closed rows (the resolved archive is the same query filtered
// client-side), and the details of the recent loop runs — the same bounded read the Live tab makes,
// done here in the server component rather than as N browser round trips.

import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { PersonalBacklog } from "@/components/org/PersonalBacklog";
import { LocalRescanButton } from "@/components/org/followups/LocalRescanButton";
import { rowsFromBacklog } from "@/components/org/followups/followupsModel";
import { getOrgBacklog, isPersonalOrg, listLocalPairings } from "@/lib/db";
import { getLoopRunDetail, listLoopRuns } from "@/lib/db/loop-runs";
import type { LoopRunDetail } from "@/lib/db/loop-runs-types";
import { hasOrgRole } from "@/lib/authz";
import { selfHosted } from "@/lib/env";
import { resolveOrgScope } from "@/lib/org/scope";
import { ProposalsWorklist } from "./ProposalsWorklist";
import { mergeProposals, pendingLoopProposals } from "./proposalsModel";

type SearchParams = { [key: string]: string | string[] | undefined };

/** The same bound the Live tab uses: the 12 newest of the 20 listed runs. A detail that fails to load
 *  is dropped rather than failing the tab. */
async function recentRunDetails(slug: string): Promise<LoopRunDetail[]> {
  const runs = await listLoopRuns(slug, 20).catch(() => []);
  const details = await Promise.all(runs.slice(0, 12).map((r) => getLoopRunDetail(r.id).catch(() => null)));
  return details.filter((d): d is LoopRunDetail => d != null);
}

export async function ProposalsTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // A PERSONAL workspace has no Recommendation rows and no loop — its follow-ups are a private overlay
  // on the shared public corpus, rendered exactly as the Follow-ups tab rendered it.
  if (await isPersonalOrg(slug)) return <PersonalBacklog slug={slug} />;

  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  // LOCAL MODE: the repos paired with a working copy on this server. Their trailer commits can close
  // rows without a push — the rescan button is that loop's one click. Empty on managed cloud.
  const pairedRepos = selfHosted()
    ? (await listLocalPairings(slug).catch(() => [])).filter((r) => r.localPath != null).map((r) => r.fullName)
    : [];
  const [backlog, details, canReview] = await Promise.all([
    getOrgBacklog(slug, segmentId, new Date(), techGroupId, { includeClosed: true }),
    recentRunDetails(slug),
    // The loop review gate is owner-only, as on the Live tab's sheet; the route re-checks it.
    hasOrgRole(slug, "owner"),
  ]);
  const followups = backlog ? rowsFromBacklog(backlog) : [];
  const loop = pendingLoopProposals(details);
  const rows = mergeProposals(followups, loop);

  const active = followups.filter((r) => r.status === "open" || r.status === "in_progress");
  const handedOff = followups.filter((r) => r.status === "in_progress").length;
  const points = active.reduce((s, r) => s + (r.projectedPoints ?? 0), 0);
  // `?dim=D3` — the deep link the Delivery/Tech-stack surfaces emit: seeds the Dimension filter.
  const initialDim = typeof sp.dim === "string" && /^D[1-9]$/.test(sp.dim) ? sp.dim : undefined;

  return (
    <div className="stagger-children space-y-5">
      <SectionHeader
        title="Proposals"
        description="Every proposed change waiting on a decision, in one ledger."
        right={
          <span className="type-mono-sm text-slate-400">
            <span className="tabular-nums text-slate-100">{active.length}</span> open ·{" "}
            <span className="tabular-nums text-accent">{handedOff}</span> handed off ·{" "}
            <span className="tabular-nums text-slate-100">{loop.length}</span> from the loop ·{" "}
            <span className="tabular-nums text-white">+{points}</span> pts on the table
          </span>
        }
      />
      <ScopeFilterBar {...barProps} className="flex flex-wrap items-center justify-end gap-2" />
      {pairedRepos.length > 0 && <LocalRescanButton org={slug} repos={pairedRepos} />}

      {rows.length === 0 ? (
        <SectionEmpty>No proposals yet. Scan some repositories and their gaps land here; so does a loop run&apos;s unreviewed work.</SectionEmpty>
      ) : (
        <ProposalsWorklist org={slug} rows={rows} initialDim={initialDim} canReview={canReview} />
      )}
    </div>
  );
}
