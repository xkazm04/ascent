// Prism (v2) pieces of the Knowledge base tab, server-safe. The matrix itself (KnowledgeLoom) is one
// composition that the token layer already restyles; what v2 adds is the structure around it: a masthead
// that states how much of the fleet the registry's bundles reach, a Frame instead of a free-floating
// column, and notices as ruled Frames rather than boxed cards.
import Link from "next/link";
import { Frame, Masthead, SectionHead } from "@/components/kit";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeLoom } from "./KnowledgeLoom";
import { columnRepos, unmappedRepos } from "./knowledgeModel";

export function KnowledgeNoticeV2({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <Frame aria-label={title}>
      <SectionHead eyebrow="Knowledge base" title={title} level="section" />
      <p className="mt-4 max-w-2xl type-body text-slate-400">{body}</p>
    </Frame>
  );
}

export function KnowledgeBodyV2({
  view,
  slug,
  initialDomain,
  initialSubject,
}: {
  view: KnowledgeView;
  slug: string;
  initialDomain: string | null;
  initialSubject: string | null;
}) {
  const mapped = columnRepos(view.repos).length;
  const off = unmappedRepos(view.repos).length;
  return (
    <div data-role="knowledge-v2" className="space-y-6">
      <Masthead
        eyebrow="Shared · knowledge base"
        statement="The registry's standards,"
        named="against your fleet."
        lede="One cell per subject and swept repository, in the registry's own vocabulary. Ascent mirrors the verdicts; each repo's conform run writes them."
        figures={[
          { label: "Bundles", value: view.totals.domains, detail: `${view.totals.subjects} subjects` },
          { label: "Repos on the map", value: mapped },
          { label: "Repos off the map", value: off, tone: off > 0 ? "watch" : undefined, detail: off > 0 ? "populate and map them first" : "every swept repo is mapped" },
        ]}
        pattern="dots"
      />
      <Frame pad="sm" edge="both" aria-label="Subjects by repository">
        <KnowledgeLoom view={view} slug={slug} initialDomain={initialDomain} initialSubject={initialSubject} />
      </Frame>
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "memory")} className="focus-ring type-caption text-accent transition hover:text-white">
          Org memory →
        </Link>
      </nav>
      <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
    </div>
  );
}
