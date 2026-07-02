// /org/[slug]/tech-stacks — the tech-stack comparison page (3b-P2). A dense stack × dimension heat
// matrix (whole-fleet baseline pinned on top, per-row repos/brief/compare links), computed signal
// callouts beneath it, and an A-vs-B butterfly comparison panel. Mirrors the Segments comparison
// page; reuses getOrgRollup's scoped averages via compareTechStacks. The org layout supplies the
// auth/DB guards. Stacks are auto-derived (no creation here) — when there are none, point to scanning.

import Link from "next/link";
import { StackComparePanel } from "@/components/org/StackComparePanel";
import { StackMatrix } from "@/components/org/StackMatrix";
import { StackSignals } from "@/components/org/StackSignals";
import { TechStackComparePicker } from "@/components/org/TechStackComparePicker";
import { DIMS, SectionEmpty, SectionHeader } from "@/components/org/ui";
import { compareTechStacks, listTechStackGroups, listTechStackSummaries } from "@/lib/db";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrgTechStacks({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const [groups, summaries] = await Promise.all([
    listTechStackGroups(slug),
    listTechStackSummaries(slug, { includeFleet: true }).then((s) => s ?? []),
  ]);

  if (groups.length === 0) {
    return (
      <SectionEmpty>
        No tech stacks detected yet. Stacks are derived from each repo&apos;s manifests at scan time — scan some of this org&apos;s{" "}
        <Link href={`/org/${slug}/repositories`} className="text-accent hover:text-white">repositories</Link>, then this view groups them by Frontend / Backend·language / Mobile / Data·ML / Infra.
      </SectionEmpty>
    );
  }

  // The whole-fleet baseline (id null) anchors the matrix; stacks rank leaderboard-style by overall.
  const fleet = summaries.find((s) => s.id === null) ?? null;
  const stacks = summaries.filter((s) => s.id !== null).sort((x, y) => y.avgOverall - x.avgOverall);

  const options = groups.map((g) => ({ key: g.key, label: g.label }));
  const keys = new Set(options.map((o) => o.key));

  // Resolve the A/B selection from the URL, defaulting to the first two stacks. `b=fleet` is the
  // picker's explicit whole-fleet choice; a MISSING/bogus `b` defaults to the first other stack
  // (which is the whole fleet only when there's a single stack to compare against the baseline).
  const aParam = first(sp.a);
  const bParam = first(sp.b);
  const aKey = aParam && keys.has(aParam) ? aParam : options[0]!.key; // safe: groups non-empty above
  const bKey =
    bParam === "fleet"
      ? null
      : bParam && keys.has(bParam) && bParam !== aKey
        ? bParam
        : options.find((o) => o.key !== aKey)?.key ?? null;

  const comparison = await compareTechStacks(slug, aKey, bKey);

  return (
    <div className="space-y-6">
      {/* Stack × dimension matrix + computed signals */}
      <div>
        <SectionHeader
          title="Tech stacks"
          description="Per-stack maturity across the fleet — each auto-derived group rolled up from its repos' latest scans, one dimension per column, anchored against the whole-fleet baseline."
        />
        <StackMatrix org={slug} stacks={stacks} fleet={fleet} dims={DIMS} bKey={bKey} />
        <StackSignals org={slug} stacks={stacks} />
      </div>

      {/* Side-by-side comparison */}
      <div id="compare">
        <SectionHeader
          title="Compare stacks"
          description="Two stacks side by side, mirrored per dimension — e.g. Frontend is AI-Native while Backend·Python is still Manual."
          right={<TechStackComparePicker options={options} a={aKey} b={bKey} />}
        />
        {comparison ? (
          <StackComparePanel org={slug} comparison={comparison} />
        ) : (
          <p className="mt-4 text-base text-slate-500">Pick two stacks to compare.</p>
        )}
      </div>
    </div>
  );
}
