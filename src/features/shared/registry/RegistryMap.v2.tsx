"use client";

// Map an existing repo: the picker, then the owner/repo field, then the one POST.

import { useState } from "react";
import { FormField, Input, PrimaryAction } from "@/components/kit";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryView } from "@/lib/org/registry-view";
import { EXAMPLE_REGISTRY, isFullName } from "./registryActionRules";
import { RegistryPickerV2 } from "./RegistryPicker.v2";
import { useRegistryRepoOptions } from "./useRegistryRepoOptions";

export function RegistryMapV2({
  view,
  slug,
  pending,
  onMap,
}: {
  view: RegistryView;
  slug: string;
  pending: string | null;
  onMap: (fullName: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const options = useRegistryRepoOptions({ slug, enabled: true, seed: view.candidates });
  const valid = isFullName(fullName);
  const hint = valid
    ? "Ascent maps it, then opens one PR adding the v1 layout, unless the repo is already a registry, in which case it is mapped as-is."
    : `Enter it as owner/repo, for example ${EXAMPLE_REGISTRY}.`;
  return (
    <div className="space-y-3">
      <RegistryPickerV2 options={options} value={fullName} onPick={setFullName} />
      <FormField label="Owner / repo" htmlFor="registry-full-name" hint={hint}>
        <Input
          id="registry-full-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={`${slug}/${DEFAULT_REGISTRY_NAME}`}
          aria-invalid={fullName.trim() !== "" && !valid}
        />
      </FormField>
      <PrimaryAction disabled={!valid || pending !== null} onClick={() => onMap(fullName.trim())}>
        {pending === "map" ? "Mapping\u2026" : "Map repository"}
      </PrimaryAction>
    </div>
  );
}
