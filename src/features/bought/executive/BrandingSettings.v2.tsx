"use client";

// Prism briefing branding. Same hook, ids, and save as the Altimeter form. The preview is the PDF picture.
import { Chip, Eyebrow, FormField, Frame, GhostAction, Input, Lede, PrimaryAction } from "@/components/kit";
import type { OrgBranding } from "@/lib/db/branding";
import { DEFAULT_BRAND_ACCENT, HEX_COLOR_RE } from "@/lib/branding/color";
import { DownloadButton } from "@/components/report/DownloadButton";
import { chipButtonClass } from "@/components/ui";
import { ACCENT_HEX_LABEL } from "./BrandingSettings";
import { BrandingPreview } from "./BrandingPreview";
import { accentContrastWarning } from "./brandingContrast";
import { useBrandingSettings } from "./useBrandingSettings";

export function BrandingSettingsV2({ slug, initial }: { slug: string; initial: OrgBranding }) {
  const s = useBrandingSettings(slug, initial);
  const contrastWarning = accentContrastWarning(s.brandColor);
  const described = contrastWarning ? "brand-accent-warning" : undefined;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <Eyebrow as="span">Briefing branding</Eyebrow>
        <Chip tone="neutral">Team+</Chip>
      </summary>
      <Frame className="mt-4">
        <Lede>
          White-label your client-facing briefing deliverables: the downloaded PDF and read-only shared briefing
          links show your name and logo instead of Ascent&apos;s (the accent colors the PDF). This in-app dashboard
          keeps Ascent&apos;s look.
        </Lede>
        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <FormField label="Brand name" htmlFor="brand-name">
              <Input id="brand-name" value={s.brandName} onChange={(e) => s.setBrandName(e.target.value)} maxLength={80} placeholder="Acme Inc." />
            </FormField>
            <FormField label={<>Accent{!s.colorSet && <span className="text-slate-400"> (default)</span>}</>} htmlFor="brand-accent-hex">
              <span className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0">
                  <Input
                    type="color"
                    value={HEX_COLOR_RE.test(s.brandColor) ? s.brandColor : DEFAULT_BRAND_ACCENT}
                    onChange={(e) => {
                      s.setBrandColor(e.target.value);
                      s.setColorSet(true);
                    }}
                    aria-describedby={described}
                    className="h-9 cursor-pointer px-1"
                  />
                </span>
                <span className="w-28">
                  <Input
                    id="brand-accent-hex"
                    type="text"
                    value={s.colorSet ? s.brandColor : ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      s.setBrandColor(v || DEFAULT_BRAND_ACCENT);
                      s.setColorSet(Boolean(v));
                    }}
                    maxLength={7}
                    placeholder="#rrggbb"
                    aria-label={ACCENT_HEX_LABEL}
                    aria-describedby={described}
                  />
                </span>
                {s.colorSet && (
                  <GhostAction
                    onClick={() => {
                      s.setColorSet(false);
                      s.setBrandColor(DEFAULT_BRAND_ACCENT);
                    }}
                    aria-label="Use default"
                  >
                    Use default
                  </GhostAction>
                )}
              </span>
            </FormField>
            <FormField label="Logo URL (https)" htmlFor="brand-logo">
              <span className="flex items-center gap-2">
                <Input id="brand-logo" value={s.logoUrl} onChange={(e) => s.setLogoUrl(e.target.value)} placeholder="https://acme.com/logo.png" />
                {s.preview && !s.previewBroken && (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image would require remotePatterns per customer CDN
                  <img
                    src={s.preview}
                    alt="Saved logo preview"
                    title="The currently saved logo, as browsers load it"
                    onError={() => s.setPreviewBroken(true)}
                    className="h-9 w-9 shrink-0 border border-divider object-contain"
                  />
                )}
              </span>
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryAction type="button" onClick={s.save} disabled={s.state === "saving"}>
                {s.state === "saving" ? "Saving…" : "Save"}
              </PrimaryAction>
              <DownloadButton
                href={`/api/org/briefing/pdf?org=${encodeURIComponent(slug)}`}
                className={chipButtonClass("idle", s.state === "saving" ? "pointer-events-none opacity-50" : "")}
                title="Download the branded briefing PDF"
              >
                <span aria-hidden>↓</span> Download branded PDF
              </DownloadButton>
            </div>
          </div>
          <BrandingPreview brandName={s.brandName} brandColor={s.brandColor} logoUrl={s.logoUrl} />
        </div>
        {contrastWarning && (
          <p id="brand-accent-warning" className="mt-4 type-body-sm text-slate-400">
            <span aria-hidden>! </span>
            {contrastWarning}
          </p>
        )}
        {s.msg && (
          <p role={s.state === "error" ? "alert" : "status"} aria-live={s.state === "error" ? "assertive" : "polite"} className="mt-3 type-body-sm text-slate-200">
            {s.msg}
          </p>
        )}
      </Frame>
    </details>
  );
}
