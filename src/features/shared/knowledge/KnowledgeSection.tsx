// The Knowledge base tab's section host (SERVER). `?section=surfaces` swaps the registry's subjects
// view for the UI surfaces gallery — folded in from the former UI surfaces tab on 2026-10-06 (same
// Apply stage). One switch on top of both views, and exactly one next-move link per view: the subjects
// view's lives in KnowledgeTab, the gallery's here.

import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { SurfacesTab } from "@/features/shared/surfaces/SurfacesTab";

import { KnowledgeSectionSwitch } from "./KnowledgeSectionSwitch";
import { KnowledgeTab } from "./KnowledgeTab";

type SearchParams = { [key: string]: string | string[] | undefined };

export function KnowledgeSection({ slug, sp = {} }: { slug: string; sp?: SearchParams }) {
  const surfaces = sp.section === "surfaces";
  return (
    <div className="space-y-4">
      <KnowledgeSectionSwitch slug={slug} active={surfaces ? "surfaces" : "subjects"} />
      {surfaces ? (
        <>
          <SurfacesTab slug={slug} />
          <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
        </>
      ) : (
        <KnowledgeTab slug={slug} sp={sp} />
      )}
    </div>
  );
}
