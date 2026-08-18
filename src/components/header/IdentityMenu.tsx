"use client";

// The signed-in identity, as a MENU rather than a single link.
//
// Your own name in the header is the one affordance present on every page in both auth stacks, which
// makes it the only honest home for surfaces that are yours rather than an org's. `/org/developer` —
// the personalized Developer home — used to hang off the org rail, where it was structurally wrong:
// the rail is org-scoped navigation, the Developer page is not org-scoped at all (it resolves your
// own slice from the session), and a personal surface listed beside "Members" and "Audit" reads as
// another org report. It left the rail (ORG_TABS_NOT_IN_NAV) and lives here instead.
//
// Keyboard contract, in full — the trigger declares aria-haspopup/aria-expanded and the popup is a
// role="menu", so the ARIA menu bindings are PROMISED and must therefore work: focus moves into the
// menu on open, ArrowUp/ArrowDown roam, Home/End jump, Escape closes and RETURNS focus to the
// trigger, Tab closes (disclosure semantics) so the menu can never stay open while focus has walked
// elsewhere. Modeled on OrgSwitcher, which pins the same contract for the org popup.
//
// No new always-on motion: the panel simply appears. The only transition is the chevron rotation and
// the row hover, both already in the brand's vocabulary.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface IdentityMenuItem {
  href: string;
  label: string;
  /** One short line under the label — what the destination actually is. */
  hint?: string;
}

export function IdentityMenu({
  login,
  image,
  items,
  signOut,
}: {
  login: string;
  image?: string | null;
  items: readonly IdentityMenuItem[];
  /** The sign-out affordance the surrounding header already offers, moved inside the menu. Passed in
   *  as a node because the two auth stacks spell it differently (a Supabase client button vs a POST
   *  form), and this component must not know which one is live. */
  signOut?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape. Escape also restores focus to the trigger: without that half, dismissing
  // drops focus on <body> and a keyboard user restarts their tab order from the top of the document.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the first row on open — the behavioural half of the role="menu" promise.
  useEffect(() => {
    if (!open) return;
    focusables(menuRef.current)[0]?.focus();
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = focusables(menuRef.current);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]!.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]!.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]!.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]!.focus();
    } else if (e.key === "Tab") {
      // The focused row is about to unmount — hand focus back to the trigger so the browser's default
      // Tab continues from a mounted node rather than from <body>.
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${login} — account menu`}
        className="focus-ring flex items-center gap-2 rounded-sm text-slate-200 hover:text-white"
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-6 w-6 rounded-full border border-slate-700" />
        )}
        <span className="max-w-[7rem] truncate normal-case tracking-normal sm:max-w-none">{login}</span>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${login} account`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-2 min-w-[14rem] rounded-lg border border-slate-700 bg-[#0b1120] py-1 shadow-xl shadow-black/40"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              tabIndex={-1} // roving focus: arrows/Home/End move focus, Tab exits the menu
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-left text-base text-slate-300 transition hover:bg-slate-800/70 hover:text-white focus:bg-slate-800/70 focus:text-white focus:outline-none"
            >
              <span className="block normal-case tracking-normal">{item.label}</span>
              {item.hint && <span className="block text-sm text-slate-500">{item.hint}</span>}
            </Link>
          ))}
          {signOut && (
            <div className="mt-1 border-t border-slate-800 px-3 py-2 text-base text-slate-300">{signOut}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Every row a keyboard user can land on — the links AND whatever the sign-out slot rendered, so the
 *  roving order matches what the eye sees rather than only the rows this file authored. */
function focusables(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
}
