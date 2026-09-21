// The "latest" rail — `pulse.latest` as ONE line at the foot of the theater, newest first, clustered
// (theaterLatest.ts). No marquee: a line that scrolls by itself is ambient motion implying progress.
// What does not fit is clipped behind a fade, and the newest is always the leftmost.
//
// A cluster ENTERS (a single `animate-pop-in`) only when its oldest member arrived while the page was
// open (`arrivedKeys`, filled by the transport on every read after the first) — so a reload or a poll
// never replays the rail, and a growing cluster updates in place. Reduced motion: no entrance at all.

import { fmtClock, repoShort } from "./theaterFormat";
import { clusterLatest, latestTone, type LatestTone } from "./theaterLatest";
import type { PulseEvent } from "@/lib/local/runner-types";

const TONE: Record<LatestTone, string> = {
  good: "text-success-soft",
  attention: "text-amber-300",
  bad: "text-danger",
  info: "text-accent-soft",
};

const RAIL_MAX = 8;

export function TheaterLatestRail({
  events,
  arrivedKeys,
  reducedMotion,
}: {
  events: readonly PulseEvent[];
  arrivedKeys: ReadonlySet<string>;
  reducedMotion: boolean;
}) {
  const clusters = clusterLatest(events).slice(0, RAIL_MAX);
  return (
    <footer aria-label="Latest" className="flex items-center gap-4 border-t border-divider px-6 py-3">
      <span className="shrink-0 type-label tracking-[0.22em] text-slate-500">Latest</span>
      {clusters.length === 0 ? (
        <span className="type-body text-slate-500">Nothing yet today.</span>
      ) : (
        <ol className="relative flex min-w-0 flex-1 items-center gap-6 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_85%,transparent)]">
          {clusters.map((c) => (
            <li
              key={c.id}
              data-cluster={c.id}
              className={`flex shrink-0 items-baseline gap-2 type-body ${!reducedMotion && arrivedKeys.has(c.anchorKey) ? "animate-pop-in" : ""}`}
            >
              <span className={`font-medium ${TONE[latestTone(c.kind)]}`}>{c.headline}</span>
              {c.count > 1 ? <span className="font-mono type-mono-sm text-slate-400">×{c.count}</span> : null}
              <span className="font-mono type-mono-sm text-slate-500">
                {repoShort(c.repo)} · {fmtClock(c.at) ?? ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </footer>
  );
}
