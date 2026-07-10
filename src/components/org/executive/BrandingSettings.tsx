"use client";

// EXEC-5: owner-only (Team plan and up) form to white-label the executive-briefing PDF — brand name,
// accent colour, logo URL. POSTs to /api/org/branding; values are validated server-side. Collapsed by default.

import { useState } from "react";
import type { OrgBranding } from "@/lib/db/branding";
import { HEX_COLOR_RE } from "@/lib/branding/color";

export function BrandingSettings({ slug, initial }: { slug: string; initial: OrgBranding }) {
  const [brandName, setBrandName] = useState(initial.brandName ?? "");
  const [brandColor, setBrandColor] = useState(initial.brandColor ?? "#2563eb");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "warn" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setMsg(null);
    const submitted = { brandName: brandName.trim(), brandColor: brandColor.trim(), logoUrl: logoUrl.trim() };
    try {
      const res = await fetch("/api/org/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, ...submitted }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't save branding.");
      // Compare what we submitted against what the server actually STORED, so a silently discarded
      // logo / truncated name surfaces as a warning instead of a green "saved" that lies.
      const stored = (d.branding ?? {}) as Partial<OrgBranding>;
      const warnings: string[] = [];
      if (submitted.logoUrl && !stored.logoUrl) warnings.push("Logo URL ignored — must be a public https image.");
      if (submitted.brandColor && !stored.brandColor) warnings.push("Accent colour ignored — must be a #rrggbb hex.");
      if (submitted.brandName && stored.brandName !== submitted.brandName) warnings.push("Brand name shortened to 80 characters.");
      if (warnings.length) {
        setState("warn");
        setMsg(`Saved with changes — ${warnings.join(" ")}`);
      } else {
        setState("saved");
        setMsg("Saved — the next briefing PDF uses your brand.");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 4000);
      }
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    }
  }

  const field = "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600";

  return (
    <details className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-semibold text-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
        Briefing branding
        <span className="font-mono text-sm font-normal uppercase tracking-widest text-accent">team+</span>
      </summary>
      <p className="mt-2 text-sm text-slate-500">White-label the downloaded briefing PDF — your name, accent, and logo replace Ascent&apos;s.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-mono text-sm text-slate-500">
          Brand name
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={80} placeholder="Acme Inc." className={`${field} w-44`} />
        </label>
        <label className="flex flex-col gap-1 font-mono text-sm text-slate-500">
          Accent
          <input type="color" value={HEX_COLOR_RE.test(brandColor) ? brandColor : "#2563eb"} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-14 rounded-lg border border-slate-700 bg-slate-900" />
        </label>
        <label className="flex flex-1 flex-col gap-1 font-mono text-sm text-slate-500">
          Logo URL (https)
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://acme.com/logo.png" className={`${field} min-w-[12rem]`} />
        </label>
        <button onClick={save} disabled={state === "saving"} aria-busy={state === "saving"} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {/* Live region so assistive tech announces the save outcome (the status was previously conveyed
          purely by text colour). An error is assertive (role="alert"); success/warnings are polite. */}
      {msg && (
        <p
          role={state === "error" ? "alert" : "status"}
          aria-live={state === "error" ? "assertive" : "polite"}
          className={`mt-2 font-mono text-sm ${state === "error" ? "text-orange-300" : state === "warn" ? "text-amber-300" : "text-emerald-300"}`}
        >
          {msg}
        </p>
      )}
    </details>
  );
}
