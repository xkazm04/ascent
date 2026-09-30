"use client";

// Copy puts `text` on the clipboard. The displayed value can be a mask; this receives the working one.
import { useState } from "react";
import { GhostAction } from "@/components/kit";

export function CopyControl({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <GhostAction
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        })();
      }}
    >
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </GhostAction>
  );
}
