"use client";

// Header tab switcher between the two coexisting looks. The <html data-theme> attribute (rendered by the
// server from the cookie) is the source of truth; a change writes the cookie, mirrors it to localStorage,
// flips the attribute for an instant repaint and asks the router to re-render server compositions, which
// may choose a different layout per theme (`<Module>.v2.tsx`).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_THEME, THEMES, THEME_KEY, THEME_LABEL, isThemeId, themeCookieString, themeAttr, type ThemeId } from "@/lib/theme/theme";

function current(): ThemeId {
  const v = document.documentElement.dataset.theme;
  return isThemeId(v) ? v : DEFAULT_THEME;
}

export function ThemeSwitch() {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeId | null>(null);
  useEffect(() => setTheme(current()), []);

  const choose = (next: ThemeId) => {
    const attr = themeAttr(next);
    if (attr) document.documentElement.dataset.theme = attr;
    else delete document.documentElement.dataset.theme;
    document.cookie = themeCookieString(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the cookie alone carries the choice */
    }
    setTheme(next);
    router.refresh();
  };

  return (
    <div role="tablist" aria-label="Visual theme" data-role="theme-switch" className="theme-switch flex shrink-0 rounded-md border border-divider p-0.5">
      {THEMES.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={theme === id}
          onClick={() => choose(id)}
          className="focus-ring rounded px-2.5 py-1 type-label tracking-widest text-slate-400 transition-colors hover:text-white aria-selected:bg-white/10 aria-selected:text-white"
        >
          {THEME_LABEL[id]}
        </button>
      ))}
    </div>
  );
}
