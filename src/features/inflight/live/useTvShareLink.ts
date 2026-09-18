// The TV share-link mint + copy flow for WarRoomHeader (LiveWarRoomHeader.tsx). Pulled out so the
// header's JSX file stays under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md) — owns no JSX.

import { useState } from "react";

export interface TvShareState {
  busy: boolean;
  copied: boolean;
  error: string | null;
  manualUrl: string | null;
}

/** `view` picks what the kiosk link renders: omitted = the wall (the request body is exactly what it
 *  always was), `"theater"` = the standing runner's theater (theater/, spark theater-upgrade). */
export function useTvShareLink(slug: string, view?: "theater") {
  const [share, setShare] = useState<TvShareState>({ busy: false, copied: false, error: null, manualUrl: null });

  async function shareTvLink() {
    setShare({ busy: true, copied: false, error: null, manualUrl: null });
    // Step 1 — mint the link. A failure here means there is no link to show.
    let url: string;
    try {
      const res = await fetch("/api/org/live-share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(view ? { org: slug, view } : { org: slug }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.path) throw new Error(d.error ?? "Couldn't create a share link.");
      url = `${window.location.origin}${d.path}`;
    } catch (e) {
      setShare({ busy: false, copied: false, error: e instanceof Error ? e.message : "Couldn't create a share link.", manualUrl: null });
      return;
    }
    // Step 2 — the link EXISTS server-side now; auto-copy is a convenience that fails on non-secure
    // contexts / denied permission / kiosk browsers. Don't conflate that with "couldn't create a
    // link": on copy failure keep the URL on screen for manual copy instead of discarding it with a
    // misleading "Share failed." (live-war-room #3)
    try {
      await navigator.clipboard.writeText(url);
      setShare({ busy: false, copied: true, error: null, manualUrl: null });
      setTimeout(() => setShare((s) => ({ ...s, copied: false })), 2500);
    } catch {
      setShare({ busy: false, copied: false, error: null, manualUrl: url });
    }
  }

  return { share, shareTvLink };
}
