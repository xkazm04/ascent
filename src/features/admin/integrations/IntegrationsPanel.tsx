// The Integrations module: a fidelity explainer (how each provider's spend reaches a repo) tied back
// to the /delivery views, then one card per provider. Available rows render a connect surface;
// planned rows render none. Server-safe: only ClaudeCodeSetup and CopilotSetup are client components.
//
// Status gates whether a surface appears. The panel itself is chosen per provider id (`CONNECT_SETUP`),
// not by `connectKind` alone. Kind-only dispatch was the Copilot fix (the panel used to test
// `p.id === "claude-code"`, so available Copilot offered no way to act) but it mapped every available
// admin-pull row onto CopilotSetup. OpenAI is already admin-pull and planned; available must not
// inherit Copilot's GitHub App pull.

import Link from "next/link";
import { Surface, Kicker } from "@/components/ui";
import { PROVIDERS, FIDELITY_META, CONNECT_SETUP, type Fidelity, type ProviderDef } from "@/lib/integrations/providers";
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
  providers = PROVIDERS,
}: {
  slug: string;
  ingestToken: string;
  ingestPath: string;
  /** Per-source delivery status (AiUsageRecord.updatedAt) — what each provider has actually landed. */
  statuses?: ProviderIngestStatus[];
  providers?: readonly ProviderDef[];
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
              views at the best fidelity it supports. Until one that reports COST is connected, those views have no spend layer at all: the
              money columns stay empty rather than being filled with an estimate.
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
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} status={statuses.find((s) => s.source === p.id) ?? null}>
            {connectSurface(p, { slug, ingestToken, ingestPath })}
          </ProviderCard>
        ))}
      </div>
    </div>
  );
}

/** The connect surface a provider row asks for. `planned` gets none. Available rows dispatch on
 *  `CONNECT_SETUP[id]` (total over provider ids — a new id is a compile error until it is mapped to a
 *  panel, or to `none` with a reason). `connectKind` names the mechanism; it is not the panel.
 *
 *  Called as a FUNCTION, not rendered as `<ConnectSurface/>`: a component element is always truthy,
 *  so a planned provider would hand ProviderCard a non-null child and draw an empty hairline block
 *  under its card. Returning the node itself keeps `null` meaning "no connect surface". */
function connectSurface(
  provider: ProviderDef,
  { slug, ingestToken, ingestPath }: { slug: string; ingestToken: string; ingestPath: string },
): React.ReactNode {
  if (provider.status !== "available") return null;
  const setup = CONNECT_SETUP[provider.id];
  switch (setup.panel) {
    case "claude-code":
      return <ClaudeCodeSetup slug={slug} ingestToken={ingestToken} ingestPath={ingestPath} />;
    case "copilot":
      return <CopilotSetup slug={slug} />;
    case "none":
      return <OpenAISetup reason={setup.reason} />;
  }
}

/** Explicit unshipped surface so an available openai admin-pull row cannot inherit CopilotSetup. */
function OpenAISetup({ reason }: { reason: string }) {
  return (
    <p data-testid="openai-setup" className="type-body-sm text-slate-400">
      {reason}
    </p>
  );
}
