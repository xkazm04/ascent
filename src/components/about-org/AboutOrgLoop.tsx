"use client";

// The operating loop — the section /about doesn't have.
//
// Every capability up to here is a noun. A buyer's remaining question is a verb one: what does using
// this actually look like on a Tuesday? Five steps, each naming the module that owns it — drawn as a
// closed loop rather than a funnel, because the last step feeds the first and a marketing page that
// draws this as a funnel is quietly promising a one-off engagement.
//
// The shape is the live cockpit's (?tab=live), not an illustration of it. Five cards side by side
// read as a FUNNEL: left to right, arrive, done. What the live theater actually shows is a track with
// a stop per verb and repositories distributed AROUND it, each mid-glide between two stops, all of
// them looping. So the five steps are the head of a rail (a real tablist: pick a stop, read what
// happens there), the lanes below are repositories moving through one cycle, and the return edge is
// DRAWN rather than described — honest at every breakpoint because the stop geometry is a fixed
// five-column grid, not a reflowing card grid (`stopPct`, one function, shared by the head, the lanes
// and the arc).
//
// Illustrative run, labelled as such: the vocabulary (lanes, stops, commits/closed counters, a run
// lift) is the cockpit's; the numbers are a sample.

import { useState } from "react";
import Link from "next/link";
import { Kicker, SectionHeading, deltaHex, fmtDelta } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { LOOP_RETURN_INDEX, LOOP_STEPS } from "./loopSteps";
import { useLoopPlayhead } from "./aboutOrgLoopMotion";
import { LoopLane, lanePos, laneProgress, stopPct, type TrackLane } from "./AboutOrgLoopTrackLane";

const LANES: TrackLane[] = [
  { repo: "platform/billing-api", from: 1, to: 4, commits: 6, closed: 3, lift: 9 },
  { repo: "web/payments-web", from: 2, to: 4, commits: 4, closed: 2, lift: 6 },
  { repo: "data/ingest-worker", from: 0, to: 2, commits: 0, closed: 0, lift: 0 },
  { repo: "mobile/checkout-ios", from: 3, to: 4, commits: 9, closed: 5, lift: 12 },
];

export function AboutOrgLoop() {
  const { ref, p, replay, playing } = useLoopPlayhead();
  const [active, setActive] = useState(LOOP_RETURN_INDEX);
  const step = LOOP_STEPS[active]!;

  // Live occupancy per stop — the fact a row of five cards structurally cannot show.
  const at = LANES.map((l, i) => Math.round(lanePos(l, i, p)));
  const netLift = LANES.reduce((n, l, i) => n + Math.round(l.lift * laneProgress(i, p)), 0);
  const improved = LANES.filter((l, i) => Math.round(l.lift * laneProgress(i, p)) > 0).length;

  return (
    <DeckSection id="loop" contained justify="startLgCenter">
      <Reveal>
        <SectionHeading
          size="page"
          kicker="How it runs"
          title="One track. The whole fleet on it at once."
          intro="Five stops, and every repository is somewhere between two of them. The next scan re-scores what the last decision changed — which is the only thing that turns an index into a management instrument instead of a quarterly slide."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <div
          ref={ref}
          className="tick-corners mt-8 overflow-hidden rounded-2xl border border-divider bg-surface-strong/30 2xl:mt-12"
        >
          {/* The stop head shares the lanes' horizontal padding, so a five-column grid puts each
              stop's centre exactly on the `stopPct` its rails and the return arc use below. */}
          <div className="border-b border-divider px-5">
            <div role="tablist" aria-label="Loop stops" className="grid grid-cols-5">
              {LOOP_STEPS.map((s, i) => {
                const on = i === active;
                const here = at.filter((a) => a === i).length;
                return (
                  <button
                    key={s.n}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setActive(i)}
                    className={`focus-ring flex flex-col items-center gap-1 py-3 transition ${
                      i > 0 ? "border-l border-divider/60" : ""
                    } ${on ? "text-accent" : "text-slate-500 hover:text-slate-200"}`}
                  >
                    <span className="font-mono text-xs tabular-nums">{s.n}</span>
                    <span className="truncate font-mono text-xs uppercase tracking-[0.16em]">{s.title}</span>
                    <span className="font-mono text-xs tabular-nums text-slate-600">
                      {here > 0 ? `${here} here` : "—"}
                    </span>
                    <span aria-hidden className={`h-px w-8 transition ${on ? "bg-accent" : "bg-transparent"}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="divide-y divide-divider/60">
            {LANES.map((lane, i) => (
              <LoopLane key={lane.repo} lane={lane} index={i} p={p} />
            ))}
          </ul>

          {/* The return edge, DRAWN — from the last stop back to 02. Its two ends sit on the same
              `stopPct` centres the rails above use, so it cannot point between stops. */}
          <div className="relative mx-5 h-9" aria-hidden>
            <div
              className="absolute top-0 h-6 rounded-b-xl border-b border-l border-r border-accent/40"
              style={{
                left: `${stopPct(LOOP_RETURN_INDEX)}%`,
                width: `${stopPct(LOOP_STEPS.length - 1) - stopPct(LOOP_RETURN_INDEX)}%`,
              }}
            />
            <span
              className="absolute -top-1 -translate-x-1/2 font-mono text-xs leading-none text-accent"
              style={{ left: `${stopPct(LOOP_RETURN_INDEX)}%` }}
            >
              ▲
            </span>
            <span
              className="absolute bottom-0 -translate-x-1/2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500"
              style={{ left: `${(stopPct(LOOP_RETURN_INDEX) + stopPct(LOOP_STEPS.length - 1)) / 2}%` }}
            >
              ↺ next scheduled scan
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-divider px-5 py-3">
            <span className="font-mono text-xs tabular-nums text-slate-500">
              Illustrative cycle · net{" "}
              <span style={{ color: deltaHex(netLift) }}>{fmtDelta(netLift)}</span> across {LANES.length} lanes ·{" "}
              {improved} improved
            </span>
            <button
              type="button"
              onClick={replay}
              className="focus-ring rounded font-mono text-xs uppercase tracking-[0.2em] text-slate-500 transition hover:text-accent"
            >
              {playing ? "running…" : "↻ replay cycle"}
            </button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <Link
          href={step.href}
          className="focus-ring group mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-2 border-l-2 border-accent/50 pl-4 transition hover:border-accent"
        >
          <Kicker>
            {step.n} {step.title} · {step.module}
          </Kicker>
          <p className="deck-body text-base text-slate-300 group-hover:text-white">
            {step.detail}{" "}
            <span aria-hidden className="font-mono text-slate-600 transition group-hover:text-accent">
              →
            </span>
          </p>
        </Link>
      </Reveal>
    </DeckSection>
  );
}
