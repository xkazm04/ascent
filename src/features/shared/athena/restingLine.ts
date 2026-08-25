// HER RESTING STATE — what Athena says before anyone has said anything to her.
//
// The rule the absorb turns on: THE CHECKLIST STAYS THE SOURCE OF TRUTH. `buildGettingStartedModel`
// derives what is done from the org's real data, and this module does not re-derive one bit of it. It
// is handed the one step the checklist already promoted and puts it in her voice. Athena is the
// checklist's VOICE, not a second opinion about what is left to do — two surfaces disagreeing about
// whether the first scan has run is worse than either of them alone.
//
// WHY IT NEVER ASSERTS COMPLETION. `next === null` has three causes that are indistinguishable here:
// the payload has not loaded, every available step is done, or this workspace derives no steps at all.
// So the fallback line claims nothing about setup and simply offers what she can do. A companion that
// says "setup is done" while the checklist is still loading has lied on her first line.
//
// Pure. No React, no fetch — the whole voice rule is unit-testable.

/** The promoted step, narrowed to what a sentence needs. Deliberately NOT `DrawerItem`: her voice does
 *  not need to know about tour anchors, and the narrow shape keeps this module free of tour internals. */
export interface AthenaNextStep {
  title: string;
  /** e.g. "Baseline". Shown as the mono eyebrow beside the link, not spoken. */
  phaseLabel?: string;
  href: string;
  cta: string;
}

const OPEN_OFFER = "Ask me about this org — the fleet, what's in its memory, or what moved since the last scan.";

/**
 * One or two sentences, leading with the answer, no heading and no sign-off — the same tone contract
 * the prompt holds her to, applied to the one line she writes without a model.
 */
export function restingLine(next: AthenaNextStep | null): string {
  if (!next) return OPEN_OFFER;
  return `The next thing waiting on you here is “${next.title}”. Ask me about it, or about anything else in this org.`;
}
