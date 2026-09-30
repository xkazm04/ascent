"use client";

// Step 1: create a registry repo, or map one that exists. Mode and sink go on both POSTs.

import { useState } from "react";
import { FormField, GhostAction, Input, PrimaryAction, Segmented } from "@/components/kit";
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
import { RegistryCapability, RegistryPairLink } from "./RegistryCapability.v2";
import { RegistryMapV2 } from "./RegistryMap.v2";
import { RegistryOutcome } from "./RegistryOutcome.v2";
import { num, str, useRegistryMutation } from "./useRegistryMutation";

function describeMap(d: Record<string, unknown>) {
  const fullName = str(d.fullName) ?? "the repository";
  if (d.scaffolded !== true) {
    return { message: str(d.message) ?? `${fullName} is mapped. Re-index it to read what is already there.` };
  }
  const committed = Array.isArray(d.committed) ? d.committed.length : 0;
  return {
    message: `${fullName} mapped: scaffold PR #${num(d.prNumber) ?? "?"} opened with ${committed} file${committed === 1 ? "" : "s"}. Merging it turns the repo into your registry.`,
    ...(str(d.scaffoldPrUrl) ? { href: str(d.scaffoldPrUrl)!, hrefLabel: "review PR" } : {}),
  };
}

function Choice({
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
  value: string;
  options: readonly { value: string; label: string; title: string }[];
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div data-testid={testId}>
      <FormField label={label} hint={hint}>
        <fieldset disabled={disabled} className="m-0 border-0 p-0">
          <Segmented
            label={label}
            variant="soft"
            value={value}
            onSelect={onChange}
            options={options.map((o) => ({ key: o.value, label: o.label, title: o.title }))}
          />
        </fieldset>
      </FormField>
    </div>
  );
}

export function RegistrySetupV2({ view, slug }: { view: RegistryView; slug: string }) {
  const m = useRegistryMutation();
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  const [name, setName] = useState(DEFAULT_REGISTRY_NAME);
  const [mapping, setMapping] = useState(false);
  const [mode, setMode] = useState<SetupMode>(DEFAULT_SETUP_MODE);
  const [telemetrySink, setTelemetrySink] = useState<SetupSink>(DEFAULT_SETUP_SINK);
  const choice = { mode, telemetrySink };
  const pending = m.pending !== null;

  if (!actions.includes("create-registry") && !actions.includes("map-existing")) {
    return <RegistryCapability view={view} slug={slug} />;
  }

  const post = (action: string, body: Record<string, unknown>) =>
    void m.run(action, `/api/org/${encodeURIComponent(slug)}/registry`, { body, describe: describeMap });

  return (
    <div className="space-y-4">
      <Choice
        label="Mode"
        hint="git-native is the default: content enters by pull request. hosted-mirror keeps ascent as the writer."
        testId="setup-mode"
        value={mode}
        options={SETUP_MODE_OPTIONS}
        onChange={(v) => setMode(v as SetupMode)}
        disabled={pending}
      />
      <Choice
        label="Telemetry sink"
        hint="off until you opt in. api is sink A (token, may name a repo). registry is sink B (usage/ in this repo, no token)."
        testId="setup-sink"
        value={telemetrySink}
        options={SETUP_SINK_OPTIONS}
        onChange={(v) => setTelemetrySink(v as SetupSink)}
        disabled={pending}
      />
      <div className="flex flex-wrap items-end gap-2">
        {actions.includes("pair-local") ? <RegistryPairLink slug={slug} /> : null}
        {actions.includes("create-registry") ? (
          <>
            <FormField label="Repository name" htmlFor="registry-repo-name" className="w-48">
              <Input id="registry-repo-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Repository name" />
            </FormField>
            <PrimaryAction
              disabled={pending || !name.trim()}
              onClick={() => post("create", registryMapPayload({ create: true, name: name.trim() }, choice))}
            >
              {m.pending === "create" ? "Creating\u2026" : `Create ${slug}/${name || DEFAULT_REGISTRY_NAME}`}
            </PrimaryAction>
          </>
        ) : null}
        {actions.includes("map-existing") ? (
          <GhostAction onClick={() => setMapping((p) => !p)} disabled={pending}>
            {mapping ? "Close" : "Map an existing repo"}
          </GhostAction>
        ) : null}
      </div>
      {mapping && actions.includes("map-existing") ? (
        <RegistryMapV2
          view={view}
          slug={slug}
          pending={m.pending}
          onMap={(fullName) => post("map", registryMapPayload({ fullName }, choice))}
        />
      ) : null}
      {!actions.includes("create-registry") && actions.includes("map-existing") ? (
        <p className="max-w-2xl type-note text-slate-400">
          Creating the repository is not offered here: it needs an Organization account and the App&apos;s{" "}
          <span className="font-mono">administration: write</span> permission. Create it yourself on GitHub and map it above.
        </p>
      ) : null}
      <RegistryOutcome m={m} />
    </div>
  );
}
