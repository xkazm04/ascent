"use client";

// "My repos' gaps" — the cross-repo grounding a local skill structurally cannot have. The mentor sees
// one machine's transcripts; ascent sees the standing of every repo the developer commits to, and can
// say which open recommendation they are already the natural champion of.
//
import { SectionEmpty } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/lib/org/champions";
import { reportPermalink } from "@/lib/ui";
import { CareLevelMark, CareLinkAction } from "./CareBits";
import type { CareActivityState, DeveloperView } from "@/lib/org/developer-view";

/** Same withheld/unreadable sentences as DeveloperActivityStrip — empty here is not "go watch repos". */
function emptyReposCopy(activityState: CareActivityState) {
  if (activityState === "withheld") {
    return (
      <>
        Withheld: this workspace has fewer than {CHAMPION_MIN_POP} contributors, so the snapshot suppresses{" "}
        <em>every</em> per-person row — including your own. Your commits exist; they are not being handed to a
        page that could name one or two people.
      </>
    );
  }
  if (activityState === "unreadable") {
    return <>The contributor snapshot could not be read just now, so nothing here is a measurement of you.</>;
  }
  return (
    <>
      No repos linked yet. Watch the repositories you commit to and their open gaps show up here — the reason a move
      can be grounded in more than one machine&apos;s transcripts.
    </>
  );
}

export function CareRepoGaps({
  repos,
  activityState,
}: {
  repos: DeveloperView["myRepos"];
  activityState: CareActivityState;
}) {
  if (repos.length === 0) {
    return <SectionEmpty>{emptyReposCopy(activityState)}</SectionEmpty>;
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {repos.map((r) => (
        <div key={r.fullName} className="rounded-xl border border-divider bg-ink p-4">
          <div className="flex items-center justify-between gap-3">
            <a className="focus-ring min-w-0 truncate font-mono type-body text-accent hover:text-white" href={reportPermalink(r.fullName)} title={r.fullName}>
              {r.fullName}
            </a>
            <CareLevelMark level={r.level} score={r.score} />
          </div>
          {/* A repo with nothing open is a fact worth stating. The rule with an empty list under it
              read as a section that had failed to load. */}
          {r.openRecommendations.length === 0 ? (
            <p className="mt-3 border-t border-divider pt-3 type-body-sm text-slate-500">No open gaps.</p>
          ) : (
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
          )}
        </div>
      ))}
    </div>
  );
}
