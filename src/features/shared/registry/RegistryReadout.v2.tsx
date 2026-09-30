// Load-bearing facts as words. Missing shas and unread lanes are voids, never a zero and never a dash.

import { Frame, KeyValue, MonoPath, SectionHead, VoidMark, type KeyValueItem } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL } from "./registryModel";

function sha(value: string | null | undefined, subject: string) {
  if (!value) return <VoidMark subject={subject} label="not measured" />;
  return <MonoPath>{value.slice(0, 7)}</MonoPath>;
}

function items(view: RegistryView): KeyValueItem[] {
  const r = view.registry;
  const laneRead = Boolean(r?.lastIndexedAt);
  const direct = view.telemetry.invokesDirect30d;
  const reporting = view.telemetry.reposReporting;
  return [
    { key: "Repo", value: r ? <MonoPath>{r.fullName}</MonoPath> : <VoidMark subject="Repo" label="not measured" /> },
    { key: "Branch", value: r?.defaultBranch ? <MonoPath>{r.defaultBranch}</MonoPath> : <VoidMark subject="Branch" label="not measured" /> },
    { key: "Mode", value: r ? MODE_LABEL[r.mode] : <VoidMark subject="Mode" label="not measured" /> },
    { key: "Canonical", value: r ? (r.canonical ? "yes" : "no") : <VoidMark subject="Canonical" label="not measured" /> },
    { key: "Index sha", value: sha(r?.lastIndexSha, "Index sha") },
    { key: "Indexed", value: r?.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never" },
    { key: "Catalog sha", value: sha(r?.catalogSha, "Catalog sha") },
    { key: "Webhook", value: r ? (r.webhookHealthy ? "healthy" : "unconfirmed") : <VoidMark subject="Webhook" label="not measured" /> },
    { key: "Telemetry sink", value: SINK_LABEL[view.telemetry.sink] },
    {
      key: "Reporting",
      value: laneRead ? String(reporting) : <VoidMark subject="Reporting" label="not measured" />,
    },
    {
      key: "Invokes, 30 days, registry",
      value: laneRead ? view.telemetry.invokes30d.toLocaleString() : <VoidMark subject="Invokes, 30 days" label="not measured" />,
    },
    {
      key: "Invokes, 30 days, direct",
      value: typeof direct === "number" ? direct.toLocaleString() : <VoidMark subject="Invokes, 30 days, direct" label="not measured" />,
    },
    { key: "Lessons", value: String(view.counts.lessons) },
  ];
}

export function RegistryReadout({ view }: { view: RegistryView }) {
  return (
    <Frame>
      <SectionHead eyebrow="Readouts" title="The repo," named="as facts." lede="A missing sha or an unread lane stays not measured." />
      <KeyValue layout="stack" items={items(view)} className="mt-4" />
    </Frame>
  );
}
