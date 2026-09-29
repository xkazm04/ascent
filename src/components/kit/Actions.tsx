// PrimaryAction / GhostAction: the landing's two buttons. Primary = paper block + spectrum underline (Prism;
// the underline is drawn by kit.css), Altimeter falls back to the accent-filled brand button. Renders a link when
// `href` is given, else a button. Server-safe: pass `onClick` only from a client component.
import Link from "next/link";
import type { ReactNode } from "react";

type Common = { children: ReactNode; className?: string; "aria-label"?: string };
type LinkProps = Common & { href: string; onClick?: never; type?: never; disabled?: never };
type ButtonProps = Common & { href?: undefined; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean };

const BASE = "focus-ring inline-flex items-center gap-2 whitespace-nowrap font-semibold transition-[transform,box-shadow,background-color] duration-200 disabled:opacity-50";
const PRIMARY = `${BASE} rounded-lg bg-accent px-4 py-2 type-body-sm text-on-accent hover:bg-accent-soft`;
const GHOST = `${BASE} rounded-lg border border-divider px-4 py-2 type-body-sm text-slate-200 hover:border-slate-500 hover:text-white`;

function make(kind: "primary" | "ghost", cls: string) {
  return function Action(p: LinkProps | ButtonProps) {
    const common = { "data-kit": "action", "data-kind": kind, "data-role": `action-${kind}`, "aria-label": p["aria-label"], className: `${cls} ${p.className ?? ""}` };
    if (p.href !== undefined) {
      return (
        <Link href={p.href} {...common}>
          {p.children}
        </Link>
      );
    }
    return (
      <button type={p.type ?? "button"} onClick={p.onClick} disabled={p.disabled} {...common}>
        {p.children}
      </button>
    );
  };
}

export const PrimaryAction = make("primary", PRIMARY);
export const GhostAction = make("ghost", GHOST);
