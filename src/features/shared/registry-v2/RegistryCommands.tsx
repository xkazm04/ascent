"use client";

import { useState } from "react";
import type { RegistryView } from "@/lib/org/registry-view";
import s from "./registry.module.css";

export function RegistryCommands({ view }: { view: RegistryView }) {
  const [notice, setNotice] = useState("");
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch { setNotice("Could not copy. Select and copy the command below."); }
  }
  return <details open={Boolean(view.registry)}><summary>Use in a repository <span>Developer commands</span></summary>
    <p>Run from your repository. Review changes before committing.</p>
    {[{ label: "Sync skills", value: view.howTo.syncCmd }, { label: "Install hooks", value: view.howTo.hooksCmd }, ...(view.registry ? [{ label: "Registry pointer", value: view.howTo.pointer }] : [])].map(row => <div key={row.label} className={s.command}><span>{row.label}</span><code>{row.value}</code><button onClick={() => void copy(row.label, row.value)} aria-label={`Copy ${row.label.toLowerCase()}`}>Copy</button></div>)}
    <p className={s.hint}>{view.registry ? "Add the registry pointer to .ai/manifest.yaml. Propose registry changes through a pull request." : "Connect a registry to get its manifest pointer."}</p>
    <p role="status" className={s.hint}>{notice}</p>
  </details>;
}
