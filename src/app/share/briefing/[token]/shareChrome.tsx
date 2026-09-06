// The anonymous share page's own branded frame — header, footer, brand mark and the pre-trust
// Notice panel. Extracted from page.tsx to keep that file under the repo's 300-LOC .tsx cap
// (AGENTS.md); pure relocation, no behavior change. No hooks and no handlers, so no "use client".

import { Logo } from "@/components/Brand";
import { TokenNotice } from "@/components/TokenNotice";
import type { OrgBranding } from "@/lib/db/branding";

// EXEC-5 white-label boundary: this anonymous share page is a CLIENT-FACING deliverable (the link a
// reseller hands a board member), so a Team+ org's brand name + logo replace the Ascent mark here,
// exactly like the briefing PDF. The brand ACCENT is deliberately not applied on this dark surface —
// it is validated for readability against the white PDF only, so an arbitrary accent could be
// unreadable here. Falls back to the Ascent mark when the org has no branding / no entitled plan
// (and on the token-invalid notices, where the org isn't trusted yet).
export function BrandMark({ branding, className = "" }: { branding?: OrgBranding | null; className?: string }) {
  if (!branding?.brandName && !branding?.logoUrl) return <Logo className={className} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {branding.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote logo; next/image needs domain allowlisting
        <img src={branding.logoUrl} alt="" className="h-6 w-6 object-contain" />
      )}
      {branding.brandName && (
        <span className="font-mono type-body font-semibold uppercase tracking-[0.22em] text-white">{branding.brandName}</span>
      )}
    </span>
  );
}

// A minimal branded frame for the anonymous share view. The full marketing SiteHeader/SiteFooter
// (Pricing / About / Sign-in, the org switcher, footer funnel links) is wrong here: the viewer is a
// board member holding a capability token, with no account and nowhere to sign in — so we show only
// the brand mark and a "shared briefing" label, no navigation into the funnel.
export function ShareHeader({ branding }: { branding?: OrgBranding | null }) {
  return (
    <header className="border-b border-divider/70 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
        <BrandMark branding={branding} />
        <span className="type-label tracking-widest text-slate-500">Shared briefing</span>
      </div>
    </header>
  );
}

export function ShareFooter({ branding }: { branding?: OrgBranding | null }) {
  const branded = Boolean(branding?.brandName || branding?.logoUrl);
  return (
    <footer className="mt-auto border-t border-divider/70 py-6 text-center">
      <BrandMark branding={branding} className="justify-center opacity-70" />
      {/* The Ascent tagline is part of the identity being white-labelled — drop it when branded. */}
      {!branded && (
        <p className="mt-2 type-label tracking-widest text-slate-500">
          The maturity index for AI-native engineering
        </p>
      )}
    </footer>
  );
}

// The shared TokenNotice panel between this page's own branded frame. Unbranded on purpose: these
// notices fire before the org is trusted (bad/revoked token), so they must never carry its mark.
export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <ShareHeader />
      <TokenNotice title={title} body={body} minHeightClass="min-h-[60vh]" />
      <ShareFooter />
    </>
  );
}

