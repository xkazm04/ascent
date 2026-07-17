import { describe, expect, it } from "vitest";
import { buildChecklistSteps } from "./OnboardingFlow.model";

// ambiguity-ui-scan-2026-07-16 first-run-onboarding-wizard #2: the done-screen checklist marked
// "Set a watch schedule" done whenever the scan finished — but the weekly watch is only enrolled on
// the App path (importScan: `watch = Boolean(installationId)`); the public-handle preview funnel
// deliberately sends watch:false. The checklist must mirror that predicate, not lie on the
// top-of-funnel path (users skipped the real /connect step because the wizard said it was done).

function steps(over: Partial<Parameters<typeof buildChecklistSteps>[0]> = {}) {
  return buildChecklistSteps({
    hasInstallation: false,
    selected: new Set<string>(),
    phase: "done",
    sourceInstallId: null,
    invitedCount: 0,
    sourceLabel: "acme",
    ...over,
  });
}

const watchStep = (list: ReturnType<typeof buildChecklistSteps>) =>
  list.find((s) => s.label === "Set a watch schedule")!;

describe("buildChecklistSteps — watch-schedule honesty", () => {
  it("does NOT tick the watch step on the public-handle preview funnel (no watch was created)", () => {
    const step = watchStep(steps({ sourceInstallId: null }));
    expect(step.done).toBe(false);
    // The real next action stays signposted.
    expect(step.href).toBe("/connect");
  });

  it("ticks the watch step on the App path, where the import auto-watches (watch:true)", () => {
    expect(watchStep(steps({ sourceInstallId: "123" })).done).toBe(true);
  });

  it("never ticks the watch step before the scan is done, on either path", () => {
    expect(watchStep(steps({ phase: "scanning", sourceInstallId: "123" })).done).toBe(false);
    expect(watchStep(steps({ phase: "select", sourceInstallId: null })).done).toBe(false);
  });

  it("keeps 'Run your first scan' keyed on scan completion alone (unchanged)", () => {
    const scanStep = steps({ sourceInstallId: null }).find((s) => s.label === "Run your first scan")!;
    expect(scanStep.done).toBe(true);
  });
});
