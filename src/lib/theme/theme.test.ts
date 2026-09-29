import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_COOKIE, parseTheme, themeAttr, themeCookieString } from "./theme";

describe("theme pure helpers", () => {
  it("falls back to altimeter for anything but a known id", () => {
    expect(parseTheme("prism")).toBe("prism");
    expect(parseTheme("altimeter")).toBe("altimeter");
    for (const v of [undefined, null, "", "PRISM", "dark", 3]) expect(parseTheme(v)).toBe("altimeter");
  });
  it("only prism sets the attribute", () => {
    expect(themeAttr("prism")).toBe("prism");
    expect(themeAttr("altimeter")).toBeUndefined();
  });
  it("writes a root-scoped year-long lax cookie", () => {
    expect(themeCookieString("prism")).toMatch(new RegExp(`^${THEME_COOKIE}=prism; path=/; max-age=31536000; samesite=lax$`));
  });
});

/** Runs the boot script against a stub browser: returns [cookie written, reloaded?]. */
function boot(o: { rendered?: string; cookie?: string; query?: string; ls?: string; flag?: string }) {
  let cookie = o.cookie ? `${THEME_COOKIE}=${o.cookie}` : "";
  let reloaded = 0;
  const ss = new Map<string, string>(o.flag ? [["ascent-theme-reload", o.flag]] : []);
  const doc = {
    get cookie() { return cookie; },
    set cookie(v: string) { cookie = v.split(";")[0]; },
    documentElement: { dataset: { theme: o.rendered } },
  };
  new Function("document", "location", "localStorage", "sessionStorage", "URLSearchParams", THEME_BOOT_SCRIPT)(
    doc,
    { search: o.query ? `?theme=${o.query}` : "", reload: () => reloaded++ },
    { getItem: () => o.ls ?? null },
    { getItem: (k: string) => ss.get(k) ?? null, setItem: (k: string, v: string) => ss.set(k, v), removeItem: (k: string) => ss.delete(k) },
    URLSearchParams,
  );
  return { cookie, reloaded };
}

describe("THEME_BOOT_SCRIPT", () => {
  it("does nothing when the server already rendered the wanted look", () => {
    expect(boot({ rendered: "prism", cookie: "prism" }).reloaded).toBe(0);
    expect(boot({}).reloaded).toBe(0);
  });
  it("?theme= wins over the cookie, persists it and reloads once", () => {
    const r = boot({ rendered: undefined, cookie: "altimeter", query: "prism" });
    expect(r.cookie).toBe(`${THEME_COOKIE}=prism`);
    expect(r.reloaded).toBe(1);
  });
  it("migrates a pre-cookie localStorage value", () => {
    expect(boot({ ls: "prism" })).toEqual({ cookie: `${THEME_COOKIE}=prism`, reloaded: 1 });
  });
  it("cannot reload-loop when the cookie is blocked", () => {
    expect(boot({ ls: "prism", flag: "1" }).reloaded).toBe(0);
  });
  it("ignores garbage values", () => {
    expect(boot({ query: "neon", cookie: "x", ls: "y" }).reloaded).toBe(0);
  });
});
