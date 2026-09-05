// Onboarding-skill generator — turns a ScanReport into a personalized, agent-runnable SKILL.md.
// Thin barrel so callers import from "@/lib/onboarding" regardless of internal file layout.

export { buildOnboardingSkill, type GeneratedSkill } from "./skill";
export {
  selectTracks,
  WEAK_THRESHOLD,
  type OnboardingTrack,
  type SelectOpts,
} from "./tracks";
