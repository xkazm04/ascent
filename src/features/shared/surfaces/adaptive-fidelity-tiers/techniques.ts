// The drawer entries for the adaptive-fidelity-tiers scene: one per technique of the registry subject
// (authored against sha256:b28d9f28795d6750, 2026-09-06). `mechanism` explains the React/Tailwind/
// Motion mechanism the region demonstrates; `source` is the scene's own code; `inAscent` cites the
// real Ascent file that already realizes the technique (or null); `deviation` names the shortfall.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "measured-not-declared-capability",
    title: "Measured, not declared, capability",
    mechanism:
      "The tier is computed from frame intervals, summarised per window by `percentile()` at p90 — the six worst of sixty frames — never by the mean, which the readout shows beside it greyed out. " +
      "Windows are fixed in sample count (`WINDOW_SAMPLES = 60`), so a slow device's window is the same statistic as a fast one's, and the thresholds are absolute milliseconds rather than a fraction of the panel's budget. " +
      "A window that straddled a visibility change is logged as `discarded`: it decides nothing and counts toward nothing. " +
      "The declared strip shows what a user-agent / core-count guess would have said about the fictional device and that it was not consulted. " +
      "Every constant sits above the sentence that derives it, so the next tuning is a decision rather than a guess.",
    source: S.SRC_MEASURED,
    inAscent: null,
    deviation:
      "Ascent measures no frame cost anywhere and branches on no declared signal either (`hardwareConcurrency` / `userAgent` / `deviceMemory`: 0 hits): under the brand's 'no always-on loops' rule there is no effect with a cost knob to feed, so the whole subject is absent rather than wrong. The scene's samples are a seeded trace, not this page's rAF intervals — the arithmetic is real, the frames are fiction.",
  },
  {
    slug: "asymmetric-tier-transitions",
    title: "Asymmetric tier transitions",
    mechanism:
      "`closeWindow()` in probe.ts is the whole rule: a bad window steps the tier down at once, a catastrophic one (≥ 3× the budget) goes straight to the floor, and a good window increments a counter that promotes one rung only at `UPGRADE_RUN = 3`. " +
      "A neutral window — a p90 inside the 13 ms dead band — is neither, and it zeroes the counter: the counter has one increment path and every other outcome resets it. " +
      "The fixture makes the feedback loop real: each tier adds its own cost to the next window's samples, and the band is wider than that step, so the loop cannot close. " +
      "The four window buttons close a window of a chosen kind; play good-neutral-good-neutral and watch the run never reach three. " +
      "A tier change is a parameter change: the strata field above re-reads its row and nothing remounts.",
    source: S.SRC_ASYMMETRIC,
    inAscent: null,
    deviation:
      "No adaptive ladder exists in Ascent. The nearest shape is `useFleetData.ts`'s poll backoff — failures accumulate a penalty and one success clears it — which is the mirror image of this rule (slow to condemn, quick to forgive), because a fetch and a frame have opposite cost asymmetries.",
  },
  {
    slug: "measurement-settle-budget",
    title: "Measurement settle budget",
    mechanism:
      "The reducer stops sampling on `STABLE_WINDOWS = 3` unchanged windows (the ordinary exit) or, unconditionally, when the fixture's elapsed time from the first sample passes `SETTLE_MS`; at the deadline an unsettled tier resolves to the lowest of the tiers it flapped between. " +
      "The stop is a teardown: `useProbe` derives `active` from the phase, so the interval that walks the trace is cleared by its own effect cleanup and no wake-up survives — the 'per-frame wake-up' readout says which. " +
      "Re-arming is event-shaped: two buttons name the events (a return from a long absence, a heavier view), each starts a fresh budget with its own deadline, and `REARM_CAP` stops re-probing a device that keeps giving the same answer. " +
      "Nothing polls.",
    source: S.SRC_SETTLE,
    inAscent: {
      file: "src/components/launch/useFleetData.ts",
      note: "The visibility re-pull is gated on absence length (`Date.now() - lastStartedAt < POLL_INTERVAL_MS` → skip), so a return to the foreground re-measures only when the situation plausibly changed — the event-shaped re-arm, with 'a re-arm on every tab switch is a poll with extra steps' written in its comment.",
    },
    deviation:
      "That hook is a poll with an event-shaped supplement, not a settled probe: the 90 s interval never stops for the session and there is no stability exit, because fleet data genuinely changes — the technique's own counter-case, chosen deliberately but not stated as a budget.",
  },
  {
    slug: "probe-deferral-to-idle",
    title: "Probe deferral to idle",
    mechanism:
      "A scheduled probe starts `unmeasured` with both handles armed — an idle request and a timeout — and `fire(winner)` moves to sampling while the region reports the loser as cancelled by the winner. " +
      "Unmeasured is a state, not a tier: `tierSource` distinguishes 'declared default' from 'measured', so a probe that never ran cannot be mistaken for a device that measured fast. " +
      "The declared default is `reduced`, with its reason in the constant's comment: load-visible effects mount there and step up when the first window lands, so the common transition on a fast device is richness arriving. " +
      "Press reload and watch the header: three good windows later the strata field gains lines; nothing is ever taken away during load.",
    source: S.SRC_DEFERRAL,
    inAscent: {
      file: "src/components/ui/Defer.tsx",
      note: "`strategy=\"idle\"` requests `requestIdleCallback` with `DEFER_IDLE_TIMEOUT_MS = 500` as the timeout, cancels the handle in the effect cleanup, and the policy comment names the reason — do not compete with the first paint.",
    },
    deviation:
      "Where `requestIdleCallback` is absent (Safari), `Defer` falls back to `setTimeout(…, 0)` — the next macrotask, not the 500 ms deadline — so the deferral is effectively immediate there; and it defers a mount, not a measurement, so there is no unmeasured state to distinguish from a fast verdict.",
  },
  {
    slug: "per-tier-budget-tables",
    title: "Per-tier budget tables",
    mechanism:
      "`TIERS` in budgets.ts is the one vocabulary; `STRATA` and `WASH` are each effect's own table, typed `Record<Tier, …>` so a fourth rung breaks both at once, with rows that are parameters (lines, drift period, layer count) plus one permitted sub-part boolean (the glow pass) and a floor row that is a reduction the author chose. " +
      "The strata field allocates all twelve lines once at module scope from the top row and draws `ALL_LINES.slice(0, row.lines)`: a downgrade frees nothing, an upgrade allocates nothing, the transition is a bounds change. " +
      "The row is read in the render body, not captured in state, so a transition is seen. " +
      "Each table names its load-bearing row, and the obligation ledger grades which effects owe a table by cost class. " +
      "The drift is an unprompted loop, so its pause control sits in the same region and it starts paused under `reduced`.",
    source: S.SRC_BUDGET,
    inAscent: null,
    deviation:
      "Ascent has no tier vocabulary and no table: every effect constant is single-valued (`LOOP_RUN_MS = 2400` in aboutOrgLoopMotion.ts, `DRIFT_MS = 900` in observatoryMotion.ts, the `.stagger-children` cap in globals.css) — a row of identical values at every rung, which is the technique's definition of not adaptive at all.",
  },
  {
    slug: "preference-short-circuits-measurement",
    title: "Preference short-circuits measurement",
    mechanism:
      "`initialProbe()` returns `short-circuited` before anything is scheduled when the frame's `reduced` prop is set or the product's quality control is not `auto`: no idle request, no timer, no buffer, no windows — the ledger in the region lists what exists. " +
      "The branch is in the function that creates the probe, not inside the sampler, so a reader sees from the shape of the code that the machinery does not exist rather than that it returns early. " +
      "`useProbe` keys the probe on `preference:reducedMotion` and re-creates it during render when the key moves: a preference turning on is a genuine teardown, a preference turning off is a fresh budget, never a resumption of stale samples. " +
      "The OS preference outranks the product control (the chips disable), and `auto` is the way back to the measured default.",
    source: S.SRC_PREFERENCE,
    inAscent: {
      file: "src/components/ui/Defer.tsx",
      note: "`mountsImmediately()` is evaluated first and the effect's opening line is `if (now || ready) return;`, so under a reduced-motion preference no idle request and no timer are ever created — the branch decides whether the machinery exists, and `[now]` in the deps tears it down when the preference flips on.",
    },
    deviation:
      "Three readers of the same preference coexist (`useReducedMotion`, `usePrefersReducedMotion`, raw `matchMedia` in useLiveWarRoomStat.ts / observatoryMotion.ts), and Ascent offers no product quality control, so there is no stored choice and no way back to an automatic default to get right or wrong.",
  },
];
