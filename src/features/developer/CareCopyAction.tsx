"use client";

// The mentor commands, as UI. `CareCopyAction` is the one Care affordance with a real side effect —
// see its docblock — and `CareCommand` is the selectable rendering every named command gets, whether
// or not a copy button is offered beside it.

import { useEffect, useState, useSyncExternalStore } from "react";
import { chipButtonClass } from "@/components/ui";

/**
 * A mentor command, rendered so it can always be taken by hand: selectable, mono, one hairline box.
 * Naming a command in prose (`npx ascent mentor retro`) and leaving it as unselectable body text
 * makes the reader retype it; this is the smallest honest alternative.
 */
export function CareCommand({ command }: { command: string }) {
  return (
    <code className="select-all rounded border border-divider bg-surface-strong/60 px-2 py-1 font-mono type-caption text-slate-200">
      {command}
    </code>
  );
}

/**
 * The ONE Care affordance with a real side effect. Every other one logs its intent (`CareAction`)
 * and the page discloses that; a button labelled "Copy" is a promise about the clipboard, so this
 * one keeps it. Same shape as the Claude Code setup's `CopyButton`
 * (`src/features/admin/integrations/SetupField.tsx`): write, a short "Copied" state, `aria-live` so
 * the transition is announced rather than only seen.
 *
 * The command sits beside the button as selectable text at all times, so the fallback needs no
 * second layout: where the Clipboard API is missing (insecure context, older browser) or refuses,
 * the button is simply not offered and the text is there to select.
 */
/** Never changes within a session — the subscribe half of the store below is deliberately inert. */
const noSubscribe = () => () => {};
const hasClipboard = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
const noClipboardOnServer = () => false;

export function CareCopyAction({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [denied, setDenied] = useState(false);

  // Read as an EXTERNAL store rather than in the render body or a mount effect: the server has no
  // `navigator`, so a render-body read would hydrate to a different tree than it rendered, and a
  // setState-in-effect is a cascading render (and is linted against).
  const canCopy = useSyncExternalStore(noSubscribe, hasClipboard, noClipboardOnServer) && !denied;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <CareCommand command={command} />
      {canCopy ? (
        <button
          type="button"
          className={chipButtonClass(copied ? "success" : "idle")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
            } catch {
              // The promise cannot be kept — stop offering it and leave the selectable text.
              setDenied(true);
            }
          }}
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      ) : (
        <span className="type-body-sm text-slate-500">select to copy</span>
      )}
    </span>
  );
}
