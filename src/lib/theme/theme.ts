// The two coexisting looks. "altimeter" is the shipped identity (no attribute set); "prism" is the
// candidate identity from the landing-brand contest (docs/design/BRAND-PRISM.md). The duality exists
// so every route can be judged in both until the kit covers all of them, then one is retired.
//
// The choice lives in a COOKIE (`ascent-theme`) so the SERVER can read it (src/lib/theme/server.ts) and a
// route can render a different LAYOUT per theme with no hydration flash. localStorage mirrors it only
// to migrate the value written before the cookie existed.
export const THEMES = ["altimeter", "prism"] as const;
export type ThemeId = (typeof THEMES)[number];
export const THEME_KEY = "ascent-theme";
export const THEME_COOKIE = "ascent-theme";
export const DEFAULT_THEME: ThemeId = "altimeter";
const YEAR_S = 60 * 60 * 24 * 365;

export const THEME_LABEL: Record<ThemeId, string> = { altimeter: "Altimeter", prism: "Prism" };

export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/** Any unknown / missing value is the default look: a stray cookie can never break the shell. */
export const parseTheme = (v: unknown): ThemeId => (isThemeId(v) ? v : DEFAULT_THEME);

/** The value of the `data-theme` attribute for a theme: only Prism sets one, the default is its absence. */
export const themeAttr = (t: ThemeId): "prism" | undefined => (t === "prism" ? "prism" : undefined);

/** The Set-Cookie string ThemeSwitch (client) writes; a function so the shape is testable. */
export const themeCookieString = (t: ThemeId): string => `${THEME_COOKIE}=${t}; path=/; max-age=${YEAR_S}; samesite=lax`;

/**
 * Runs blocking in <head>. The server already rendered `data-theme` from the cookie; this only handles
 * the two cases the server could not know: a `?theme=` link (wins, and is persisted) and a value stored
 * in localStorage before the cookie existed (migrated once). When the wanted look differs from what the
 * server rendered it writes the cookie and reloads once (sessionStorage guard: blocked cookies cannot loop).
 */
export const THEME_BOOT_SCRIPT = `try{var C=${JSON.stringify(THEME_COOKIE)},ok=function(v){return v==="prism"||v==="altimeter"},m=document.cookie.match(new RegExp("(?:^|; )"+C+"=([^;]*)")),ck=m?m[1]:null,q=new URLSearchParams(location.search).get("theme"),ls=null;try{ls=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var want=ok(q)?q:ok(ck)?ck:ok(ls)?ls:"altimeter",got=document.documentElement.dataset.theme==="prism"?"prism":"altimeter";if(want!==got&&!sessionStorage.getItem("ascent-theme-reload")){document.cookie=C+"="+want+"; path=/; max-age=${YEAR_S}; samesite=lax";sessionStorage.setItem("ascent-theme-reload","1");location.reload()}else{sessionStorage.removeItem("ascent-theme-reload")}}catch(e){}`;
