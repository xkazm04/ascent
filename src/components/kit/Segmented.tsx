"use client";

// (Client: the button form takes an onSelect handler. The link form carries no state and works the same.)
// Segmented — a one-of-N switch in a hairline frame: the active option is the accent block (in Prism,
// paper with the spectrum underline), the rest are quiet text. Renders buttons (client state) or links
// (`href` per option: the URL is the state, server-renderable) from the same option list.
import Link from "next/link";

export interface SegmentedOption {
  key: string;
  label: React.ReactNode;
  /** Present: the option is a link and `onSelect` is not called for it. */
  href?: string;
  title?: string;
  /** Open the link in a new tab (never the active option). */
  external?: boolean;
}

const VARIANT = {
  // Period pickers and filters: a solid accent block on a filled frame.
  solid: {
    frame: "border-slate-800 bg-slate-900/40",
    item: "px-2.5 py-1 type-mono-sm",
    on: "bg-accent font-semibold text-on-accent",
    off: "text-slate-400 hover:text-white",
  },
  // View switches (Ledger / Cockpit / Desk): a tinted active option on an open frame.
  soft: {
    frame: "gap-1 border-divider",
    item: "px-3 py-1.5 type-body-sm font-medium",
    on: "bg-accent/15 text-accent",
    off: "text-slate-400 hover:text-slate-100",
  },
} as const;

export function Segmented({
  options,
  value,
  onSelect,
  label,
  variant = "solid",
  nav = false,
  className = "",
}: {
  options: SegmentedOption[];
  value: string | null;
  onSelect?: (key: string) => void;
  /** Accessible name of the group. */
  label: string;
  variant?: keyof typeof VARIANT;
  /** Render as a `<nav>` landmark (links that change the page view) rather than a button group. */
  nav?: boolean;
  className?: string;
}) {
  const v = VARIANT[variant];
  const Frame = nav ? "nav" : "div";
  return (
    <Frame
      data-kit="segmented"
      data-variant={variant}
      data-role="segmented"
      role={nav ? undefined : "group"}
      aria-label={label}
      className={`inline-flex items-center rounded-lg border p-0.5 ${v.frame} ${className}`}
    >
      {options.map((o) => {
        const active = o.key === value;
        const cls = `focus-ring rounded-md transition ${v.item} ${active ? v.on : v.off}`;
        if (o.href != null) {
          return (
            <Link
              key={o.key}
              href={o.href}
              aria-current={active ? "page" : undefined}
              title={o.title}
              className={cls}
              {...(o.external ? { target: "_blank", rel: "noopener" } : {})}
            >
              {o.label}
            </Link>
          );
        }
        return (
          <button key={o.key} type="button" aria-pressed={active} title={o.title} onClick={() => onSelect?.(o.key)} className={cls}>
            {o.label}
          </button>
        );
      })}
    </Frame>
  );
}
