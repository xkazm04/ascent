// Live's onward link (org path of use, Apply -> Measure). Its own file because LiveTab.tsx is at its
// line cap and the link ends all four views (wall, cockpit, ledger, desk). The literal below is the
// one tab-link-graph.test.ts reads, so it stays a literal.
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";

export function LiveNextMove({ slug }: { slug: string }) {
  return <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />;
}
