// branding-1: ask POST /api/org/branding/check what a save WOULD do, debounced under the form.
// - 600 ms after the last edit, one POST (never on mount: the untouched stored branding needs no check).
// - A response for an older draft is dropped (sequence number + abort), so a slow answer can never
//   paint a verdict over a newer draft.
// - The logo is probed (the server's guarded fetch) only when its URL changed since the last ANSWERED
//   probe; a later name/colour edit reuses that answer for the same URL.
// A refused or malformed answer yields no verdict: the form then saves exactly as it did before.

import { useEffect, useRef, useState } from "react";
import type { BrandingCheckVerdict, LogoVerdict } from "./brandingVerdictModel";

export const BRANDING_CHECK_DEBOUNCE_MS = 600;

/** The values the form would submit (trimmed; brandColor "" when the accent is unset). */
export interface BrandingDraft {
  brandName: string;
  brandColor: string;
  logoUrl: string;
}

type Probe = { url: string; logo: LogoVerdict; logoReason: string | null };

function isVerdict(d: unknown): d is BrandingCheckVerdict {
  const v = d as Partial<BrandingCheckVerdict> | null;
  return Boolean(v && Array.isArray(v.rejected) && v.reasons && typeof v.reasons === "object");
}

export function useBrandingCheck(slug: string, draft: BrandingDraft) {
  const key = JSON.stringify([draft.brandName, draft.brandColor, draft.logoUrl]);
  const [initialKey] = useState(key);
  const [answer, setAnswer] = useState<{ key: string; verdict: BrandingCheckVerdict } | null>(null);
  const seq = useRef(0);
  const lastProbe = useRef<Probe | null>(null);

  useEffect(() => {
    if (key === initialKey) return;
    const mine = ++seq.current;
    const ctrl = new AbortController();
    const [brandName, brandColor, logoUrl] = JSON.parse(key) as [string, string, string];
    const timer = setTimeout(async () => {
      const probeLogo = Boolean(logoUrl) && lastProbe.current?.url !== logoUrl;
      try {
        const res = await fetch("/api/org/branding/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org: slug, brandName, brandColor, logoUrl, probeLogo }),
          signal: ctrl.signal,
        });
        const d: unknown = await res.json().catch(() => null);
        if (mine !== seq.current || !res.ok || !isVerdict(d)) return;
        let verdict = d;
        if (probeLogo && (d.logo === "ok" || d.logo === "unreachable")) {
          lastProbe.current = { url: logoUrl, logo: d.logo, logoReason: d.logoReason ?? null };
        } else if (d.logo === "unchecked" && lastProbe.current?.url === logoUrl) {
          verdict = { ...d, logo: lastProbe.current.logo, logoReason: lastProbe.current.logoReason };
        }
        setAnswer({ key, verdict });
      } catch {
        // Aborted by a newer edit, or offline: no verdict, and the save path is unchanged.
      }
    }, BRANDING_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, initialKey, slug]);

  const verdict = answer && answer.key === key ? answer.verdict : null;
  return { verdict, checking: key !== initialKey && !verdict };
}
