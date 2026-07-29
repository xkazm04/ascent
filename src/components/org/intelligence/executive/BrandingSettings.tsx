"use client";

// EXEC-5: owner-only (Team plan and up) form to white-label the client-facing briefing deliverables
// (the PDF + the anonymous /share/briefing/[token] page) — brand name, accent colour, logo URL.
// POSTs to /api/org/branding; values are validated server-side. Collapsed by default.

import type { OrgBranding } from "@/lib/db/branding";
import { DEFAULT_BRAND_ACCENT, HEX_COLOR_RE } from "@/lib/branding/color";
import { useBrandingSettings } from "./useBrandingSettings";
export { accentContrastOnWhite, accentContrastWarning, MIN_ACCENT_CONTRAST } from "./brandingContrast";
import { accentContrastWarning } from "./brandingContrast";

export function BrandingSettings({ slug, initial }: { slug: string; initial: OrgBranding }) {
  const {
    brandName, setBrandName,
    brandColor, setBrandColor,
    colorSet, setColorSet,
    logoUrl, setLogoUrl,
    state, msg,
    preview, previewBroken, setPreviewBroken,
    save,
  } = useBrandingSettings(slug, initial);

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
          This in-app dashboard keeps Ascent chrome — see the boundary note in ExecutiveTab.tsx. */}
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
            {/* org-branding #5: white-label users arrive with an EXACT brand hex from a style guide —
                the OS colour picker can't be pasted into, so eyeball-matching was the only path. This
                text twin is two-way synced with the swatch; an invalid value is still submitted, which
                makes the server's hex rejection + the client "Accent colour ignored" warning live
                (they were unreachable while the picker alone emitted only valid #rrggbb). */}
            <input
              type="text"
              value={colorSet ? brandColor : ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                setBrandColor(v || DEFAULT_BRAND_ACCENT);
                setColorSet(Boolean(v));
              }}
              maxLength={7}
              placeholder="#rrggbb"
              aria-label="Accent colour hex"
              aria-describedby={contrastWarning ? "brand-accent-warning" : undefined}
              className={`${field} w-24`}
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
          <span className="flex items-center gap-2">
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://acme.com/logo.png" className={`${field} min-w-[12rem] flex-1`} />
            {/* Saved-logo thumbnail (org-branding #4): success is visible instead of PDF-only. */}
            {preview && !previewBroken && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image would require remotePatterns config per customer CDN
              <img
                src={preview}
                alt="Saved logo preview"
                title="The currently saved logo, as browsers load it"
                onError={() => setPreviewBroken(true)}
                className="h-9 w-9 shrink-0 rounded-lg border border-slate-700 bg-white/5 object-contain"
              />
            )}
          </span>
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
