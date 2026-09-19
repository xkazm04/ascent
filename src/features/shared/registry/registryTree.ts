// The registry repo rendered as a file map — the identified panel's spine. Pure; split out of
// registryModel.ts, which re-exports it.

import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, inRegistryTotal, shortSha } from "./registryModel";

export type TreeNode = { path: string; kind: "dir" | "file"; count?: number; note: string; generated?: boolean };

export function registryTree(v: RegistryView): TreeNode[] {
  const c = v.counts;
  return [
    { path: ".ascent/registry.yaml", kind: "file", note: v.registry ? `${MODE_LABEL[v.registry.mode]} · telemetry ${SINK_LABEL[v.registry.telemetrySink]}` : "mode + policies" },
    { path: "catalog.json", kind: "file", count: inRegistryTotal(v), note: v.registry?.catalogSha ? `sha ${shortSha(v.registry.catalogSha)}` : "not written yet", generated: true },
    { path: "skills/", kind: "dir", count: c.skills.registry, note: c.skills.hostedOnly > 0 ? `${c.skills.hostedOnly} still hosted` : "SKILL.md + LESSONS.md" },
    { path: "practices/", kind: "dir", count: c.practices.registry, note: c.practices.hostedOnly > 0 ? `${c.practices.hostedOnly} still hosted` : "PRACTICE.md + starter/" },
    { path: "memory/", kind: "dir", count: c.memory.registry, note: c.memory.hostedOnly > 0 ? `${c.memory.hostedOnly} still hosted` : "notes + _index.md" },
    { path: "telemetry/", kind: "dir", count: v.telemetry.reposReporting, note: v.telemetry.sink === "registry" ? "counts committed here" : `sink is ${SINK_LABEL[v.telemetry.sink]}` },
    { path: "CODEOWNERS", kind: "file", note: "merging = adopting" },
  ];
}

