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
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // Escape closes AND returns focus to the trigger — the second half of the dismissal the ARIA
      // menu pattern promises (without it, focus is dropped on <body> for keyboard/SR users).
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // a11y (ambiguity-ui 2026-07-16 #4): the trigger declares aria-haspopup="menu" and the popup
  // role="menu"/"menuitemradio", which PROMISES the ARIA menu keyboard contract to AT users — focus
  // moves into the menu on open, ArrowUp/ArrowDown roam, Home/End jump, Escape restores the trigger.
  // The roles previously shipped without the behavioral half, which is worse than plain buttons:
  // AT users are told "menu" and then find the announced key bindings dead. On open, focus the
  // checked item (fallback: the first).
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [open]);

  /** Roving focus + Home/End for the open menu; Tab closes it (disclosure semantics) so the menu
   *  never stays visually open while focus has walked elsewhere on the page. */
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]!.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]!.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]!.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]!.focus();
    } else if (e.key === "Tab") {
      // Close and hand focus back to the trigger so the default Tab continues from a mounted node
      // (the items are about to unmount) instead of stranding focus on <body>.
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  async function choose(org: string) {
    setOpen(false);
    triggerRef.current?.focus(); // the focused menu item unmounts — return focus to the trigger
    setError(null); // clear any prior failure so a fresh attempt starts clean
    if (org.toLowerCase() === active.toLowerCase()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/org/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org }),
      });
      if (!res.ok) {
        // The switch was rejected (e.g. no longer a member) — surface a VISIBLE, announced error instead
        // of silently swallowing it. Previously the menu just closed and nothing changed: a dead click.
        setError(`Couldn't switch to ${labelFor(org)}. Please try again.`);
        return;
      }
      // On an org-scoped route, switch which org is being viewed; otherwise re-render the
      // current route so server components re-read the now-updated active-org cookie.
      if (pathname.startsWith("/org/")) router.push(`/org/${encodeURIComponent(org)}`);
      else router.refresh();
    } catch {
      // Network/parse failure — the cookie wasn't changed. Tell the user rather than swallow it.
      setError(`Couldn't switch to ${labelFor(org)}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) setError(null); // opening the menu clears a stale failure banner
          setOpen((o) => !o);
        }}
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
          ref={menuRef}
          role="menu"
          aria-label="Switch organization"
          onKeyDown={onMenuKeyDown}
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
                tabIndex={-1} // roving focus: arrows/Home/End move focus; Tab exits the menu
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
      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full z-40 mt-2 max-w-[16rem] rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 shadow-xl"
        >
          {error}
        </div>
      )}
    </div>
  );
}
