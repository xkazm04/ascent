"use client";

// Scroll-linked chrome: the spectrum progress bar (written straight to the element, no re-render per
// scroll event), the top bar's flip to its on-paper form while the identity section is under it, and
// which nav link is "on".

import { useEffect, useRef, useState } from "react";

export function usePrismScroll(sectionIds: readonly string[]) {
  const progressRef = useRef<HTMLElement | null>(null);
  const [paper, setPaper] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${h > 0 ? window.scrollY / h : 0})`;
      const br = document.getElementById("brand")?.getBoundingClientRect();
      setPaper(!!br && br.top < 40 && br.bottom > 40);
      const y = window.scrollY + window.innerHeight * 0.4;
      let on: string | null = null;
      for (const id of sectionIds) {
        const s = document.getElementById(id);
        if (s && s.offsetTop <= y) on = id;
      }
      setActive(on);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sectionIds]);

  return { progressRef, paper, active };
}
