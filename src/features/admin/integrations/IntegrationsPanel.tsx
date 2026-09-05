// The Integrations module: a fidelity explainer (how each provider's spend reaches a repo) tied back
// to the /delivery views, then one card per provider. Every available provider renders its connect
// surface inline — Claude Code the OTel push panel, Copilot the admin-pull sync — and a `planned`
// provider renders none. Server-safe: only the two setup panels are client components.
//
// The dispatch reads the REGISTRY ROW (`connectKind` + `status`), never a literal id. It used to test
// `p.id === "claude-code"`, which meant Copilot — declared available + admin-pull in providers.ts
// since W3b, with a finished owner-gated sync route behind it — showed a green "Available" badge and
// offered no way to act on it. Keying on the row means adding a provider is a data change: give it a
// status and a connect kind and the right surface appears, or none does.

import Link from "next/link";
import { Surface, Kicker } from "@/components/ui";
import { PROVIDERS, FIDELITY_META, type Fidelity, type ProviderDef } from "@/lib/integrations/providers";
import type { ProviderIngestStatus } from "@/lib/db";
import { orgTabHref } from "@/lib/org/orgTabs";
import { ProviderCard } from "./ProviderCard";
import { ClaudeCodeSetup } from "./ClaudeCodeSetup";
import { CopilotSetup } from "./CopilotSetup";

export function IntegrationsPanel({
  slug,
  ingestToken,
  ingestPath,
  statuses = [],
}: {
  slug: string;
  ingestToken: string;
  ingestPath: string;
  /** Per-source delivery status (AiUsageRecord.updatedAt) — what each provider has actually landed. */
  statuses?: ProviderIngestStatus[];
}) {
  return (
    <div className="space-y-5">
      <Surface radius="xl" className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <Kicker tone="accent">How spend maps to repos</Kicker>
            <p className="mt-1.5 type-body-sm text-slate-300">
              Each connected provider feeds the{" "}
              <Link href={orgTabHref(slug, "delivery")} className="text-accent transition hover:text-white">
                AI delivery
              </Link>{" "}
              views at the best fidelity it supports. Until one is connected, those views run on a simulated placeholder.
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {(Object.keys(FIDELITY_META) as Fidelity[]).map((f) => (
              <li key={f} className="flex items-baseline gap-2 type-caption">
                <span aria-hidden className="translate-y-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: FIDELITY_META[f].hex }} />
                <span className="shrink-0" style={{ color: FIDELITY_META[f].hex }}>
                  {FIDELITY_META[f].label}
                </span>
                <span className="text-slate-500">: {FIDELITY_META[f].note}</span>
              </li>
            ))}
          </ul>
        </div>
      </Surface>

      <div className="space-y-4">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} status={statuses.find((s) => s.source === p.id) ?? null}>
            {connectSurface(p, { slug, ingestToken, ingestPath })}
          </ProviderCard>
        ))}
      </div>
    </div>
  );
}

/** The connect surface a provider row asks for. `planned` gets none; the rest dispatch on the
 *  mechanism the row declares, so the switch is exhaustive over `ConnectKind` by type — a new kind is
 *  a compile error here rather than a card that silently offers nothing.
 *
 *  Called as a FUNCTION, not rendered as `<ConnectSurface/>`: a component element is always truthy,
 *  so a planned provider would hand ProviderCard a non-null child and draw an empty hairline block
 *  under its card. Returning the node itself keeps `null` meaning "no connect surface". */
function connectSurface(
  provider: ProviderDef,
  { slug, ingestToken, ingestPath }: { slug: string; ingestToken: string; ingestPath: string },
): React.ReactNode {
  if (provider.status !== "available") return null;
  switch (provider.connectKind) {
    case "otel-push":
      return <ClaudeCodeSetup slug={slug} ingestToken={ingestToken} ingestPath={ingestPath} />;
    case "admin-pull":
      return <CopilotSetup slug={slug} />;
  }
}
