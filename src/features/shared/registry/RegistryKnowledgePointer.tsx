// Where the subject-level reading of the registry went. The conformance matrix, the weak-governance
// ranking and the signals readout used to render here; since 2026-09-05 they live in the Knowledge
// base tab, which mirrors the registry's own structure and is the ONE home for subject rows — two
// renderings of the same pairs drifted, and this tab's copy silently stopped at 24 rows.
//
// Server-safe (no hooks). Says only what this view can vouch for: whether a sweep has ever run and
// how many pairs it holds; the reading itself is one click away.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { orgTabHref } from "@/lib/org/orgTabs";

export function RegistryKnowledgePointer({ view, slug }: { view: RegistryView; slug: string }) {
  const c = view.conformance;
  const judged = c ? c.repos.reduce((n, r) => n + r.judged, 0) : 0;
  const pairs = c ? c.repos.reduce((n, r) => n + r.pairs, 0) : 0;
  const line = !c
    ? "No conformance sweep has run yet — nothing is known about how the fleet tracks against the corpus, which is not the same as a fleet that conforms."
    : `${judged.toLocaleString()} of ${pairs.toLocaleString()} pairs judged across ${c.repos.length} mapped repo${c.repos.length === 1 ? "" : "s"}${
        c.reposWithoutMap ? ` · ${c.reposWithoutMap} with no map` : ""
      }${c.subjects ? ` · ${c.subjects} subjects mirrored` : ""}.`;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-2xl border border-divider bg-surface/40 px-5 py-4">
      <div className="space-y-1">
        <Kicker tone="muted">Conformance · subject × repo</Kicker>
        <p className="type-body-sm text-slate-400">{line}</p>
      </div>
      <Link href={orgTabHref(slug, "knowledge")} className="focus-ring type-mono-sm text-accent transition hover:text-white">
        Open the Knowledge base →
      </Link>
    </div>
  );
}
