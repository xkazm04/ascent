// Shared reduced-motion gating for the /about entrance animations. `MotionConfig reducedMotion="user"`
// only degrades transform/layout props — not pathLength / cx,cy / left / flexGrow / width — so each
// such animated element must manually jump to its final state under reduced motion. This single-sources
// the four-prop ternary (initial / animate / whileInView / transition) that the diagrams were otherwise
// re-coding element-by-element, where one missed branch silently animates for reduced-motion users.

import type { TargetAndTransition, Transition } from "framer-motion";

interface GatedRevealProps {
  initial: TargetAndTransition | false;
  animate?: TargetAndTransition;
  whileInView?: TargetAndTransition;
  transition: Transition;
}

/**
 * Returns the framer-motion props that play `final` as an in-view entrance from `initial` — unless the
 * user prefers reduced motion, in which case the element renders straight at its final state
 * (`reducedTo`, defaulting to `final`) with no transition. Spread onto a `motion.*` element; pass
 * `viewport` / `style` separately. `reducedTo` exists for keyframe entrances whose resting state is the
 * last keyframe rather than the whole array (e.g. a dot parked at the end of a path).
 */
export function gatedReveal(
  reduced: boolean | null,
  {
    initial,
    final,
    transition,
    reducedTo = final,
  }: { initial: TargetAndTransition; final: TargetAndTransition; transition: Transition; reducedTo?: TargetAndTransition },
): GatedRevealProps {
  return reduced
    ? { initial: false, animate: reducedTo, whileInView: undefined, transition: { duration: 0 } }
    : { initial, animate: undefined, whileInView: final, transition };
}
