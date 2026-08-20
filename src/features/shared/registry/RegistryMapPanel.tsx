"use client";

// The "map an existing repo" panel — the picker of what ascent can already see, the owner/repo field
// for everything else, and the one button that POSTs whichever of them produced the value.
//
// Extracted from RegistrySetup so that file stays the orchestrator (the 200-LOC cap under
// src/features/**). Behavior of the field + button is unchanged; the picker above them is new.

import { useState } from "react";
import { TextInput } from "@/components/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryView } from "@/lib/org/registry-view";
import { EXAMPLE_REGISTRY, isFullName } from "./registryActionRules";
import { RegistryButton } from "./RegistryActions";
import { RegistryRepoPicker } from "./RegistryRepoPicker";
import { useRegistryRepoOptions } from "./useRegistryRepoOptions";

export function RegistryMapPanel({
  view,
  slug,
  pending,
  onMap,
}: {
  view: RegistryView;
  slug: string;
  /** The mutation's `pending` key — the field and button disable on any call in flight. */
  pending: string | null;
  onMap: (fullName: string) => void;
}) {
  // Starts EMPTY, not pre-filled with `<slug>/ai-registry`. With a picker above it, a seeded value
  // would render as "selected · acme/ai-registry" for a repo nobody chose and that may not exist —
  // the placeholder proposes the same name without asserting it was picked.
  const [fullName, setFullName] = useState("");
  // The panel only renders while open, so mounting IS the signal to read the listing.
  const options = useRegistryRepoOptions({ slug, enabled: true, seed: view.candidates });
  const valid = isFullName(fullName);

  return (
    <div className="space-y-3 rounded-xl border border-divider bg-surface/40 px-4 py-3">
      <RegistryRepoPicker options={options} value={fullName} onPick={setFullName} />

      <div className="space-y-2">
        <label className="block font-mono text-xs uppercase tracking-[0.16em] text-slate-500" htmlFor="registry-full-name">
          owner / repo
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72">
            <TextInput
              id="registry-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={`${slug}/${DEFAULT_REGISTRY_NAME}`}
              aria-invalid={fullName.trim() !== "" && !valid}
            />
          </div>
          <RegistryButton
            tone="primary"
            disabled={!valid || pending !== null}
            onClick={() => onMap(fullName.trim())}
            title="Maps this repository and opens the scaffold PR if it is not a registry yet"
          >
            {pending === "map" ? "Mapping…" : "Map repository"}
          </RegistryButton>
        </div>
        <p className="text-xs text-slate-500">
          {valid
            ? "Ascent maps it, then opens one PR adding the v1 layout — unless the repo is already a registry, in which case it is mapped as-is."
            : `Enter it as owner/repo — for example ${EXAMPLE_REGISTRY}.`}
        </p>
      </div>
    </div>
  );
}
