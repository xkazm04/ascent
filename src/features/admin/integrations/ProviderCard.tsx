// One provider row on the Integrations page: a sigil, name, fidelity + status badges, blurb, the
// capabilities it brings, and the honest per-repo attribution note. Available providers pass their
// connect surface as children (rendered below a hairline); planned ones don't. Server-safe.

import { Surface } from "@/components/ui";
import { FIDELITY_META, type ProviderDef } from "@/lib/integrations/providers";
import { ProviderStatus } from "./ProviderStatus";
import type { ProviderIngestStatus } from "@/lib/db";

export function ProviderCard({
  provider,
  status = null,
  children,
}: {
  provider: ProviderDef;
  /** What this provider has actually delivered — null when nothing has ever arrived. */
  status?: ProviderIngestStatus | null;
  children?: React.ReactNode;
}) {
  const fid = FIDELITY_META[provider.fidelity];
  const available = provider.status === "available";
  return (
    // The row id on the card, so a test can assert WHICH card carries a connect surface rather than
    // that one exists somewhere on the page.
    <Surface className="p-5" data-provider={provider.id}>
      <div className="flex flex-wrap items-start gap-4">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono type-lede font-bold"
          style={{ backgroundColor: `${provider.accent}1a`, color: provider.accent }}
        >
          {provider.name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{provider.name}</h3>
            <span className="rounded-full border px-2 py-0.5 type-caption" style={{ borderColor: `${fid.hex}66`, color: fid.hex }} title={fid.note}>
              {fid.label}
            </span>
            {available ? (
              <span className="rounded-full border border-lime-500/40 bg-lime-500/10 px-2 py-0.5 type-caption text-lime-300">Available</span>
            ) : (
              <span className="rounded-full border border-divider px-2 py-0.5 type-caption text-slate-500">Planned</span>
            )}
          </div>
          <p className="mt-1 type-body-sm text-slate-400">{provider.blurb}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {provider.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2 type-body-sm text-slate-400">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-2 type-note text-slate-500">{provider.perRepo}</p>
          {/* The row itself, not a flag: ProviderStatus dispatches on connectKind + fidelity so its
              copy names the right next action and never calls a seats-only figure money. */}
          <ProviderStatus provider={provider} status={status} />
        </div>
      </div>
      {children && <div className="mt-4 border-t border-divider pt-4">{children}</div>}
    </Surface>
  );
}
