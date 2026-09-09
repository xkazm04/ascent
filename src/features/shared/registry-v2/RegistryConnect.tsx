"use client";

import { useState } from "react";
import type { RegistryView } from "@/lib/org/registry-view";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import { capabilityNotice, isFullName, visibleActions } from "../registry/registryActionRules";
import { RegistryOutcomeLine } from "../registry/RegistryActions";
import { str, useRegistryMutation } from "../registry/useRegistryMutation";
import { useRegistryRepoOptions } from "../registry/useRegistryRepoOptions";
import s from "./registry.module.css";

export function RegistryConnect({ view, slug }: { view: RegistryView; slug: string }) {
  const actions = visibleActions(view.capabilities, { mapped: false });
  const [mode, setMode] = useState("map");
  const [fullName, setFullName] = useState("");
  const [name, setName] = useState<string>(DEFAULT_REGISTRY_NAME);
  const m = useRegistryMutation();
  const options = useRegistryRepoOptions({ slug, enabled: actions.includes("map-existing") && mode === "map", seed: view.candidates });
  const canMap = actions.includes("map-existing");
  const valid = mode === "map" ? isFullName(fullName) : /^[A-Za-z0-9._-]{1,100}$/.test(name.trim()) && ![".", ".."].includes(name.trim());
  function submit() {
    if (!valid || !canMap) return;
    void m.run(mode, `/api/org/${encodeURIComponent(slug)}/registry`, {
      body: mode === "map" ? { fullName: fullName.trim() } : { create: true, name: name.trim() },
      describe: (d) => ({ message: str(d.message) ?? (d.scaffolded === true ? "Registry connected. Review and merge the scaffold PR." : "Registry connected. Re-index to load its contents."), href: str(d.scaffoldPrUrl), hrefLabel: "Review scaffold PR ↗" }),
    });
  }
  return <section className={s.connect} aria-labelledby="connect-title">
    <div><span className={s.eyebrow}>Start here</span><h2 id="connect-title">Connect your source</h2><p>A repository you own.<br />Changes your team can review.</p></div>
    <div className={s.form}>
      {!canMap ? <><p>{capabilityNotice(view.capabilities, slug) ?? "An org admin can connect a registry."}</p>
        {actions.includes("install-app") && view.capabilities.installUrl ? <a className={s.primary} href={view.capabilities.installUrl}>Install GitHub App ↗</a> : <a className={s.link} href={`/org/${encodeURIComponent(slug)}?tab=integrations`}>View integrations →</a>}</> : <>
        <div className={s.switcher} aria-label="Connection method">{["map", ...(actions.includes("create-registry") ? ["create"] : [])].map(value => <button key={value} aria-pressed={mode === value} disabled={m.pending !== null} onClick={() => { setMode(value); m.reset(); }}>{value === "map" ? "Use existing" : "Create repository"}</button>)}</div>
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          {mode === "map" && options.status === "done" && options.repos.length > 0 && <label>Installed repositories<select value={options.repos.some(r => r.fullName === fullName) ? fullName : ""} onChange={e => setFullName(e.target.value)} disabled={m.pending !== null}><option value="">Choose a repository…</option>{options.repos.map(r => <option key={r.fullName} value={r.fullName}>{r.fullName}{r.private ? " · private" : ""}</option>)}</select></label>}
          {mode === "map" && options.status === "loading" && <p role="status">Loading installed repositories…</p>}
          {mode === "map" && options.status === "error" && <p role="alert">{options.message} Enter a repository below.</p>}
          {mode === "map" && options.status === "done" && !options.repos.length && <p>No installed repositories found. Enter one below.</p>}
          <label htmlFor="registry-v2-source">{mode === "map" ? "Owner / repository" : "Repository name"}</label>
          <div className={s.inputRow}><input id="registry-v2-source" value={mode === "map" ? fullName : name} placeholder={`${slug}/${DEFAULT_REGISTRY_NAME}`} disabled={m.pending !== null} aria-invalid={Boolean((mode === "map" ? fullName : name).trim()) && !valid} onChange={e => mode === "map" ? setFullName(e.target.value) : setName(e.target.value)} /><button className={s.primary} disabled={!valid || m.pending !== null}>{m.pending ? "Connecting…" : mode === "map" ? "Connect repository" : "Create & connect"}</button></div>
          <p className={s.hint}>{mode === "map" ? "Missing registry folders are proposed in a pull request." : `Creates a private repository in ${slug} and proposes the registry layout.`}</p>
        </form><RegistryOutcomeLine m={m} />
      </>}
      {view.error && <p role="alert">{view.error.message}</p>}
    </div>
  </section>;
}
