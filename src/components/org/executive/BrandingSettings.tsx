"use client";

// EXEC-5: owner-only (Team plan and up) form to white-label the client-facing briefing deliverables
// (the PDF + the anonymous /share/briefing/[token] page) — brand name, accent colour, logo URL.
// POSTs to /api/org/branding; values are validated server-side. Collapsed by default.

import { useState } from "react";
import type { OrgBranding } from "@/lib/db/branding";
import { DEFAULT_BRAND_ACCENT, HEX_COLOR_RE } from "@/lib/branding/color";

/** WCAG relative luminance (0 = black … 1 = white) of a `#rrggbb` colour; NaN for a malformed one. */
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return NaN;
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!);
}

/** WCAG contrast ratio (1…21) of `hex` against the WHITE briefing-PDF surface; NaN for a bad colour. */
export function accentContrastOnWhite(hex: string): number {
  const l = luminance(hex);
  if (Number.isNaN(l)) return NaN;
  return 1.05 / (l + 0.05); // white luminance is 1.0 → (1 + .05) / (l + .05)
}

/** Minimum readable ratio for the accent on white — WCAG 1.4.11 / large-text 1.4.3 (3:1). */
export const MIN_ACCENT_CONTRAST = 3;

/**
 * org-branding-white-label #1: a NON-BLOCKING warning when the chosen accent would be near-invisible
 * on the white briefing PDF (contrast below 3:1). Returns null for a readable — or malformed — colour.
 * The value is still saved; this only advises, so an owner can't unknowingly ship an unreadable brand.
 */
export function accentContrastWarning(hex: string): string | null {
  const ratio = accentContrastOnWhite(hex);
  if (Number.isNaN(ratio) || ratio >= MIN_ACCENT_CONTRAST) return null;
  return `Low contrast — this accent is only ${ratio.toFixed(1)}:1 on the white briefing PDF (below 3:1), so it may be hard to read. It'll still be saved; a darker shade reads better.`;
}

export function BrandingSettings({ slug, initial }: { slug: string; initial: OrgBranding }) {
  const [brandName, setBrandName] = useState(initial.brandName ?? "");
  const [brandColor, setBrandColor] = useState(initial.brandColor ?? DEFAULT_BRAND_ACCENT);
  // org-branding #2: `<input type="color">` cannot express "unset", so the picker's visible default
  // must not be conflated with a stored value. Track whether the org actually HAS a colour (stored, or
  // picked this session): while false we submit "" (the server's deliberate-clear), preserving the
  // stored-null "use the current default" semantics — otherwise the first save of a name-only change
  // silently froze #2563eb into the DB and there was no way back to null through this UI.
  const [colorSet, setColorSet] = useState(Boolean(initial.brandColor));
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "warn" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setMsg(null);
    const submitted = { brandName: brandName.trim(), brandColor: colorSet ? brandColor.trim() : "", logoUrl: logoUrl.trim() };
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
        setMsg("Saved — the next briefing PDF and shared briefing links use your brand.");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 4000);
      }
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    }
  }

  const field = "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600";
  // Live, non-blocking contrast advisory for the accent against the white PDF (org-branding #1).
  const contrastWarning = accentContrastWarning(brandColor);

  return (
    <details className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-semibold text-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
        Briefing branding
        <span className="font-mono text-sm font-normal uppercase tracking-widest text-accent">team+</span>
      </summary>
      {/* Honest scope: branding reaches the CLIENT-FACING deliverables (PDF + shared briefing links).
          This in-app dashboard keeps Ascent chrome — see the boundary note in executive/page.tsx. */}
      <p className="mt-2 text-sm text-slate-500">
        White-label your client-facing briefing deliverables — the downloaded PDF and read-only shared
        briefing links show your name and logo instead of Ascent&apos;s (the accent colours the PDF). This
        in-app dashboard keeps Ascent&apos;s look.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-mono text-sm text-slate-500">
          Brand name
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={80} placeholder="Acme Inc." className={`${field} w-44`} />
        </label>
        <label className="flex flex-col gap-1 font-mono text-sm text-slate-500">
          <span>
            Accent{!colorSet && <span className="ml-1.5 text-slate-600">(default)</span>}
          </span>
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_COLOR_RE.test(brandColor) ? brandColor : DEFAULT_BRAND_ACCENT}
              onChange={(e) => {
                setBrandColor(e.target.value);
                setColorSet(true);
              }}
              aria-describedby={contrastWarning ? "brand-accent-warning" : undefined}
              className="h-9 w-14 rounded-lg border border-slate-700 bg-slate-900"
            />
            {colorSet && (
              <button
                type="button"
                onClick={() => {
                  setColorSet(false);
                  setBrandColor(DEFAULT_BRAND_ACCENT);
                }}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-accent hover:text-white"
                title="Clear the custom accent — briefings follow Ascent's current default colour"
              >
                Use default
              </button>
            )}
          </span>
        </label>
        <label className="flex flex-1 flex-col gap-1 font-mono text-sm text-slate-500">
          Logo URL (https)
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://acme.com/logo.png" className={`${field} min-w-[12rem]`} />
        </label>
        <button onClick={save} disabled={state === "saving"} aria-busy={state === "saving"} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {/* org-branding #1: WARN (never block) when the accent would be near-invisible on the white PDF.
          Associated to the colour input via aria-describedby; not a live region, so dragging the
          picker doesn't spam a screen reader. */}
      {contrastWarning && (
        <p id="brand-accent-warning" className="mt-2 flex items-start gap-1.5 font-mono text-sm text-amber-300">
          <span aria-hidden>⚠</span>
          <span>{contrastWarning}</span>
        </p>
      )}
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
