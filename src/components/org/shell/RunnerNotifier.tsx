"use client";

// RUNNER NOTIFIER — an OS notification when the standing runner needs a person, mounted once in the
// org shell (and on the theater), so it rides every org page without any tab having to know about it.
//
// PERMISSION-FIRST. It does nothing for anyone who did not ask: no prompt on page load, no poll. The
// only way in is a click — this component's own quiet chip ("Notify me when the runner needs me"),
// shown only for an org that has a runner, or the same control on the theater. Once armed it polls
// `GET /api/org/loop/needs-you` every minute WITHOUT visibility gating (the hidden tab is the case it
// exists for), announces only what is new, and never more than once per `NOTIFY_BATCH_MS`: an
// operator is told "2 directions wait for your approval · kp paused: branch conflict" once, not
// pinged per item. Clicking the notification opens the Ledger. Mechanics: org/shared/useRunnerNotifier.ts.

import { useRunnerNotifier, type RunnerNotifierOptions } from "@/components/org/shared/useRunnerNotifier";

export function RunnerNotifier({ slug, ...opts }: { slug: string } & RunnerNotifierOptions) {
  const { offerVisible, enable, dismiss } = useRunnerNotifier(slug, opts);
  if (!offerVisible) return null;
  return (
    <div
      role="region"
      aria-label="Runner notifications"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-1 rounded-full border border-divider bg-surface-strong/90 py-1 pl-3 pr-1 shadow-lg backdrop-blur"
    >
      <button type="button" onClick={enable} className="focus-ring rounded-full px-1 type-body-sm text-slate-300 hover:text-white">
        Notify me when the runner needs me
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the notification offer"
        className="focus-ring rounded-full px-2 type-body-sm text-slate-500 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
