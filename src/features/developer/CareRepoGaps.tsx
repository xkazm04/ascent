"use client";

// "My repos' gaps" — the cross-repo grounding a local skill structurally cannot have. The mentor sees
// one machine's transcripts; ascent sees the standing of every repo the developer commits to, and can
// say which open recommendation they are already the natural champion of.
//
import { SectionEmpty } from "@/components/org/shared/ui";
import { reportPermalink } from "@/lib/ui";
import { CareLevelMark, CareLinkAction } from "./CareBits";
import type { DeveloperView } from "@/lib/org/developer-view";

export function CareRepoGaps({ repos }: { repos: DeveloperView["myRepos"] }) {
  if (repos.length === 0) {
    return (
      <SectionEmpty>
        No repos linked yet. Watch the repositories you commit to and their open gaps show up here — the reason a move
        can be grounded in more than one machine&apos;s transcripts.
      </SectionEmpty>
    );
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {repos.map((r) => (
        <div key={r.fullName} className="rounded-xl border border-divider bg-ink p-4">
          <div className="flex items-baseline justify-between gap-3">
            <a className="focus-ring min-w-0 truncate font-mono type-body text-accent hover:text-white" href={reportPermalink(r.fullName)} title={r.fullName}>
              {r.fullName}
            </a>
            <CareLevelMark level={r.level} score={r.score} />
          </div>
          <ul className="mt-3 space-y-2 border-t border-divider pt-3">
            {r.openRecommendations.map((rec) => (
              <li key={rec.title}>
                <div className="type-label tracking-widest text-slate-500">{rec.dimension}</div>
                <div className="type-body text-slate-300">{rec.title}</div>
                <div className="mt-1">
                  <CareLinkAction label="Make this a move" intent="move.fromRecommendation" payload={{ repo: r.fullName, title: rec.title }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
