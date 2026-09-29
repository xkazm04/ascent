"use client";

// Header tab switcher between the two coexisting looks. The DOM attribute is the source of truth
// (set pre-paint by THEME_BOOT_SCRIPT), so this reads it after mount instead of guessing on the server.
import { useEffect, useState } from "react";
import { DEFAULT_THEME, THEMES, THEME_KEY, THEME_LABEL, isThemeId, type ThemeId } from "@/lib/theme/theme";

function current(): ThemeId {
  const v = document.documentElement.dataset.theme;
  return isThemeId(v) ? v : DEFAULT_THEME;
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeId | null>(null);
  useEffect(() => setTheme(current()), []);

  const choose = (next: ThemeId) => {
    if (next === DEFAULT_THEME) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this page view only */
    }
    setTheme(next);
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
