// The Integrations module: a fidelity explainer (how each provider's spend reaches a repo) tied back
// to the /delivery views, then one card per provider. Claude Code (available) renders its OTel connect
// surface inline; Copilot + OpenAI render as "planned". Server-safe — only the Claude Code setup panel
// is a client component.

import Link from "next/link";
import { Surface, Kicker } from "@/components/ui";
import { PROVIDERS, FIDELITY_META, type Fidelity } from "@/lib/integrations/providers";
import { ProviderCard } from "./ProviderCard";
import { ClaudeCodeSetup } from "./ClaudeCodeSetup";

export function IntegrationsPanel({
  slug,
  ingestToken,
  ingestPath,
}: {
  slug: string;
  ingestToken: string;
  ingestPath: string;
}) {
  return (
    <div className="space-y-5">
      <Surface radius="xl" className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <Kicker tone="accent">How spend maps to repos</Kicker>
            <p className="mt-1.5 text-sm text-slate-300">
              Each connected provider feeds the{" "}
              <Link href={`/org/${slug}/delivery`} className="text-accent transition hover:text-white">
                AI delivery
              </Link>{" "}
              views at the best fidelity it supports. Until one is connected, those views run on a simulated placeholder.
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {(Object.keys(FIDELITY_META) as Fidelity[]).map((f) => (
              <li key={f} className="flex items-baseline gap-2 font-mono text-xs">
                <span aria-hidden className="translate-y-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: FIDELITY_META[f].hex }} />
                <span className="shrink-0" style={{ color: FIDELITY_META[f].hex }}>
                  {FIDELITY_META[f].label}
                </span>
                <span className="text-slate-500">— {FIDELITY_META[f].note}</span>
              </li>
            ))}
          </ul>
        </div>
      </Surface>

      <div className="space-y-4">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p}>
            {p.id === "claude-code" ? <ClaudeCodeSetup ingestToken={ingestToken} ingestPath={ingestPath} /> : null}
          </ProviderCard>
        ))}
      </div>
    </div>
  );
}
