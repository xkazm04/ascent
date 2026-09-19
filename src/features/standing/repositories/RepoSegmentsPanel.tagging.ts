"use client";

// The repo↔segment tagging toggle, extracted from useRepoSegmentsPanel.ts (pure relocation) so every
// file stays under the 200-LOC cap (AGENTS.md). Owns no JSX and no state of its own — it is handed the
// panel's state + setters and returns the handler, exactly as it behaved inline. Kept whole because
// its optimistic-flip / rollback reasoning is load-bearing.

import type { Dispatch, SetStateAction } from "react";
import type { SegmentItem } from "./RepoSegmentsPanel";

export function createToggleTag({
  slug,
  membership,
  setMembership,
  setSegments,
  setError,
}: {
  slug: string;
  membership: Record<string, string[]>;
  setMembership: Dispatch<SetStateAction<Record<string, string[]>>>;
  setSegments: Dispatch<SetStateAction<SegmentItem[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  return async function toggle(fullName: string, segId: string) {
    const current = membership[fullName] ?? [];
    const member = !current.includes(segId);
    // Optimistic: flip the chip + adjust the segment's repo count. Derive the actual flip from the
    // functional updater's `prev` and only adjust the count when membership genuinely changed —
    // otherwise two fast clicks both read stale closure state, both see member=true, and each bumps
    // repoCount (+2) while the Set holds the id once, leaving the count permanently off by one.
    let flipped = false;
    setMembership((m) => {
      const ids = new Set(m[fullName] ?? []);
      flipped = member ? !ids.has(segId) : ids.has(segId);
      if (member) ids.add(segId);
      else ids.delete(segId);
      return { ...m, [fullName]: [...ids] };
    });
    if (flipped) {
      setSegments((s) => s.map((x) => (x.id === segId ? { ...x, repoCount: Math.max(0, x.repoCount + (member ? 1 : -1)) } : x)));
    }
    setError(null);
    // Was fire-and-forget (.catch(()=>{})), so a 404/permission/network failure left the chip + repo-
    // count showing a membership that doesn't exist server-side (and fed the Overview filter). Inspect
    // the result and UNDO exactly this toggle (functional updaters, so a concurrent toggle of another
    // repo isn't clobbered) when it didn't persist.
    const res = await fetch(`/api/org/segments/${segId}/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: slug, fullName, member }),
    }).catch(() => null);
    if (!res || !res.ok) {
      // Only undo the parts we actually applied: if the optimistic flip was a no-op (a duplicate
      // in-flight click), reverting membership/count here would over-correct.
      if (flipped) {
        setMembership((m) => {
          const ids = new Set(m[fullName] ?? []);
          if (member) ids.delete(segId);
          else ids.add(segId);
          return { ...m, [fullName]: [...ids] };
        });
        setSegments((s) => s.map((x) => (x.id === segId ? { ...x, repoCount: Math.max(0, x.repoCount + (member ? -1 : 1)) } : x)));
      }
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't update the tag.");
    }
  };
}
