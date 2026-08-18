"use client";

// Step 1's real answers — CREATE a registry repo, or MAP one that already exists. Both POST to
// `/api/org/:slug/registry`; which of them renders is `visibleActions`' decision, never this file's.
//
// "Stay hosted" is still a first-class answer and is still stated — but as PROSE, because it has no
// endpoint: staying hosted is precisely what is already happening, so a button would be a no-op
// dressed as a decision.

import { useState } from "react";
import { TextInput } from "@/components/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryView } from "@/lib/org/registry-view";
import { EXAMPLE_REGISTRY, isFullName, visibleActions } from "./registryActionRules";
import { RegistryButton, RegistryCapabilityNote, RegistryOutcomeLine } from "./RegistryActions";
import { num, str, useRegistryMutation } from "./useRegistryMutation";

/** Both POSTs return the same body; one reader so create and map can never describe it differently. */
function describeMap(d: Record<string, unknown>) {
  const fullName = str(d.fullName) ?? "the repository";
  if (d.scaffolded !== true) {
    return { message: str(d.message) ?? `${fullName} is mapped. Re-index it to read what is already there.` };
  }
  const committed = Array.isArray(d.committed) ? d.committed.length : 0;
  return {
    message: `${fullName} mapped — scaffold PR #${num(d.prNumber) ?? "?"} opened with ${committed} file${committed === 1 ? "" : "s"}. Merging it turns the repo into your registry.`,
    ...(str(d.scaffoldPrUrl) ? { href: str(d.scaffoldPrUrl)!, hrefLabel: "review PR ↗" } : {}),
  };
}

export function RegistrySetupActions({ view, slug }: { view: RegistryView; slug: string }) {
  const m = useRegistryMutation();
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  const [name, setName] = useState(DEFAULT_REGISTRY_NAME);
  const [fullName, setFullName] = useState(`${slug}/${DEFAULT_REGISTRY_NAME}`);
  const [mapping, setMapping] = useState(false);
  const valid = isFullName(fullName);

  if (actions.length === 0 || actions.includes("install-app")) {
    return <RegistryCapabilityNote view={view} slug={slug} />;
  }

  const post = (action: string, body: Record<string, unknown>) =>
    void m.run(action, `/api/org/${encodeURIComponent(slug)}/registry`, { body, describe: describeMap });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("create-registry") ? (
          <>
            <RegistryButton
              tone="primary"
              disabled={m.pending !== null || !name.trim()}
              onClick={() => post("create", { create: true, name: name.trim() })}
              title={`Creates ${slug}/${name || DEFAULT_REGISTRY_NAME} and opens the scaffold PR`}
            >
              {m.pending === "create" ? "Creating…" : `Create ${slug}/${name || DEFAULT_REGISTRY_NAME}`}
            </RegistryButton>
            <div className="w-40">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Repository name" />
            </div>
          </>
        ) : null}
        {actions.includes("map-existing") ? (
          <RegistryButton onClick={() => setMapping((p) => !p)} disabled={m.pending !== null}>
            {mapping ? "Close" : "Map an existing repo"}
          </RegistryButton>
        ) : null}
      </div>

      {mapping && actions.includes("map-existing") ? (
        <div className="space-y-2 rounded-xl border border-divider bg-surface/40 px-4 py-3">
          <label className="block font-mono text-xs uppercase tracking-[0.16em] text-slate-500" htmlFor="registry-full-name">
            owner / repo
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-72">
              <TextInput
                id="registry-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={EXAMPLE_REGISTRY}
                aria-invalid={!valid}
              />
            </div>
            <RegistryButton
              tone="primary"
              disabled={!valid || m.pending !== null}
              onClick={() => post("map", { fullName: fullName.trim() })}
              title="Maps this repository and opens the scaffold PR if it is not a registry yet"
            >
              {m.pending === "map" ? "Mapping…" : "Map repository"}
            </RegistryButton>
          </div>
          <p className="text-xs text-slate-500">
            {valid
              ? "Ascent maps it, then opens one PR adding the v1 layout — unless the repo is already a registry, in which case it is mapped as-is."
              : `Enter it as owner/repo — for example ${EXAMPLE_REGISTRY}.`}
          </p>
        </div>
      ) : null}

      {!actions.includes("create-registry") && actions.includes("map-existing") ? (
        <p className="max-w-2xl text-xs text-slate-500">
          Creating the repository is not offered here: it needs an Organization account and the App&apos;s{" "}
          <span className="font-mono">administration: write</span> permission. Create it yourself on GitHub and map it above.
        </p>
      ) : null}

      <p className="max-w-2xl text-sm text-slate-400">
        Staying hosted is a real third answer — and it needs no button, because it is what is happening now: ascent keeps
        Skills, Practices and Memory in its own tables and stays the writer.
      </p>

      <RegistryOutcomeLine m={m} />
    </div>
  );
}
