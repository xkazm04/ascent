"use client";

// A command the operator runs THEMSELVES — the held plan's `git log`, the merge the runner refused to
// make for them. Shown verbatim in a code block with one Copy button: a human-performed step is only
// as good as how exactly it reaches the terminal.

import { useState } from "react";

export function CopyCommand({ lines, label = "Copy" }: { lines: readonly string[]; label?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const text = lines.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      // No clipboard (an insecure origin, a denied permission): the text is still selectable above.
      setCopied("failed");
    }
  };
  return (
    <div className="mt-2 flex items-start gap-2">
      <pre
        data-testid="copy-command"
        className="min-w-0 flex-1 overflow-x-auto rounded-md border border-divider bg-surface-strong/60 px-3 py-2 font-mono type-caption text-slate-200"
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="focus-ring shrink-0 rounded-md border border-divider px-2.5 py-1.5 type-caption text-slate-300 hover:border-accent hover:text-white"
      >
        {copied === "done" ? "Copied" : copied === "failed" ? "Select to copy" : label}
      </button>
    </div>
  );
}
