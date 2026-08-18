"use client";

// The Developer route's client root (docs/REGISTRY-AND-CARE-IMPL.md §5.3).
//
// ROUTING INSIDE THE MODULE IS REACT STATE, NOT SEARCH PARAMS. The old prototype selected fixtures
// with `?demo=`, which made a preview a shareable URL and a bookmarkable lie. The whole switching
// surface — today just "preview as", tomorrow section focus and board filters — lives in `useState`
// here; the server hands down ONE real view model and never reads a demo param.
//
// The preview control is a dev/preview affordance and appears ONLY while the real view has nothing to
// render (no attributed activity, nothing shared). The moment a developer's own data exists, the
// control disappears rather than offering to overwrite what they are looking at.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { DeveloperCompanion } from "./DeveloperCompanion";
import { DEVELOPER_PREVIEW_STATES, developerFixture } from "@/lib/org/developer-view.fixture";
import type { DeveloperView } from "@/lib/org/developer-view";

/** True when the REAL view has nothing of the developer's own in it — the invitation state. */
function isBlank(view: DeveloperView): boolean {
  return !view.activity && !view.profile.sharedAt && view.moves.length === 0 && view.myRepos.length === 0;
}

export function DeveloperHome({ view, slug }: { view: DeveloperView; slug: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const shown = (preview ? developerFixture(preview, view.login) : null) ?? view;

  return (
    <div className="space-y-6">
      {isBlank(view) && (
        <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <Kicker tone="muted" className="mr-3">
              Preview as
            </Kicker>
            <button
              type="button"
              aria-pressed={preview === null}
              onClick={() => setPreview(null)}
              className={`focus-ring rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors ${
                preview === null ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"
              }`}
            >
              your view
            </button>
            {DEVELOPER_PREVIEW_STATES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={preview === p}
                onClick={() => setPreview(p)}
                className={`focus-ring rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors ${
                  preview === p ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Nothing of yours has landed here yet. These are shaped examples, stamped as previews — they are not
            anyone&apos;s data, and switching away from &quot;your view&quot; never writes anything.
          </p>
        </div>
      )}

      <DeveloperCompanion view={shown} slug={slug} />
    </div>
  );
}
