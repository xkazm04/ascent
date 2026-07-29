"use client";

// Org dashboard plan-tier chip + switcher. Shows the current plan and, on a deployment where manual
// plan changes are enabled (ASCENT_ALLOW_PLAN_CHANGES), lets an owner move between Free/Pro/Team/
// Enterprise — the no-Polar demo path for the monetization loop (the real paid upgrade flows through
// billing checkout). Switching tier changes the monthly scan allowance the entitlement gate enforces,
// so the effect is visible on the next private scan + on /usage. Where changes are disabled it renders
// a read-only tier chip. POSTs /api/org/plan, then refreshes so the new tier paints everywhere.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const PLANS: { id: string; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "pro", label: "Pro" },
  { id: "team", label: "Team" },
  { id: "enterprise", label: "Enterprise" },
];

export function PlanControl({ org, plan, enabled }: { org: string; plan: string; enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = PLANS.find((p) => p.id === plan)?.label ?? plan;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function change(next: string) {
    if (next === plan) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, plan: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Plan change failed.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Plan change failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <span
        className="inline-flex items-center rounded-md border border-slate-700 px-2.5 py-1.5 font-mono text-sm uppercase tracking-widest text-slate-400"
        title="Current plan"
      >
        {current}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        title="Change plan tier (demo)"
      >
        Plan · <span className="font-semibold uppercase tracking-widest">{current}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Plan tier" className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-2xl">
          <div className="font-mono text-sm uppercase tracking-widest text-accent">Switch plan</div>
          <p className="mt-1 text-xs text-slate-500">Demo override — paid upgrades normally go through checkout.</p>
          <div className="mt-2 flex flex-col gap-1">
            {PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.id === plan}
                disabled={busy}
                onClick={() => change(p.id)}
                className={`focus-ring flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                  p.id === plan ? "bg-accent/10 text-accent" : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                <span>{p.label}</span>
                {p.id === plan && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
