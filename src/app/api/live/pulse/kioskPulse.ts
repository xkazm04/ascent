// What an UNAUTHENTICATED screen may see of the runner's pulse — the pulse minus every piece of prose.
//
// A kiosk is a wall anyone in the room (or anyone the link leaks to) can read. Paths, phases, counts,
// timings and repo names are what the theater draws, and they stay. Words an agent or an error wrote
// do not:
//   - each lane activity's `note` (the first line of assistant text, a search pattern) → null;
//   - each repo's runner `note` (a conflict list, an install error's output) → null;
//   - each `latest` headline → fixed words for its kind. The signed-in pulse titles a landing with the
//     deliverable's own headline, a pending plan with its intent and a failure with the error's first
//     line — agent prose and error text, exactly what the rule withholds.
// Pure, so the withholding is pinned by a test rather than trusted.

import type { LoopPulse, PulseEvent } from "@/lib/local/runner-types";

export const KIOSK_HEADLINES: Readonly<Record<PulseEvent["kind"], string>> = {
  landed: "Landed on the runner branch",
  "verified-close": "Verified close",
  "plan-pending": "A plan waits for approval",
  paused: "Runner paused",
  "direction-done": "A direction finished",
  rejected: "Discarded — checks regressed",
  failed: "A lane failed",
};

export function kioskPulse(p: LoopPulse): LoopPulse {
  return {
    ...p,
    runner: p.runner ? { ...p.runner, repos: p.runner.repos.map((r) => ({ ...r, note: null })) } : null,
    lanes: p.lanes.map((l) => ({ ...l, tail: l.tail.map((t) => ({ ...t, note: null })) })),
    latest: p.latest.map((e) => ({ ...e, headline: KIOSK_HEADLINES[e.kind] ?? "Runner event" })),
  };
}
