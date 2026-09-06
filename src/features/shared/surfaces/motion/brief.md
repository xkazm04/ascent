# Mechanism brief — `motion`

- **Subject:** `software-engineering / ui-surfaces / feedback-and-style / motion` (status `forged`)
- **Digest authored against:** `sha256:89022fde06571042` · verified 2026-09-06
- **Read:** `motion.md` (golden path), all ten techniques, and the four applications
  (`react--preset-vocabulary`, `react--performance-discipline`, `react--reduced-motion-mechanics`,
  `node--content-bearing-degradation`).
- **Scene:** one composed "instrument panel" (`Scene.tsx`), every technique a region carrying
  `data-technique="<slug>"`. The vocabulary (`presets.ts`) is the spine: every region plays a named
  preset or reads a budget from it. `reduced` and `volume` come from props; nothing in the scene
  runs its own media query. framer-motion is used in `EnginePanel.tsx` only.
- **Fixtures:** `fixtures.ts`, seeded (mulberry32). `volume` sizes the one-shot panel's identity set.

## Per technique

| Technique | `use_when` matched | Mechanism shown | Region | Ascent evidence | Deviation |
| --- | --- | --- | --- | --- | --- |
| gesture-decomposition | "a gesture needs several properties moving on different curves" | one selected-card gesture as three independent CSS transition tracks (fast/base/deliberate × move/enter); event-driven axis; the track table is the preset proposal | `GesturePanel.tsx` | `src/components/about/motionReveal.ts` (`gatedReveal` separates initial/final/transition per element) | decomposition is per element, not per property |
| preset-vocabulary | "a preset inlines its own milliseconds" | `PRESETS` declared once: intent + reduced form per gesture, duration class + easing role per track, physics + settle bound for the spring; `animationFor()` resolves a name to an `animation` shorthand; replay by `key` remount | `PresetPanel.tsx` → `PresetRegion` | `src/app/globals.css` `ascent-*` keyframes + utilities | no `--duration-*` / easing-role tokens; literals per keyframe utility |
| engine-selection | "choosing the engine for each gesture", "deciding whether a gesture can be interrupted mid-flight" | CSS keyframe (platform-owned, MotionConfig-blind) vs framer spring (retarget mid-flight; `MotionConfig reducedMotion="always"` is the switch) vs input-driven scrub (the user is the clock; reduced → opacity) | `EnginePanel.tsx` | `src/components/deck/Reveal.tsx` (framer dropped for CSS on the public deck after the SSR blank; `Reveal.test.tsx`) | engines mixed with no inventory of which switch governs which |
| performance-discipline | "a component re-renders at frame rate during animation" | one rAF clock drives two needles via refs; render counter stays still; frame count via `textContent`; dt clamped 64ms; reduced → end state, no loop | `PerfPanel.tsx` | `src/components/about-org/aboutOrgLoopMotion.ts` (one playhead, many lanes via `segment()`) | the playhead's progress goes through `setP` per frame |
| taste-budgets | "each addition looks better yet the whole never rests" | `BUDGET` constants beside the presets; slider past the entrance cap turns the meter `bg-danger`; ambient bound displayed and enforced in the breathe keyframes | `PresetPanel.tsx` → `BudgetRegion` | `src/app/globals.css` `.stagger-children` count cap (280ms) | caps are file-local literals, not budget constants |
| one-shot-guarding | "entrance animation replays on poll or tab return" | `useSeenSet(scope)`: identity-keyed, surface-scoped, consulted during render; poll re-delivers → no replay; new identity enters alone; context change is the one reset | `OneShotPanel.tsx` | `src/components/org/shell/OrgTabChunks.tsx` (`key={tab}` — once per tab switch) | `.stagger-children` couples to mount; `Reveal` / `useReplayOnView` replay by design |
| reduced-motion-mechanics | "designing the reduced fallback for a motion preset", "an exit animation never unmounts" | reduction resolves in `animationFor()` (fade / settle / still; timing-load-bearing exempt); epsilon 1ms so `onAnimationEnd` unmount still fires — counter proves it; the frame's single resolver threads `reduced` | `ReducedPanel.tsx` → `ReducedRegion` | `src/components/ui/useReducedMotion.ts` (framer-free live subscriber) | three readers; CSS `animation: none` is exact zero |
| content-bearing-degradation | "a surface renders blank under reduced motion", "a label still says live while its loop is stopped" | count-up + typed headline initialised to the end state under `reduced`, loop never starts; liveness label from `loopRan`; replay takes the instant path; seeded figure | `ReducedPanel.tsx` → `ContentRegion` | `src/components/about-org/aboutOrgLoopMotion.ts` (rests at `p = 1` for SSR and reduced) | liveness copy not derived from loop state |
| unprompted-motion-lifecycle | "adding an autoplay carousel or attract loop", "deciding whether a surface owes a visible pause control" | auto-advancing strip; > 5s → visible stop; stop one-directional, resume separate and restarts the interval; picking a step is a stop; cadence from elapsed time | `LoopPanel.tsx` → first region | `src/components/ui/Defer.tsx` (the one written-down machine-owned lifecycle) | `.live-dot` / `animate-pulse` loops have no stop and no separated user-stop |
| loop-pause-governance | "several conditions independently want to suspend the same loop", "a tap-to-pause never resumes on a touch device" | `usePauseAuthorities`: closed decider list, disjunction of vetoes, in-view abstains without an observer, timed hover pause, banked remainder in `useElapsedStep` | `LoopPanel.tsx` → second region | none | no merged signal anywhere; each surface reads its own inputs |

## Gates run

`npx tsc --noEmit` · `npx vitest run src/features/shared/surfaces src/lib/org` · LOC check
(≤200 under `src/features/**`) · `Scene.dom.test.tsx` (jsdom: mounts in `MotionScope`, every slug has a
region, reduced end state + honest label, one-shot on poll, stop/resume, budget overrun).
