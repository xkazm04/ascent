"use client";

// The two controls only a SIGNED-IN theater carries: arming the runner notifier, and minting a kiosk
// link that renders this same theater on an unauthenticated screen. Neither exists on the kiosk (its
// viewer can do nothing with them) or in the demo (there is no runner to be told about).
//
// The notify control IS the notifier on this page: `useRunnerNotifier` polls needs-you once armed, so a
// theater left open on a third monitor notifies without an org tab open beside it. Arming is always a
// click — `Notification.requestPermission()` runs inside it, never on load.

import { useState } from "react";
import { chipButtonClass } from "@/components/ui";
import { useRunnerNotifier } from "@/components/org/shared/useRunnerNotifier";
import { requestRunnerNotify, setRunnerNotifyWanted } from "@/lib/org/runner-notify";
import { useTvShareLink } from "../useTvShareLink";

export function TheaterOrgControls({ slug }: { slug: string }) {
  const { armed } = useRunnerNotifier(slug, { offer: false });
  const [blocked, setBlocked] = useState<string | null>(null);
  const { share, shareTvLink } = useTvShareLink(slug, "theater");

  async function toggleNotify() {
    if (armed) {
      setRunnerNotifyWanted(slug, false);
      return;
    }
    const permission = await requestRunnerNotify(slug);
    setBlocked(
      permission === "denied"
        ? "Notifications are blocked for this site in your browser settings."
        : permission === "unsupported"
          ? "This browser cannot show notifications."
          : null,
    );
  }

  return (
    <>
      <button type="button" onClick={() => void toggleNotify()} aria-pressed={armed} className={chipButtonClass(armed ? "success" : "idle")}>
        {armed ? "Notifications on" : "Notify me when the runner needs me"}
      </button>
      {blocked ? <span className="type-caption text-amber-300">{blocked}</span> : null}
      <button type="button" onClick={() => void shareTvLink()} disabled={share.busy} className={chipButtonClass(share.error ? "danger" : share.copied ? "success" : "idle", "disabled:opacity-50")}>
        {share.busy ? "Minting…" : share.copied ? "Kiosk link copied" : "Share to a kiosk"}
      </button>
      {share.error ? <span className="type-caption text-danger">{share.error}</span> : null}
      {share.manualUrl ? (
        <input readOnly value={share.manualUrl} aria-label="Kiosk link" onFocus={(e) => e.currentTarget.select()} className="w-64 rounded border border-divider bg-surface px-2 py-1 font-mono type-caption text-slate-300" />
      ) : null}
    </>
  );
}
