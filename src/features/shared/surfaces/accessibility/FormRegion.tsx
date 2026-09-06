"use client";

// name-and-description-wiring: the accessible name is COMPUTED over a precedence chain, and the form
// shows which source is naming each control — read from the DOM after every commit, never assumed.
// Switch the title's naming from a real label to a placeholder and watch the visible identity vanish
// the moment you type. Submit empty: the field is marked invalid, its described-by chain gains the
// error, and the error is voiced through the announcer — attached AND delivered, not merely red.

import { useEffect, useRef, useState } from "react";
import { computeDescription, computeName } from "./a11yProbe";
import type { Politeness } from "./a11yHooks";
import { BTN, BTN_ON, IconButton, Region } from "./sceneParts";

const INSPECTED = ["a11y-title", "a11y-save", "a11y-delete"] as const;

export function FormRegion({ rowId, announce }: { rowId: string; announce: (text: string, p?: Politeness) => void }) {
  const [title, setTitle] = useState("");
  const [nameBy, setNameBy] = useState<"label" | "placeholder">("label");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);

  // The inspector reads the computed name and description off the live DOM after each commit and
  // writes them into its cells — a post-commit DOM write, so inspecting cannot cause a render.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const id of INSPECTED) {
      const el = root.querySelector<HTMLElement>(`#${id}`);
      const cell = root.querySelector<HTMLElement>(`[data-inspect-for="${id}"]`);
      if (!el || !cell) continue;
      const { name, source } = computeName(el);
      const desc = computeDescription(el);
      cell.textContent = `${name || "(nameless)"} <- ${source}${desc ? ` · describedby: ${desc}` : ""}`;
      cell.setAttribute("data-name", name);
      cell.setAttribute("data-source", source);
    }
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      const msg = "Title is required.";
      setError(msg);
      announce(msg, "assertive"); // blocks the user's current act: assertive, by the form's policy
      return;
    }
    setError(null);
    announce(`Saved ${title.trim()}.`);
  };

  const describedBy = ["a11y-title-hint", error ? "a11y-title-error" : null].filter(Boolean).join(" ");

  return (
    <Region technique="name-and-description-wiring" title="The name is computed — wire the chain" note="Know which source names each control. Errors join the described-by chain and are voiced, not just painted red.">
      <form ref={rootRef} onSubmit={submit} noValidate className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Name the title field by">
          <span className="type-caption text-slate-500">name by:</span>
          {(["label", "placeholder"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={nameBy === k} className={nameBy === k ? BTN_ON : BTN} onClick={() => setNameBy(k)}>
              {k}
            </button>
          ))}
        </div>
        <div>
          {nameBy === "label" ? (
            <label htmlFor="a11y-title" className="block type-caption text-slate-400">
              Title
            </label>
          ) : (
            <span className="block type-caption text-danger">{title ? "visible label: none — it was the placeholder, and you typed over it" : "visible label: the placeholder (until you type)"}</span>
          )}
          <p id="a11y-title-hint" className="type-caption text-slate-500">
            Verb first, under 60 characters.
          </p>
          <input
            id="a11y-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={nameBy === "placeholder" ? "Title" : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="focus-ring mt-1 w-full rounded-md border border-divider bg-surface px-2 py-1 type-body-sm text-slate-200"
          />
          {error ? (
            <p id="a11y-title-error" className="mt-1 type-caption text-danger" data-form-error>
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* label-in-name: the visible label is the authority; the accessible name BEGINS with it. */}
          <button id="a11y-save" type="submit" aria-label={`Save, follow-up ${rowId}`} className={BTN}>
            Save
          </button>
          <IconButton id="a11y-delete" label={`Delete follow-up ${rowId}`} glyph="x" onClick={() => announce(`Deleted follow-up ${rowId}.`)} />
        </div>
        {/* The inspector lives inside the form so the same root query reaches controls and cells. */}
        <dl className="mt-3 space-y-1 type-caption">
          {INSPECTED.map((id) => (
            <div key={id} className="flex flex-wrap items-baseline gap-2">
              <dt className="text-slate-500">{id.replace("a11y-", "")}</dt>
              <dd className="text-slate-300" data-inspect-for={id} />
            </div>
          ))}
        </dl>
      </form>
    </Region>
  );
}
