// The two coexisting looks. "altimeter" is the shipped identity (no attribute set); "prism" is the
// candidate identity from the landing-brand contest (docs/design/BRAND-PRISM.md). The duality exists
// so every route can be judged in both until the kit covers all of them, then one is retired.
export const THEMES = ["altimeter", "prism"] as const;
export type ThemeId = (typeof THEMES)[number];
export const THEME_KEY = "ascent-theme";
export const DEFAULT_THEME: ThemeId = "altimeter";

export const THEME_LABEL: Record<ThemeId, string> = { altimeter: "Altimeter", prism: "Prism" };

export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/**
 * Runs blocking in <head>, before first paint, so a stored choice never flashes the other look.
 * `?theme=` wins over storage and is persisted, so a link can carry a theme (the shooter uses it).
 * Only "prism" sets the attribute: the default look is the absence of one.
 */
export const THEME_BOOT_SCRIPT = `try{var q=new URLSearchParams(location.search).get("theme");var k=${JSON.stringify(THEME_KEY)};if(q==="prism"||q==="altimeter")localStorage.setItem(k,q);var t=localStorage.getItem(k);if(t==="prism")document.documentElement.dataset.theme="prism"}catch(e){}`;
