"use client";

// Header tab switcher between the two coexisting looks. `initial` is the theme the server rendered (from the
// cookie); a change writes the cookie, flips the attribute for an instant repaint and asks the router to
// re-render server compositions, which may choose a different layout per theme (`<Module>.v2.tsx`).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { THEMES, THEME_LABEL, type ThemeId } from "@/lib/theme/theme";
import { applyTheme } from "@/lib/theme/client";

export function ThemeSwitch({ initial }: { initial: ThemeId }) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeId>(initial);

  const choose = (next: ThemeId) => {
    applyTheme(next);
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
