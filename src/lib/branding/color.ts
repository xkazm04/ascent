// The single source for the white-label accent-colour format. Shared by the server-side validator
// in `@/lib/db/branding` (which normalizes/nulls a bad colour on write) and the client
// BrandingSettings colour-picker value guard, so the two can't drift. Kept in its own leaf module —
// free of any Prisma/server import — so the client component can import the const without pulling the
// db layer (and `@prisma/client`) into the browser bundle.

/** A 6-digit `#rrggbb` hex colour (the only accepted brand-accent format). */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** True when `s` is a well-formed `#rrggbb` hex colour. */
export function isHexColor(s: string): boolean {
  return HEX_COLOR_RE.test(s);
}

/**
 * The default briefing accent — the SAME value as the PDF theme's ACCENT (`@/lib/pdf/theme` re-derives
 * it from here). The BrandingSettings picker shows it as its visible default but must NOT persist it
 * unless the owner actually chooses a colour: stored-null means "use the current default" and keeps
 * tracking this constant, while a stored `#2563eb` is a deliberate choice frozen at save time.
 */
export const DEFAULT_BRAND_ACCENT = "#2563eb";
