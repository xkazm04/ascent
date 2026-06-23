"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PUBLIC_ORG } from "@/lib/org-constants";

const labelFor = (org: string) => (org === PUBLIC_ORG ? "Public" : org);

/**
 * Header account/org switcher (GitHub/Vercel/Linear-style): lists the viewer's installations
 * plus "public" and persists the choice via /api/org/active. Switching on an org-scoped route
 * navigates to that org's dashboard; elsewhere it refreshes so the current view (e.g. /usage)
 * picks up the new default context.
 */
export function OrgSwitcher({ orgs, active }: { orgs: string[]; active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(org: string) {
    setOpen(false);
    if (org.toLowerCase() === active.toLowerCase()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/org/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org }),
      });
      if (!res.ok) return;
      // On an org-scoped route, switch which org is being viewed; otherwise re-render the
      // current route so server components re-read the now-updated active-org cookie.
      if (pathname.startsWith("/org/")) router.push(`/org/${encodeURIComponent(org)}`);
      else router.refresh();
    } catch {
      /* leave the menu closed; the cookie simply wasn't changed */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-60"
      >
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Org</span>
        <span className="max-w-[10rem] truncate normal-case tracking-normal">{labelFor(active)}</span>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 max-h-80 min-w-[12rem] overflow-y-auto rounded-lg border border-slate-700 bg-[#0b1120] py-1 shadow-xl shadow-black/40"
        >
          {orgs.map((org) => {
            const isActive = org.toLowerCase() === active.toLowerCase();
            return (
              <button
                key={org}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => choose(org)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base transition hover:bg-slate-800/70 ${
                  isActive ? "text-white" : "text-slate-300"
                }`}
              >
                <span className="truncate normal-case tracking-normal">{labelFor(org)}</span>
                {isActive && <span className="text-accent">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
