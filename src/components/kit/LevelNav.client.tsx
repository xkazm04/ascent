"use client";

// EscBack: Esc = up one level. Renders nothing; mount it while a level below the overview is open. It only
// acts when nothing more specific took the key (an open menu or dialog calls preventDefault first), so it never
// steals Esc from a modal above it.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function EscBack({ href, onBack, enabled = true }: { href?: string; onBack?: () => void; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (onBack) onBack();
      else if (href) router.push(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, href, onBack, router]);
  return null;
}
