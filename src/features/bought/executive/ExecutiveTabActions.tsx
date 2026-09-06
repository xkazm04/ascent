// The Briefing tab's header action row — stack scope, PDF download, share link, copy-for-LLM.
// Extracted from ExecutiveTab.tsx to hold the 200-LOC cap under src/features (AGENTS.md); pure
// relocation, no behavior change. Server component (the interactive bits are their own client
// components), so no "use client" here.

import { CopyForLlm } from "@/components/CopyForLlm";
import { DownloadButton } from "@/components/report/DownloadButton";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { BriefingShareButton } from "./BriefingShareButton";
import { chipButtonClass } from "@/components/ui";
import type { ResolvedWindow } from "@/lib/window";
import type { resolveStackScope } from "@/lib/org/scope";

type StackScope = Awaited<ReturnType<typeof resolveStackScope>>;

export function ExecutiveTabActions({
  slug,
  period,
  segmentId,
  techGroups,
  activeStack,
  canShare,
  md,
}: {
  slug: string;
  period: ResolvedWindow;
  segmentId: string | null;
  techGroups: StackScope["techGroups"];
  activeStack: StackScope["activeStack"];
  canShare: boolean;
  /** The "Copy for LLM" markdown payload, already serialized by the tab. */
  md: string;
}) {
  return (
        <div className="flex flex-wrap items-center gap-2">
        {techGroups.length > 0 && <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />}
        {/* G5-23: DownloadButton, not a bare anchor — the render is CPU-bound (and may run the
            narrative pass), so a click needs a busy state and an inline error instead of navigating
            the board reader onto a raw JSON error page. Matches the sibling security tab. */}
        <DownloadButton
          // EXEC #1: carry the active ?segment= (and the ?stack= tech scope, 3b) into the export so a
          // per-client / per-stack briefing downloads the SAME scope being viewed, not the whole org.
          href={`/api/org/briefing/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${segmentId ? `&segment=${encodeURIComponent(segmentId)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
          className={chipButtonClass()}
          title="Download the briefing as a board-ready PDF"
        >
          <span aria-hidden>↓</span> Download PDF
        </DownloadButton>
        {/* EXEC #1: carry the active segment + tech-stack scope into the share link too, so the
            read-only board link re-runs scoped to the same view the owner is sharing. */}
        {canShare && <BriefingShareButton org={slug} range={period.key} from={period.from} to={period.to} segment={segmentId} stack={activeStack?.key ?? null} />}
        <CopyForLlm text={md} label="Copy briefing for LLM" />
      </div>
  );
}
