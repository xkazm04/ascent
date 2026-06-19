"use client";

// Shared scroll-reveal for deck sections — a one-time-per-entry entrance when the element scrolls in.
// Under the page MotionConfig reducedMotion="user" the y-translate degrades to a plain fade. `once`
// is false so each section re-reveals when you snap back to it.

import { motion } from "framer-motion";
import type { ReactNode } from "react";

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
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, margin: "-90px" }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
