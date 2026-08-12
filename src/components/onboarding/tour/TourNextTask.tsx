"use client";

// The companion posture's promoted card: ONE next task, stated plainly, with the two things a member
// can do about it — go to the surface that hosts the work, or have the drawer point at the control.
//
// Promoting exactly one is the whole design. A member seeing their first dashboard is already reading
// an unfamiliar surface; a five-item list with five equal calls to action is a menu, not guidance. The
// rest of the list stays visible underneath as a thin rail so the shape of the flow is never hidden.

import Link from "next/link";
import type { DrawerItem } from "./tasks";
import { Kicker } from "@/components/ui";

export function TourNextTask({ item, href, onShowMe }: { item: DrawerItem; href: string; onShowMe: () => void }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/[0.06] px-3.5 py-3">
      <Kicker>Next · {item.phaseLabel}</Kicker>
      <h3 className="mt-1 text-sm font-semibold text-white">{item.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{item.body}</p>
      {item.detail && <p className="mt-1.5 font-mono text-xs leading-relaxed text-slate-500">{item.detail}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Link
          href={href}
          className="focus-ring rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
        >
          {item.cta}
        </Link>
        {item.tour.anchor && (
          <button
            type="button"
            onClick={onShowMe}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Show me
          </button>
        )}
      </div>
    </div>
  );
}
