"use client";

// The kit is the single reference for the Prism look, so it renders in Prism whatever the header switch (or the
// cookie) says. This pins data-theme="prism" on <html> for as long as the specimen is mounted and puts back what was
// there, so a visit never changes the visitor's saved theme. Phase 3 (Prism the only theme) deletes this file.
import { useLayoutEffect } from "react";

export function PrismLock() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "prism");
    return () => {
      if (before === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", before);
    };
  }, []);
  return null;
}
