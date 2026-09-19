// The exemplar comparison's resolution block (moonshot #34), lifted out of `page.tsx` so the page
// stays an orchestrator and every `.tsx` here stays well under the 300-LOC cap (AGENTS.md).
//
// This is the ONE place that turns a raw `?against=` token into either a panel or a notice. It never
// substitutes: an unparseable ref, a missing exemplar, a cohort under its floor and a DB outage each
// render a sentence saying the comparison was not made, and the time diff above is untouched.

import { minePracticeShapes } from "@/lib/org/practice-mining";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";
import { DEFAULT_ORG_SLUG } from "@/lib/db/scans-shared";
import type { ComparableScan } from "@/lib/db/scans";
import { diffAcrossRepos, parseExemplarRef, transferJoin } from "@/lib/report/exemplar";
import { isScanEligible, resolveExemplar } from "@/lib/report/exemplar-load";
import { exemplarMarkdownSection } from "@/lib/report/llm-markdown";
import { ExemplarFailureNotice, ExemplarPanel, type ExemplarFailure } from "./ExemplarPanel";

export async function ExemplarSection({
  against,
  orgSlug,
  subjectFullName,
  subject,
}: {
  /** The raw `?against=` token. */
  against: string;
  orgSlug: string;
  subjectFullName: string;
  /** The scan being compared — the `after` side of the time diff, so both views agree. */
  subject: ComparableScan;
}) {
  const ref = parseExemplarRef(against);
  if (!ref) return <ExemplarFailureNotice failure={{ kind: "unparseable", raw: against }} />;

  const resolution = await resolveExemplar(ref, { orgSlug, subjectFullName });
  if (resolution.kind !== "ok") {
    return <ExemplarFailureNotice failure={resolution as ExemplarFailure} />;
  }

  const subjectEligible = await isScanEligible(subject.id);
  const diff = diffAcrossRepos(subject, resolution.profile, { subjectEligible });

  // A public-org viewer has no org tabs to link into, so the join is asked for null hrefs rather than
  // handed a slug that would dangle. Mining is best-effort: no house pattern is a fine answer, and a
  // failed read must not take the panel down.
  const linkSlug = orgSlug === DEFAULT_ORG_SLUG ? null : orgSlug;
  const shapes = linkSlug ? await getOrgPracticeShapes(linkSlug).catch(() => null) : null;
  const transfers = transferJoin(diff, shapes ? minePracticeShapes(shapes) : [], linkSlug);

  return <ExemplarPanel diff={diff} transfers={transfers} markdown={exemplarMarkdownSection({ diff, transfers })} />;
}
