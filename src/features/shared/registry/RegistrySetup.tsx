"use client";

// Step 1's real answers — CREATE a registry repo, or MAP one that already exists. Both POST to
// `/api/org/:slug/registry`; which of them renders is `visibleActions`' decision, never this file's.
//
// The map path opens `RegistryMapPanel`, which offers the repos ascent can already see as a picker
// before it offers a text field — the field is the fallback for a repo outside the installation, not
// the primary way in.

import { useState } from "react";
import { TextInput } from "@/components/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryView } from "@/lib/org/registry-view";
import { visibleActions } from "./registryActionRules";
import { RegistryButton, RegistryCapabilityNote, RegistryOutcomeLine } from "./RegistryActions";
import { RegistryMapPanel } from "./RegistryMapPanel";
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
  const [mapping, setMapping] = useState(false);

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
        <RegistryMapPanel
          view={view}
          slug={slug}
          pending={m.pending}
          onMap={(fullName) => post("map", { fullName })}
        />
      ) : null}

      {!actions.includes("create-registry") && actions.includes("map-existing") ? (
        <p className="max-w-2xl text-xs text-slate-500">
          Creating the repository is not offered here: it needs an Organization account and the App&apos;s{" "}
          <span className="font-mono">administration: write</span> permission. Create it yourself on GitHub and map it above.
        </p>
      ) : null}

      <RegistryOutcomeLine m={m} />
    </div>
  );
}
