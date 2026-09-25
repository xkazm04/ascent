"use client";

// The desk's fixed surfaces (the inner layer, the tip box) render into <body>: the org shell wraps its
// tabs in a transformed element, and a transformed ancestor becomes the containing block of every fixed
// descendant — the layer would sit inside the main column, under the shell's header and drawers. The
// portal root carries the desk's root class, so the tokens and font stacks still apply.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import s from "./desk.module.css";

export function DeskPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className={`${s.desk} ${s.portal}`}>{children}</div>, document.body);
}
