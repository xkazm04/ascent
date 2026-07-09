"use client";

// Shared scroll-reveal for deck sections — a fade-up entrance each time the element scrolls in
// (`once:false`, so a section re-reveals when you snap back to it).
//
// FAILURE MODE THIS GUARDS (bug-ui-scan #1): the previous framer-motion version used
// `initial={{ opacity: 0 }}`, which framer bakes into the SSR HTML as an inline `opacity:0`. Since the
// only thing that unhid it was a client-side `whileInView` observer, any render without working JS —
// scripts disabled/blocked, a crawler that doesn't execute JS, or a partial hydration failure — left
// EVERY Reveal-wrapped block permanently at `opacity:0`. That blanked the app's public front door
// (`/about` + the index landing are almost entirely Reveal-wrapped).
//
// Fix: the hidden start state now lives ONLY in the `.js-reveal` CSS class (globals.css), which this
// component adds AFTER it mounts on the client. The server HTML carries neither the class nor any inline
// opacity, so the no-JS / no-hydration state renders the content VISIBLE and readable — the reveal is
// pure progressive enhancement. reduced-motion is honored in CSS (`.js-reveal`'s hidden state is gated
// behind `prefers-reduced-motion: no-preference`), so a reduced-motion user is never hidden even once
// armed. Dependency-free — no framer runtime on this hot public path.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// Arm before the first post-hydration paint (useLayoutEffect) so the hidden start is in place before the
// browser repaints — no "content shows, then blinks out, then fades" flash for JS users. Falls back to
// useEffect on the server, where useLayoutEffect is a no-op React warns about (and never runs anyway).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `armed` gates the hidden start on client mount: false during SSR + the first client render (so the
  // emitted HTML is visible and hydration matches), then flipped true by the effect below.
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    setArmed(true);
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (jsdom / very old browser): reveal immediately rather than stranding the
    // content at its armed (hidden) rest state — degrade to plain visible, never blank.
    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        // `once:false` — mirror each entry's live intersection so a section re-reveals when the deck
        // snaps back to it, and eases back to its hidden rest state when it leaves.
        for (const e of entries) setRevealed(e.isIntersecting);
      },
      { rootMargin: "-90px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Only `js-reveal` (added post-mount) carries the hidden start + transition; the SSR markup has
  // neither, so it renders visible. No inline opacity is ever emitted — the exact regression this fixes.
  const cls = [armed && "js-reveal", revealed && "is-revealed", className].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      style={{ "--reveal-y": `${y}px`, "--reveal-delay": `${delay}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}
