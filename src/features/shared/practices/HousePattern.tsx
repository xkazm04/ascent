// "Your house pattern" (W6) — the practices this org already shares, mined from its own repos.
//
// The catalog beside this panel describes a generic good practice, identically for every customer.
// This describes THIS org's: the headings its strongest guidance files agree on, the layout its
// harnesses agree on. That is the half of `docs/VISION-TRANSITION.md` §Pillar 2 that never shipped.
//
// THE PANEL'S JOB IS TO BE AUDITABLE. Every mined line carries how many exemplars agreed, and every
// practice names which repos those were. A suggestion an engineer cannot trace back to their own
// codebase is a suggestion they are entitled to ignore — and this feature's whole claim is that it
// is showing them their own work, not a vendor's opinion.
//
// THREE HONEST SILENCES, all rendered:
//   - fewer than MIN_AGREEMENT exemplars → no pattern, and it says one strong repo is not a standard;
//   - exemplars that share nothing → no pattern, rather than promoting the best repo's document;
//   - no gap repos → a pattern with nobody to offer it to, said plainly instead of dressed as a task.
//
// Server-safe — no hooks, no handlers.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { MIN_AGREEMENT, type MinedPractice } from "@/lib/org/practice-mining";

function Lines({ title, lines }: { title: string; lines: { text: string; agreement: number }[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-slate-500">{title}</div>
      <ul className="mt-1.5 space-y-1">
        {lines.map((l) => (
          <li key={l.text} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-200">{l.text.replace(/^#+\s*/, "")}</span>
            {/* The evidence, on every line: how many of your repos independently do this. */}
            <span className="shrink-0 font-mono text-xs text-slate-500" title="repositories that independently carry this">
              {l.agreement}×
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HousePattern({ mined, reposWithShape }: { mined: MinedPractice[]; reposWithShape: number }) {
  const offerable = mined.filter((m) => m.offerable);
  const hasAnyPattern = mined.some((m) => m.outline.length > 0 || m.layout.length > 0);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Your house pattern"
        description="The practices this organization already shares, mined from the structure of your own strongest repositories, not from a generic template. Structure only: headings and layout travel between your repos, never an artifact's contents."
      />

      {reposWithShape === 0 && (
        <p className="mt-3 text-sm text-slate-400">
          No repository has been scanned since practice-shape extraction shipped, so there is nothing to mine yet.
          Re-scan the fleet and this fills in with your own patterns.
        </p>
      )}

      {reposWithShape > 0 && !hasAnyPattern && (
        <p className="mt-3 text-sm text-slate-400">
          Nothing is shared across {reposWithShape} scanned{" "}
          {reposWithShape === 1 ? "repository" : "repositories"} yet. A pattern needs at least{" "}
          <strong className="font-medium text-slate-200">{MIN_AGREEMENT} repositories</strong> to structure an artifact
          the same way. One strong repository&apos;s document is that team&apos;s document, not a house standard, and
          promoting it here would say otherwise.
        </p>
      )}

      {offerable.length > 0 && (
        <div className="mt-4 space-y-5">
          {offerable.map((m) => (
            <div key={m.practiceId} className="rounded-lg border border-divider bg-surface/40 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base text-white">{m.label}</span>
                <span className="font-mono text-xs uppercase tracking-widest text-slate-500">{m.dimId}</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Shared by{" "}
                <span className="text-slate-200">
                  {m.exemplars.length} {m.exemplars.length === 1 ? "repository" : "repositories"}
                </span>
                : {m.exemplars.join(", ")}. {m.gapRepos.length}{" "}
                {m.gapRepos.length === 1 ? "repository lacks" : "repositories lack"} it.
              </p>
              <Lines title="Shared outline" lines={m.outline} />
              <Lines title="Shared layout" lines={m.layout} />
            </div>
          ))}
        </div>
      )}

      {hasAnyPattern && offerable.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">
          Your repositories do share structure, but no repository is far enough behind on those dimensions to be worth
          offering it to. That is a good state, not a missing feature.
        </p>
      )}

      <p className="mt-4 rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">How this is built</span> A
        heading or path counts only when at least {MIN_AGREEMENT} of your exemplar repositories carry it
        independently, so what you see is agreement rather than the highest-scoring repository&apos;s copy. The{" "}
        <strong className="font-medium text-slate-200">{"n×"}</strong> beside each line is how many agreed. Only
        document skeletons and path layouts are read (never an artifact&apos;s body), and a mined pattern stays inside
        this organization.
      </p>
    </Card>
  );
}
