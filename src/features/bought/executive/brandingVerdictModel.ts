// branding-1: the pure mapping from (the saved logo, the draft, the server's no-write verdict) to
// what the branding form shows BEFORE a save: a note per field carrying the server's reason, the
// PDF-header preview's logo state, and a Save button that names what it is about to destroy.
// No hooks, no DOM, no server imports (both forms and the preview are client components).

/** The logo's state as POST /api/org/branding/check reports it. */
export type LogoVerdict = "ok" | "unreachable" | "rejected" | "unchecked" | "none";

/** The check route's answer (the fields this model reads; every one is optional but the lists). */
export interface BrandingCheckVerdict {
  branding?: { brandName: string | null; brandColor: string | null; logoUrl: string | null };
  rejected: string[];
  reasons: Partial<Record<string, string>>;
  logo?: LogoVerdict;
  logoReason?: string | null;
  contrast?: { onWhite: number; onDark: number };
}

export type SaveIntent = "plain" | "warn" | "destructive";

export interface BrandingVerdictView {
  saveIntent: SaveIntent;
  saveLabel: string;
  notes: { brandName?: string; brandColor?: string; logoUrl?: string };
  logoVerdict: LogoVerdict;
}

export const SAVE_LABELS: Record<SaveIntent, string> = {
  plain: "Save",
  warn: "Save anyway",
  destructive: "Save and remove the current logo",
};

const MIN_CONTRAST = 3;

const REJECT_NOTES: Record<string, string> = {
  "not-https": "Must be an https URL",
  "private-host": "Must be a public host, not a private or internal address",
  "too-long": "Must be 500 characters or fewer",
  "not-hex": "Must be a #rrggbb hex colour",
};

/** Why the PDF would have no logo, from the guarded fetch's refusal reason. */
function unreachableNote(reason: string | null | undefined): string {
  if (reason === "unsupported-format") return "This image isn't PNG, JPEG or SVG, so the PDF would have no logo";
  if (reason === "too-large") return "This image is over 512 KB, so the PDF would have no logo";
  return "This URL didn't return an image, so the PDF would have no logo";
}

export function brandingVerdictModel({
  storedLogoUrl,
  draft,
  verdict,
}: {
  storedLogoUrl: string | null;
  draft: { brandName?: string; brandColor?: string; logoUrl: string };
  verdict: BrandingCheckVerdict | null;
}): BrandingVerdictView {
  const draftLogo = draft.logoUrl.trim();
  const notes: BrandingVerdictView["notes"] = {};
  let logoVerdict: LogoVerdict = draftLogo ? "unchecked" : "none";
  let warn = false;

  if (verdict) {
    const logoReason = verdict.reasons.logoUrl;
    if (logoReason) {
      notes.logoUrl = REJECT_NOTES[logoReason] ?? "This logo URL would be ignored";
      logoVerdict = "rejected";
    } else if (verdict.logo === "unreachable") {
      notes.logoUrl = unreachableNote(verdict.logoReason);
      logoVerdict = "unreachable";
    } else if (verdict.logo === "ok") {
      logoVerdict = "ok";
    }
    const colorReason = verdict.reasons.brandColor;
    if (colorReason) notes.brandColor = REJECT_NOTES[colorReason] ?? "This colour would be ignored";
    const name = draft.brandName?.trim() ?? "";
    const savedName = verdict.branding?.brandName ?? null;
    if (name && savedName !== null && savedName.length < name.length) notes.brandName = "Will be shortened to 80 characters";
    const c = verdict.contrast;
    const lowContrast = Boolean(c && (c.onWhite < MIN_CONTRAST || c.onDark < MIN_CONTRAST));
    warn = verdict.rejected.length > 0 || logoVerdict === "unreachable" || Boolean(notes.brandName) || lowContrast;
  }

  // Destructive: the save would leave the PDF without the logo it has today. A deliberate clear
  // counts (it is named, not blocked); so does a replacement the server rejects or cannot fetch.
  const replacesWorkingLogo = Boolean(storedLogoUrl) && draftLogo !== storedLogoUrl;
  const losesLogo = replacesWorkingLogo && (!draftLogo || logoVerdict === "rejected" || logoVerdict === "unreachable");
  const saveIntent: SaveIntent = losesLogo ? "destructive" : warn ? "warn" : "plain";
  return { saveIntent, saveLabel: SAVE_LABELS[saveIntent], notes, logoVerdict };
}
