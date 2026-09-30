"use client";

// Doctor check ids that must not be reported failing. Malformed ids are dropped by the
// editor hook, not posted as a bar that can never be satisfied.
import { useState } from "react";
import { Eyebrow, FormField, GhostAction, Input } from "@/components/kit";
import { REQUIRE_CHECKS_CAP } from "./gatePolicyReconcile";

export function RequireChecksRowsV2({
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
    <div className="mt-6">
      <Eyebrow>Required controls</Eyebrow>
      <p className="mt-2 type-body-sm text-slate-400">Doctor check ids that must not be failing.</p>
      {checks.length === 0 ? (
        <p className="mt-3 type-body-sm text-slate-400">
          No required controls. Add a doctor check id to fail the gate when that control is reported failing.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-divider border-y border-divider">
          {checks.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 py-2">
              <code className="min-w-0 truncate font-mono type-body-sm text-slate-200">{id}</code>
              <GhostAction onClick={() => onRemove(id)} aria-label={`Remove required control ${id}`}>
                Remove
              </GhostAction>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <FormField label="Doctor check id" htmlFor="gov-require-check" className="min-w-0 flex-1">
          <Input
            id="gov-require-check"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="control.prepush.lint"
            disabled={atCap}
          />
        </FormField>
        <GhostAction type="submit" disabled={atCap} aria-label="Add required control">
          Add
        </GhostAction>
      </form>
    </div>
  );
}
