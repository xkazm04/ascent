// Org dashboard "Follow-ups" tab — the fleet's open gaps as ONE ledger you act from: filter, pick a
// batch, get one fix prompt for a local coding agent, hand it off, and let the next scan of the
// default branch close what landed (src/lib/org/followups.ts).
//
// SERVER component, filename PINNED as FollowupsTab.tsx (docs/ORG-TABS-REFACTOR.md). One data source
// — the scoped backlog read WITH closed rows, so the resolved archive is the same query filtered
// client-side, never a second round-trip — so the single <Suspense> at the OrgTabChunks call site is
// enough. Rows are flattened server-side (rowsFromBacklog is pure) and handed to the client view.
//
// This is the surface that REPLACED the planning machinery of the Backlog (owners, due dates,
// owner/due grouping) and Plan (goals, initiatives, simulator) tabs — both retired 2026-08-17 — for
// the common case: work that fits one agent session. What fitted a mass-scan world was ported: bulk
// resolve/dismiss, the org-wide gap call, and the per-row timeline (see FollowupsWorklist).

import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { FollowupsWorklist } from "./FollowupsWorklist";
import { rowsFromBacklog } from "./followupsModel";
import { PersonalBacklog } from "@/components/org/PersonalBacklog";
import { getOrgBacklog, isPersonalOrg } from "@/lib/db";
import { FOLLOWUP_TRAILER } from "@/lib/org/followups";
import { resolveOrgScope } from "@/lib/org/scope";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function FollowupsTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // A PERSONAL workspace has no Recommendation rows of its own — its follow-ups are a private overlay
  // on the shared public corpus. The Backlog tab used to render that overlay; this tab does now.
  if (await isPersonalOrg(slug)) return <PersonalBacklog slug={slug} />;

  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  const backlog = await getOrgBacklog(slug, segmentId, new Date(), techGroupId, { includeClosed: true });
  const rows = backlog ? rowsFromBacklog(backlog) : [];
  const active = rows.filter((r) => r.status === "open" || r.status === "in_progress");
  const handedOff = rows.filter((r) => r.status === "in_progress").length;
  const points = active.reduce((s, r) => s + (r.projectedPoints ?? 0), 0);
  // `?dim=D3` — the deep link the Delivery/Tech-stack surfaces emit ("work the D3 follow-ups →"):
  // seeds the ledger's Dimension filter. A bogus value simply matches nothing and reads as a filter.
  const initialDim = typeof sp.dim === "string" && /^D[1-9]$/.test(sp.dim) ? sp.dim : undefined;

  return (
    <div className="stagger-children space-y-5">
      <SectionHeader
        title="Follow-ups"
        description={
          <>
            Every gap the scans left open, in one ledger. Filter, tick a batch, generate one fix prompt for your local agent, hand it off.
            Commits that carry <code className="rounded bg-slate-800/80 px-1 font-mono text-[0.9em] text-slate-200">{FOLLOWUP_TRAILER}: &lt;id&gt;</code>{" "}
            — or simply make the gap go away — are closed by the next scan of the default branch.
          </>
        }
        right={
          <span className="font-mono text-sm text-slate-400">
            <span className="tabular-nums text-slate-100">{active.length}</span> open · <span className="tabular-nums text-accent">{handedOff}</span> handed off ·{" "}
            <span className="tabular-nums text-white">+{points}</span> pts on the table
          </span>
        }
      />
      <ScopeFilterBar {...barProps} className="flex flex-wrap items-center justify-end gap-2" />

      {rows.length === 0 ? (
        <SectionEmpty>No follow-ups yet. Scan some repositories and their gaps land here.</SectionEmpty>
      ) : (
        <FollowupsWorklist org={slug} rows={rows} initialDim={initialDim} />
      )}
    </div>
  );
}
