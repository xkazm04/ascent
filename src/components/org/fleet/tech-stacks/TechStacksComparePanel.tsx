// The A-vs-B stack comparison — the Tech Stacks tab's second data region, in its own <Suspense> so
// the (cheaper) analysis matrix above it doesn't wait on this query.

import { StackComparePanel } from "./StackComparePanel";
import { TechStackComparePicker } from "./TechStackComparePicker";
import { SectionHeader } from "@/components/org/shared/ui";
import { compareTechStacks } from "@/lib/db";
import type { TechGroupSummary } from "@/lib/db";
import type { OrgSearchParams } from "@/components/org/shell/OrgTabChunks";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function TechStacksComparePanel({
  slug,
  groups,
  sp,
}: {
  slug: string;
  groups: TechGroupSummary[];
  sp: OrgSearchParams;
}) {
  const options = groups.map((g) => ({ key: g.key, label: g.label }));
  const keys = new Set(options.map((o) => o.key));

  // Resolve the A/B selection from the URL, defaulting to the first two stacks. `b=fleet` is the
  // picker's explicit whole-fleet choice; a MISSING/bogus `b` defaults to the first other stack
  // (which is the whole fleet only when there's a single stack to compare against the baseline).
  const aParam = first(sp.a);
  const bParam = first(sp.b);
  const aKey = aParam && keys.has(aParam) ? aParam : options[0]!.key; // safe: groups non-empty in TechStacksTab
  const bKey =
    bParam === "fleet"
      ? null
      : bParam && keys.has(bParam) && bParam !== aKey
        ? bParam
        : options.find((o) => o.key !== aKey)?.key ?? null;

  const comparison = await compareTechStacks(slug, aKey, bKey);

  return (
    <>
      <SectionHeader
        title="Compare stacks"
        description="Two stacks side by side, mirrored per dimension: e.g. Frontend is AI-Native while Backend·Python is still Manual."
        right={<TechStackComparePicker options={options} a={aKey} b={bKey} />}
      />
      {comparison ? (
        <StackComparePanel org={slug} comparison={comparison} />
      ) : (
        <p className="mt-4 text-base text-slate-500">Pick two stacks to compare.</p>
      )}
    </>
  );
}
