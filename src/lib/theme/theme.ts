// Prism is the only look. The Altimeter/Prism duality (cookie, ?theme= link, boot script, header switch)
// is retired; the root layout always emits `data-theme="prism"` so the Prism selectors stay valid. A stale
// `ascent-theme` cookie from the duality era is simply never read.
export type ThemeId = "altimeter" | "prism"; // "altimeter" only until the per-tab branches are collapsed
export const THEME_ATTR = "prism" as const;
