"use client";

// THE FENCE — the module prefixes an approved direction may move. Prefilled from the plan's own
// `modules`; each is a removable chip, and a prefix can be added. The server normalizes what it receives
// (`normalizeFence`: trailing slash, no `..`, deduplicated), so this only trims and de-duplicates — it
// never rewrites what the operator typed into something they did not.

import { useState } from "react";
import { TextInput } from "@/components/ui";

export function FenceEditor({ fence, onChange, disabled = false }: { fence: readonly string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!fence.includes(v)) onChange([...fence, v]);
    setDraft("");
  };
  return (
    <div data-testid="fence-editor" className="space-y-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Fence">
        {fence.length === 0 && <li className="type-caption text-warn">An empty fence holds nothing — the direction could move no module.</li>}
        {fence.map((m) => (
          <li key={m} className="inline-flex items-center gap-1 rounded-md border border-divider bg-surface/60 py-0.5 pl-2 pr-1 font-mono type-caption text-slate-200">
            {m}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(fence.filter((x) => x !== m))}
              aria-label={`Remove ${m} from the fence`}
              className="focus-ring rounded px-1 text-slate-500 hover:text-danger disabled:opacity-50"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <TextInput
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="src/module/"
          aria-label="Add a module prefix"
          className="font-mono"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          className="focus-ring shrink-0 rounded-lg border border-divider px-3 type-caption text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
