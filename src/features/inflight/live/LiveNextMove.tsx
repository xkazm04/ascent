// Live's onward link (org path of use, Apply -> Measure). Its own file because LiveTab.tsx is at its
// line cap and the link ends all four views (wall, cockpit, ledger, desk). The literal below is the
// one tab-link-graph.test.ts reads, so it stays a literal.
//
// TV mode fullscreens <html> (enterTvMode) and the wall's stage is an in-flow min-h-[70vh] box, so this
// link would sit under the stage on a display nobody clicks: the :root:fullscreen variant hides it there.
import Link from "next/link";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";

export function LiveNextMove({ slug }: { slug: string }) {
  return (
    <div className="[:root:fullscreen_&]:hidden">
      {/* A second route to the same stage's audit trail; the next move below stays alone. */}
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "audit")} className="focus-ring type-caption text-accent transition hover:text-white">
          Audit trail →
        </Link>
      </nav>
      <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
    </div>
  );
}
