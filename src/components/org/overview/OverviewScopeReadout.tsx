// The "· <segment> segment · <stack> stack" suffix of the Overview's scope line. Its own tiny
// <Suspense> boundary: naming the active segment/stack needs two lookup queries, and the period
// title beside it needs none — holding "Showing · Last 90 days" behind a segment lookup would break
// the first law of the choreography (chrome always renders).

import type { OrgScope } from "@/lib/org/scope";

export async function OverviewScopeReadout({ scope }: { scope: Promise<OrgScope> }) {
  const { activeSegment, activeStack } = await scope;
  return (
    <>
      {activeSegment && (
        <>
          {" · "}
          <span className="text-accent">{activeSegment.name}</span> segment
        </>
      )}
      {activeStack && (
        <>
          {" · "}
          <span className="text-accent">{activeStack.label}</span> stack
        </>
      )}
    </>
  );
}
