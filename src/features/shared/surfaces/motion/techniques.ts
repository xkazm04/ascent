// The drawer entries for the motion scene: one per technique of the registry's `motion` subject
// (authored against sha256:89022fde06571042, 2026-09-06). `mechanism` explains the React/Tailwind/
// Motion mechanism the region demonstrates; `source` is the scene's own code; `inAscent` cites the
// real Ascent file that already realizes the technique; `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "gesture-decomposition",
    title: "Gesture decomposition",
    mechanism:
      "The selected-card gesture is three CSS transitions on three properties, each with its own duration class and easing role from presets.ts, composed in one `transition` shorthand. " +
      "The input axis is event-driven: a click flips React state, and the browser interpolates each track independently toward the new target. " +
      "Because the tracks are separate entries in the shorthand, one can be retuned without re-judging the others — the property-separation pattern. " +
      "The table beside the card is the preset proposal in the form the vocabulary accepts: intent, axis, tracks, timing per track, and a fallback. " +
      "Under `reduced`, the lift (travel) is removed and the other tracks settle instantly.",
    source: S.SRC_GESTURE,
    inAscent: {
      file: "src/components/about/motionReveal.ts",
      note: "`gatedReveal` separates initial / final / transition per element and single-sources the reduced branch; each diagram element is one track with its own transition.",
    },
    deviation: "Ascent decomposes per element, not per property: a card that lifts, recolours and discloses still fuses those into one `transition` at every call site.",
  },
  {
    slug: "preset-vocabulary",
    title: "Preset vocabulary",
    mechanism:
      "presets.ts is the one home: every gesture is a named `Preset` with an intent, a motion class, a keyframe name, tracks, and a reduced form, and `animationFor()` turns a name into an inline `animation` shorthand. " +
      "A timed track names a duration class and an easing role; the physics track names stiffness, damping and a settle bound instead of a duration, because a spring has none. " +
      "The chips replay a preset by remounting the sample element with a new React `key`, so the keyframes run from their first frame again without touching state per frame. " +
      "The keyframes themselves live in one `<style>` the scene mounts, scoped to it. " +
      "Nothing inlines a millisecond: the ladder is `DURATION_MS`, the roles are `EASING`.",
    source: S.SRC_PRESET,
    inAscent: {
      file: "src/app/globals.css",
      note: "The `ascent-*` keyframes and `.animate-fade-up` / `.animate-fade-in` / `.stagger-children` utilities are a shared vocabulary of entrances, each gated once under `prefers-reduced-motion`.",
    },
    deviation:
      "No duration ladder or easing-role tokens exist: globals.css carries literals (`0.5s ease-out`, `360ms cubic-bezier(0.16, 1, 0.3, 1)`, `0.28s`) per keyframe utility, and framer sites re-inline their own numbers.",
  },
  {
    slug: "engine-selection",
    title: "Engine selection",
    mechanism:
      "Three columns run the same move on three engines. The CSS column is an inline `animation` from the preset: platform-owned, off-thread, and invisible to `MotionConfig` — the preset's own reduced branch is what governs it. " +
      "The framer column is a `motion.span` with a spring transition; pressing retarget mid-flight shows a scripted engine bending from its current position and velocity, and the frame's `MotionConfig reducedMotion=\"always\"` is the global switch that snaps it. " +
      "The scrub column writes `style.transform` from a range input: the user is the clock, so there is no duration, no stop control and no one-shot. " +
      "Under reduction the scrub keeps its mapping but moves opacity instead of position — bounded travel is what a driven gesture owes.",
    source: S.SRC_ENGINE,
    inAscent: {
      file: "src/components/deck/Reveal.tsx",
      note: "Deliberately dependency-free CSS (`.js-reveal`) on the public deck after a framer `initial={{opacity:0}}` blanked the no-JS render — an engine chosen for ownership, pinned by Reveal.test.tsx.",
    },
    deviation:
      "Engines are mixed without an inventory: framer-motion (about decks, report charts), raw rAF loops (aboutOrgLoopMotion, observatoryMotion) and CSS utilities coexist, and no file states which switch governs which.",
  },
  {
    slug: "performance-discipline",
    title: "Performance discipline",
    mechanism:
      "One `requestAnimationFrame` loop advances two needles by writing `transform` through refs; the render counter — a ref incremented in a post-commit effect and written into a span — moves only when the sweep starts and settles. " +
      "The frame counter is written into a span's `textContent` from the loop, never into state, so sixty writes a second cost zero reconciliation. " +
      "The per-tick delta is clamped to 64ms centrally, so a backgrounded tab cannot resume with a seconds-long step. " +
      "Only compositor-friendly properties are touched (`scaleX`, `translateX`). " +
      "Under `reduced` no loop is scheduled: the needles are placed at their end state and the state goes straight to settled.",
    source: S.SRC_PERF,
    inAscent: {
      file: "src/components/about-org/aboutOrgLoopMotion.ts",
      note: "`useLoopPlayhead` runs one rAF playhead that several lanes read via `segment()` — one clock, not one timer per lane — with a bounded run (`LOOP_RUN_MS`).",
    },
    deviation: "The playhead routes its 0→1 progress through `setP` state every frame, so every consumer re-renders at frame rate; frame writes do not bypass React there.",
  },
  {
    slug: "taste-budgets",
    title: "Taste budgets",
    mechanism:
      "`BUDGET` in presets.ts fixes the entrance cap, the stagger step, the stagger-count cap and the ambient travel bound as named constants beside the presets. " +
      "Two range inputs drive `entranceTotalMs()`, which adds accumulated stagger (count-capped) to the per-item duration; the meter's width is the ratio to the cap and its fill flips to `bg-danger` past it. " +
      "The readout says what the overrun means: not a new preset, a proposal to change the cap. " +
      "The ambient bound is displayed, and the ambient preset's keyframes translate exactly `BUDGET.ambientTravelPx`, so the bound is enforced where the gesture is defined.",
    source: S.SRC_BUDGET,
    inAscent: {
      file: "src/app/globals.css",
      note: "`.stagger-children` caps accumulated delay at the sixth child (280ms) and the brand rule is 'motion is a beat, gated' — a count cap and an honesty rule, in CSS and prose.",
    },
    deviation: "The caps are not constants anywhere: the 280ms cutoff and `LOOP_RUN_MS = 2400` are per-file literals, so a preset can exceed an entrance budget without editing a budget.",
  },
  {
    slug: "one-shot-guarding",
    title: "One-shot guarding",
    mechanism:
      "`useSeenSet(scope)` keeps a surface-scoped `Set` of identities in state, consulted synchronously during render (`enters(id)`) so each row's very first frame is decided — enter animated, or appear settled — and written by the entrance itself — one delegated `animationend` listener on the list marks the identity whose entrance just finished (the reduced 1ms epsilon fires it too). " +
      "The poll button re-delivers the same `row-<n>` identities with drifted values: none re-enter. Every second poll inserts one new identity, which enters alone. " +
      "The scope key (`ctx-<n>-<volume>`) is the ONE reset: a context change empties the set inside the hook; no call site decides. " +
      "Keys are system-of-record ids from fixtures.ts, never positions, so a resort cannot replay whoever moved into a slot.",
    source: S.SRC_ONESHOT,
    inAscent: {
      file: "src/components/org/shell/OrgTabChunks.tsx",
      note: "The panel is keyed on the tab id so the entrance replays exactly once per tab switch and never on a searchParams change within a tab.",
    },
    deviation:
      "Rows have no identity-keyed guard: `.stagger-children` is coupled to mount, so a poll or refetch that remounts a list replays the cascade; `Reveal` and `useReplayOnView` replay on every scroll-back by design (`once:false`).",
  },
  {
    slug: "reduced-motion-mechanics",
    title: "Reduced-motion mechanics",
    mechanism:
      "Reduction resolves inside `animationFor()`: a `fade` preset swaps to `surface-fade`, a `settle` or `still` preset collapses to a 1ms epsilon, and a `timingLoadBearing` preset keeps its duration untouched. " +
      "Call sites pass `reduced` and never branch on it — the table is the audit: every preset, its full form, its reduced form. " +
      "The exit chip proves the epsilon rule: it unmounts in `onAnimationEnd`, and the completed-exits counter climbs in both modes because a 1ms animation still fires the event where a 0ms one may not. " +
      "The frame resolves the preference once (`useReducedMotion` OR the simulate toggle) and threads it as a prop, so the scene has one resolver and no media query of its own.",
    source: S.SRC_REDUCED,
    inAscent: {
      file: "src/components/ui/useReducedMotion.ts",
      note: "A framer-free live subscriber to the media query, starting `false` for SSR agreement; globals.css says 'never add a prefers-reduced-motion check at a call site'.",
    },
    deviation:
      "Three readers coexist — `useReducedMotion` (ui), `usePrefersReducedMotion` (report/chartMotion.ts, useSyncExternalStore) and a raw `matchMedia` in aboutOrgLoopMotion.ts — and the CSS reduction is `animation: none`, exact zero, so any `animationend` a caller awaited never fires.",
  },
  {
    slug: "content-bearing-degradation",
    title: "Content-bearing degradation",
    mechanism:
      "The figure and the headline are the payload, so their initial state under `reduced` is the resolved end state — `useState(reduced ? HEADLINE_FIGURE : 0)` — and the effect returns before scheduling any loop. " +
      "With motion on, one rAF loop counts the figure up and types the headline; `loopRan` records whether the loop actually started. " +
      "The liveness label derives from `loopRan` and completion, not from the preference: 'static value' when the loop never ran, 'counting…' while it runs, 'counted' at rest — every repetition would read the same source. " +
      "Replay under reduction takes the instant path, because it must not start the very motion the reader opted out of. " +
      "The figure comes from a seeded fixture, so a screenshot is reproducible.",
    source: S.SRC_CONTENT,
    inAscent: {
      file: "src/components/about-org/aboutOrgLoopMotion.ts",
      note: "The playhead rests at `p = 1` (the finished run) for the server render and under reduced motion, so a no-JS reader or a reduced-motion reader sees the completed diagram, never its 'before' frame.",
    },
    deviation: "Liveness copy is not derived from loop state: the observatory and live-theater surfaces label themselves without a `loopRan`-style source, so a degraded loop can keep a 'live' label.",
  },
  {
    slug: "unprompted-motion-lifecycle",
    title: "Unprompted motion lifecycle",
    mechanism:
      "The strip auto-advances from `useElapsedStep`, which derives the current step from wall-clock time since start minus banked pause time — two mounts compute the same step, a resumed loop lands where the clock says. " +
      "It runs past five seconds, so a visible stop button is rendered; `stop` is one-directional (disabled once set) and `resume` is a separate labelled act that restarts the interval from the beginning. " +
      "Clicking a step is a deliberate interaction and calls `stop()` itself: taking control is a stop. " +
      "The breathing highlight uses the ambient preset in loop mode, which reduces to stillness because an infinite opacity or transform loop is a flashing element, not a gentle fade.",
    source: S.SRC_LIFECYCLE,
    inAscent: {
      file: "src/components/ui/Defer.tsx",
      note: "The one place a machine-owned reveal lifecycle is written down: timed strategies collapse to a plain mount under reduced motion, and `visible` fails open when no observer exists.",
    },
    deviation: "Ascent's brand rule is 'no always-on loops', so no surface has needed a stop control — but the `.live-dot` and `animate-pulse` loops that do exist have no visible stop and no separated user-stop state.",
  },
  {
    slug: "loop-pause-governance",
    title: "Loop pause governance",
    mechanism:
      "`usePauseAuthorities` enumerates the deciders in one place — reduced, in-view, foregrounded, user-stop, hover (timed) — and merges them as a disjunction of vetoes; the loop reads `paused` and nothing else. " +
      "In-view comes from one IntersectionObserver and abstains where the API is absent (the partial-merge fallback), foregrounded from `visibilitychange`; the user stop is state only `resume()` clears. " +
      "The hover pause is armed with an expiry (`Date.now() + hoverPauseMs`) and a timeout re-renders when it lapses, so a touch tap that fires pointerenter and never pointerleave lifts on its own instead of wedging the loop. " +
      "`useElapsedStep` banks the remainder across machine pauses and restarts on a user resume, so the cycle continues at its designed pace rather than resetting on every hover.",
    source: S.SRC_GOVERNANCE,
    inAscent: null,
    deviation:
      "No merged pause signal exists: each animated surface reads the preference, visibility or an observer on its own (`Defer`, `Reveal`, `useLoopPlayhead`, the report charts), so a new decider is a sweep, not one edit.",
  },
];
