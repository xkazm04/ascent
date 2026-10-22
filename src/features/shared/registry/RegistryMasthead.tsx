// The registry's one statement. Figures are labeled counts. A count the view did not measure is a void, never 0.

import type { ReactNode } from "react";
import { Caption, Masthead, VoidMark, type MastheadFigure } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, hostedOnlyTotal, inRegistryTotal, registryVerdict } from "./registryModel";

function dateline(view: RegistryView, slug: string): string {
  const r = view.registry;
  if (!r) return `${slug}, no registry mapped.`;
  const freshness = r.localPath ? "local checkout" : `webhook ${r.webhookHealthy ? "ok" : "unconfirmed"}`;
  const when = r.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never";
  const sha = r.lastIndexSha ? r.lastIndexSha.slice(0, 7) : "not measured";
  return `${r.fullName}, ${r.canonical ? "canonical" : "secondary"}, ${MODE_LABEL[r.mode]}. Indexed ${when}. ${sha}. ${freshness}. Telemetry ${SINK_LABEL[r.telemetrySink]}.`;
}

function figures(view: RegistryView): MastheadFigure[] {
  if (view.status === "unmapped") {
    return [
      { label: "Hosted artifacts", value: hostedOnlyTotal(view).toLocaleString(), detail: "live in ascent, nothing mapped" },
      { label: "Repos you can map", value: String(view.candidates.length), detail: "visible to the installation" },
    ];
  }
  const laneRead = Boolean(view.registry?.lastIndexedAt);
  const pointingN = view.fleet.reposPointing;
  const measured = typeof pointingN === "number";
  const total = view.fleet.reposTotal;
  const tone = measured && total > 0 && pointingN >= total ? "good" : measured ? "watch" : undefined;
  return [
    { label: "Indexed artifacts", value: inRegistryTotal(view).toLocaleString(), detail: "skills, practices, memory" },
    {
      label: "Repos pointing",
      value: measured ? `${pointingN}/${total}` : <VoidMark subject="Repos pointing" label="not measured" />,
      tone,
      detail: measured ? "carry the pointer" : undefined,
    },
    {
      label: "Invokes, 30 days",
      value: laneRead ? view.telemetry.invokes30d.toLocaleString() : <VoidMark subject="Invokes, 30 days" label="not measured" />,
      detail: laneRead ? "registry sink" : undefined,
    },
  ];
}

export function RegistryMasthead({ view, slug, aside }: { view: RegistryView; slug: string; aside?: ReactNode }) {
  const identified = view.status !== "unmapped";
  return (
    <div className="space-y-3">
      <Masthead
        eyebrow="The registry"
        statement={identified ? "Your way of working, in a" : "Put your way of working in a"}
        named="repo you own"
        lede={registryVerdict(view)}
        figures={figures(view)}
        aside={aside}
        pattern="spectral"
      />
      <Caption>{dateline(view, slug)}</Caption>
    </div>
  );
}
