"use client";

// "What moved since you last looked" — the unread half of the org Alerts chip.
//
// The chip was a static config popover with no count: a lead returning to the dashboard saw current
// numbers with no marker of movement since their last visit. This adds the marker, reading records the
// scan pipeline already persists (GET /api/org/alerts?movement=1 → Shared Org Memory since the
// viewer's Membership watermark) and stamping the watermark when they look (POST { seen: true }).
//
// Everything degrades to the old chip: `movement: null` (auth-off, public org, no membership, any read
// failure) renders no badge and no section, exactly as before.

import { useCallback, useEffect, useState } from "react";

export interface MovementItem {
  repo: string | null;
  event: string;
  summary: string;
  at: string;
}

export interface Movement {
  since: string;
  firstLook: boolean;
  count: number;
  capped: boolean;
  items: MovementItem[];
}

/** Badge text for a movement count: saturates at the query cap, so >9 reads "9+". Pure. */
export function movementBadgeLabel(count: number, capped: boolean): string {
  return capped ? `${count}+` : String(count);
}

/** Human label for a scan-pipeline event tag; an unknown/unparsable tag falls back to "moved". */
export function movementEventLabel(event: string): string {
  if (event === "regression") return "regressed";
  if (event === "level-change") return "level change";
  if (event === "recommendation-closed") return "gap closed";
  return "moved";
}

/** Compact "3d ago" / "4h ago" / "just now" for the movement list. Pure; `now` is injectable. */
export function movementAgo(at: string, now: number = Date.now()): string {
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Load this viewer's movement once on mount (the chip renders its count without being opened) and
 * expose a `markSeen` the control calls when the popover opens. `badgeCount` drops to 0 the moment the
 * user looks — the list stays rendered while the popover is open, because clearing what they came to
 * read would be the opposite of useful.
 */
export function useOrgMovement(org: string) {
  const [movement, setMovement] = useState<Movement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/org/alerts?org=${encodeURIComponent(org)}&movement=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { movement?: Movement | null } | null) => {
        if (!cancelled && d?.movement) setMovement(d.movement);
      })
      .catch(() => {
        /* a chip decoration never surfaces its own failure — degrade to the countless chip */
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  const markSeen = useCallback(() => {
    if (seen || !movement || movement.count === 0) return;
    setSeen(true); // optimistic: the badge clears immediately; the stamp is best-effort
    fetch("/api/org/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org, seen: true }),
    }).catch(() => {});
  }, [org, seen, movement]);

  return { movement, badgeCount: seen ? 0 : (movement?.count ?? 0), markSeen };
}

/** The unread count on the bell chip. Hidden at zero (nothing moved = no marker at all). */
export function MovementBadge({ count, capped }: { count: number; capped: boolean }) {
  if (count <= 0) return null;
  const label = movementBadgeLabel(count, capped);
  return (
    <span
      className="ml-0.5 rounded-full bg-accent px-1.5 py-px font-mono text-xs tabular-nums text-on-accent"
      title={`${label} change${count === 1 && !capped ? "" : "s"} since you last looked`}
    >
      {label}
      <span className="sr-only"> changes since you last looked</span>
    </span>
  );
}

/**
 * The "since you last looked" list, above the config section. Compact by design — it answers "what
 * moved, when", and the report/memory surfaces own the detail.
 */
export function MovementSince({ movement }: { movement: Movement | null }) {
  if (!movement) return null;
  return (
    <div className="mb-3 border-b border-divider pb-3">
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">
        {movement.firstLook ? "Since you joined" : "Since you last looked"}
      </div>
      {movement.count === 0 ? (
        <p className="mt-1.5 font-mono text-sm text-slate-500">Nothing moved — you&apos;re up to date.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {movement.items.map((it, i) => (
            <li key={`${it.at}-${i}`} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 text-slate-300">
                <span className="font-mono text-slate-200">{it.repo ?? "org"}</span>{" "}
                <span className="text-slate-500">{movementEventLabel(it.event)}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">{movementAgo(it.at)}</span>
            </li>
          ))}
          {movement.capped && (
            <li className="font-mono text-xs tabular-nums text-slate-500">+ more since {movement.since.slice(0, 10)}</li>
          )}
        </ul>
      )}
    </div>
  );
}
