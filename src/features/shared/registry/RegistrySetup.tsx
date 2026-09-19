"use client";

// Step 1's real answers — CREATE a registry repo, or MAP one that already exists. Both POST to
// `/api/org/:slug/registry`; which of them renders is `visibleActions`' decision, never this file's.
// Mode (git-native vs hosted-mirror) and the telemetry sink (off / api / registry) are chosen here
// and sent on both POSTs so create and map cannot persist different closed sets.
//
// The map path opens `RegistryMapPanel`, which offers the repos ascent can already see as a picker
// before it offers a text field — the field is the fallback for a repo outside the installation, not
// the primary way in.

import { useState } from "react";
import { TextInput } from "@/components/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryView } from "@/lib/org/registry-view";
import {
  DEFAULT_SETUP_MODE,
  DEFAULT_SETUP_SINK,
  SETUP_MODE_OPTIONS,
  SETUP_SINK_OPTIONS,
  registryMapPayload,
  visibleActions,
  type SetupMode,
  type SetupSink,
} from "./registryActionRules";
import { RegistryButton, RegistryCapabilityNote, RegistryOutcomeLine } from "./RegistryActions";
import { RegistryMapPanel } from "./RegistryMapPanel";
import { RegistryPairLocalLink } from "./RegistryCapabilityNote";
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

function ChoiceRow<T extends string>({
  label,
  hint,
  testId,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  testId: string;
  value: T;
  options: readonly { value: T; label: string; title: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="type-label tracking-[0.16em] text-slate-500">{label}</legend>
      <p className="type-note text-slate-500">{hint}</p>
      <div role="radiogroup" aria-label={label} data-testid={testId} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={`focus-ring rounded-lg border px-2.5 py-1.5 type-body-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                  ? "border-accent bg-accent/15 font-medium text-white"
                  : "border-divider bg-surface/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RegistrySetupActions({ view, slug }: { view: RegistryView; slug: string }) {
  const m = useRegistryMutation();
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  const [name, setName] = useState(DEFAULT_REGISTRY_NAME);
  const [mapping, setMapping] = useState(false);
  const [mode, setMode] = useState<SetupMode>(DEFAULT_SETUP_MODE);
  const [telemetrySink, setTelemetrySink] = useState<SetupSink>(DEFAULT_SETUP_SINK);
  const choice = { mode, telemetrySink };

  if (!actions.includes("create-registry") && !actions.includes("map-existing")) {
    return <RegistryCapabilityNote view={view} slug={slug} />;
  }

  const post = (action: string, body: Record<string, unknown>) =>
    void m.run(action, `/api/org/${encodeURIComponent(slug)}/registry`, { body, describe: describeMap });

  return (
    <div className="space-y-3">
      <ChoiceRow
        label="Mode"
        hint="git-native is the default: content enters by pull request. hosted-mirror keeps ascent as the writer."
        testId="setup-mode"
        value={mode}
        options={SETUP_MODE_OPTIONS}
        onChange={setMode}
        disabled={m.pending !== null}
      />
      <ChoiceRow
        label="Telemetry sink"
        hint="off until you opt in. api is sink A (token, may name a repo). registry is sink B (usage/ in this repo, no token)."
        testId="setup-sink"
        value={telemetrySink}
        options={SETUP_SINK_OPTIONS}
        onChange={setTelemetrySink}
        disabled={m.pending !== null}
      />
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("pair-local") ? <RegistryPairLocalLink slug={slug} /> : null}
        {actions.includes("create-registry") ? (
          <>
            <RegistryButton
              tone="primary"
              disabled={m.pending !== null || !name.trim()}
              onClick={() => post("create", registryMapPayload({ create: true, name: name.trim() }, choice))}
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
          onMap={(fullName) => post("map", registryMapPayload({ fullName }, choice))}
        />
      ) : null}

      {!actions.includes("create-registry") && actions.includes("map-existing") ? (
        <p className="max-w-2xl type-note text-slate-500">
          Creating the repository is not offered here: it needs an Organization account and the App&apos;s{" "}
          <span className="font-mono">administration: write</span> permission. Create it yourself on GitHub and map it above.
        </p>
      ) : null}

      <RegistryOutcomeLine m={m} />
    </div>
  );
}
