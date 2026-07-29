// Form state + save handler for BrandingSettings.tsx. Pulled out so the form's JSX file stays under
// the 200-LOC cap (docs/ORG-TABS-REFACTOR.md) — owns no JSX.

import { useState } from "react";
import type { OrgBranding } from "@/lib/db/branding";
import { DEFAULT_BRAND_ACCENT } from "@/lib/branding/color";

export function useBrandingSettings(slug: string, initial: OrgBranding) {
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
  // org-branding #4: the last SAVED logo URL, rendered as a thumbnail next to the field so "the URL
  // actually serves an image" is VISIBLE — previously the only test was downloading a PDF and
  // eyeballing it. `previewBroken` hides a thumbnail the browser can't load (distinct from the
  // server-side probe below, which checks the PDF renderer's own guarded fetch).
  const [preview, setPreview] = useState(initial.logoUrl ?? null);
  const [previewBroken, setPreviewBroken] = useState(false);

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
      if (submitted.logoUrl && !stored.logoUrl) warnings.push("Logo URL ignored — must be a public https image URL under 500 characters.");
      if (submitted.brandColor && !stored.brandColor) warnings.push("Accent colour ignored — must be a #rrggbb hex.");
      if (submitted.brandName && stored.brandName !== submitted.brandName) warnings.push("Brand name shortened to 80 characters.");
      // org-branding #4: the server probed the saved logo with the SAME guarded fetch the PDF render
      // uses; a URL that is safe but doesn't return an image would otherwise fail invisibly at export.
      if (stored.logoUrl && d.logoUnreachable) warnings.push("Logo URL saved, but it didn't return an image — the PDF will render without a logo until it does.");
      setPreview(stored.logoUrl ?? null);
      setPreviewBroken(false);
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

  return {
    brandName, setBrandName,
    brandColor, setBrandColor,
    colorSet, setColorSet,
    logoUrl, setLogoUrl,
    state, msg,
    preview, previewBroken, setPreviewBroken,
    save,
  };
}
