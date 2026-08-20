"use client";

// The Registry tab's preview switcher — REACT STATE, never a search param.
//
// `?demo=<state>` was the prototype affordance and it was wrong in a specific way: it made a shaped
// example a shareable, bookmarkable URL, so a link someone pasted into Slack could read as their org's
// registry. Same call as the Developer route (`DeveloperHome`): the server hands down ONE real view,
// the switching lives here, and nothing about it survives a copied link.
//
// It is offered ONLY in development (`registryPreviewEnabled()` — see the RegistryTab call site) and
// only while the real status is `unmapped`, the state that has nothing of the user's own to be
// confused with. The moment a registry is mapped the control disappears rather than offering to paint
// fiction over real data, and every previewed state is stamped as a preview.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { REGISTRY_DEMO_STATES, fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { RegistryPanel } from "./RegistryPanel";
import { RegistryPreviewContext } from "./useRegistryMutation";

const CHIP = "focus-ring rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors";

export function RegistryPreviewShell({
  slug,
  enabled,
  children,
}: {
  slug: string;
  /** True only in development AND when the REAL view is `unmapped`. False renders `children` untouched. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ? fixtureRegistryView(slug, preview) : null;

  if (!enabled) return <>{children}</>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <Kicker tone="muted" className="mr-3">
            Preview a state
          </Kicker>
          <button
            type="button"
            aria-pressed={preview === null}
            onClick={() => setPreview(null)}
            className={`${CHIP} ${preview === null ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"}`}
          >
            your registry
          </button>
          {REGISTRY_DEMO_STATES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preview === p}
              onClick={() => setPreview(p)}
              className={`${CHIP} ${preview === p ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Nothing is mapped yet, so these are shaped examples of what the tab reads once a registry exists. They are not
          your data and not anyone else&apos;s, switching between them writes nothing, and none of it is in the URL.
        </p>
      </div>

      {shown ? (
        <div className="rounded-2xl border border-warn/40 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-warn/40 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-warn">
              preview · {preview}
            </span>
            <span className="text-sm text-slate-500">
              Example data. The actions render exactly as they would, but they are inert here — clicking one sends nothing.
            </span>
          </div>
          <RegistryPreviewContext.Provider value>
            <RegistryPanel view={shown} slug={slug} />
          </RegistryPreviewContext.Provider>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
