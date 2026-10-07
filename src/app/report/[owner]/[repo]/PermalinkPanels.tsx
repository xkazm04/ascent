// The panels the report permalink stacks under ReportView, plus its instant masthead — extracted from
// page.tsx (300-LOC rule) so the page keeps the server reads and their failure handling in one place.
// Server components: no hooks, no handlers.

import { PassportCard } from "@/features/standing/passports/PassportCard";
import { Kicker } from "@/components/ui";
import type { SkillGenerationRow } from "@/lib/db";
import type { AppPassport } from "@/lib/types";
import { SkillHistorySection, SkillHistoryUnavailable } from "./SkillHistorySection";

/** The passport card and the STD-6 skill history. `passport` undefined/null renders no card (a failed
 *  passport read is handed to ReportView's client fetch instead); `skillHistory` undefined is a FAILED
 *  read and says so, while `[]` is the answer "none yet" and renders nothing. */
export function PermalinkPanels({
  passport,
  repoRef,
  canEdit,
  canFilePr,
  skillHistory,
}: {
  passport: AppPassport | null | undefined;
  repoRef: string;
  canEdit: boolean;
  canFilePr: boolean;
  skillHistory: SkillGenerationRow[] | undefined;
}) {
  return (
    <>
      {passport && (
        <div className="mt-8 animate-fade-up" style={{ animationDelay: "120ms" }}>
          {/* The `engine` prop this branch passed is dropped: master's PassportCard cluster (declines
              with identity, the autonomy verdict, PassportCardDeclined) is the landed implementation of
              the same feature set and does not take one. Labelling a placeholder scan on the repo's own
              page is therefore NOT on master — it survives only in the org portfolio, and is recorded as
              an open item rather than silently carried by a prop the component would ignore. */}
          <PassportCard passport={passport} repo={repoRef} canEdit={canEdit} canFilePr={canFilePr} />
        </div>
      )}
      {skillHistory === undefined ? (
        <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
          <SkillHistoryUnavailable />
        </div>
      ) : (
        skillHistory.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
            <SkillHistorySection rows={skillHistory} />
          </div>
        )
      )}
    </>
  );
}

/** Instant repo masthead — derived purely from the URL, so it paints with zero data dependency. Doubles
 *  as the Suspense fallback (with a calm "reading…" line, never a pulsing skeleton) and is replaced in
 *  place by ReportView's own header — which repeats the same Kicker + title at the same position — when
 *  the report streams in, so the title never jumps. */
export function ReportMasthead({ repoRef, loading = false }: { repoRef: string; loading?: boolean }) {
  return (
    <div className="animate-fade-up">
      <Kicker tone="muted">Repository report</Kicker>
      <h1 className="mt-2 type-heading font-bold text-white">{repoRef}</h1>
      {loading && (
        <p className="mt-2 flex items-center gap-2 type-body-sm text-slate-500">
          <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Reading the latest scan…
        </p>
      )}
    </div>
  );
}
