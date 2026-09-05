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
//
// The fixtures themselves are loaded with a dynamic `import()` at the moment one is chosen. They are
// sample data for an affordance most viewers never touch; a static import shipped all of it to every
// visitor of the page.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { DeveloperCompanion } from "./DeveloperCompanion";
import { DEVELOPER_PREVIEW_STATES, type DeveloperView } from "@/lib/org/developer-view";

/** True when the REAL view has nothing of the developer's own in it — the invitation state. */
function isBlank(view: DeveloperView): boolean {
  return !view.activity && !view.profile.sharedAt && view.moves.length === 0 && view.myRepos.length === 0;
}

const tabClass = (active: boolean) =>
  `focus-ring rounded-md px-2.5 py-1.5 type-mono-sm transition-colors ${
    active ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"
  }`;

export function DeveloperHome({ view, slug }: { view: DeveloperView; slug: string }) {
  const [preview, setPreview] = useState<{ name: string; view: DeveloperView } | null>(null);

  async function choose(name: string | null) {
    if (name === null) {
      setPreview(null);
      return;
    }
    const { developerFixture } = await import("@/lib/org/developer-view.fixture");
    const fixture = developerFixture(name, view.login);
    setPreview(fixture ? { name, view: fixture } : null);
  }

  return (
    <div className="space-y-6">
      {isBlank(view) && (
        <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <Kicker tone="muted" className="mr-3">
              Preview as
            </Kicker>
            <button type="button" aria-pressed={preview === null} onClick={() => choose(null)} className={tabClass(preview === null)}>
              your view
            </button>
            {DEVELOPER_PREVIEW_STATES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={preview?.name === p}
                onClick={() => choose(p)}
                className={tabClass(preview?.name === p)}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="mt-2 type-body-sm text-slate-500">
            Nothing of yours has landed here yet. These are shaped examples, stamped as previews — they are not
            anyone&apos;s data, and switching away from &quot;your view&quot; never writes anything.
          </p>
        </div>
      )}

      <DeveloperCompanion view={preview?.view ?? view} slug={slug} />
    </div>
  );
}
