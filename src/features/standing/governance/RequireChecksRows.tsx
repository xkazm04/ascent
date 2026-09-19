"use client";

// Owner control for GatePolicy.requireChecks — doctor check ids that must not be reported failing.
// Kept in its own file so GatePolicyEditor.tsx stays inside the 200-LOC cap (AGENTS.md). Malformed
// ids are dropped here (isValidCheckId) rather than POSTed as a bar that can never be satisfied.

import { useState } from "react";
import { REQUIRE_CHECKS_CAP } from "./gatePolicyReconcile";

export function RequireChecksRows({
  checks,
  onAdd,
  onRemove,
}: {
  checks: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const atCap = checks.length >= REQUIRE_CHECKS_CAP;

  function addDraft() {
    const id = draft.trim();
    setDraft("");
    if (id) onAdd(id);
  }

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-mono-sm uppercase tracking-widest text-slate-500">Required controls</span>
        <span className="type-body-sm text-slate-500">Doctor check ids that must not be failing.</span>
      </div>

      {checks.length === 0 ? (
        <p className="mt-2 type-body-sm text-slate-500">
          No required controls. Add a doctor check id to fail the gate when that control is reported
          failing.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {checks.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <span className="flex-1 font-mono type-body-sm text-slate-300">{id}</span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={`Remove required control ${id}`}
                className="rounded-md border border-slate-700 px-2 py-1 type-mono-sm text-slate-500 transition hover:border-orange-400 hover:text-orange-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <label className="flex min-w-0 flex-1 items-center gap-2 type-body-sm text-slate-400">
          Doctor check id
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="control.prepush.lint"
            disabled={atCap}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 type-mono-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={addDraft}
          disabled={atCap}
          aria-label="Add required control"
          className="rounded-md border border-slate-700 px-2 py-1 type-mono-sm text-slate-400 transition hover:border-accent hover:text-slate-200 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}
