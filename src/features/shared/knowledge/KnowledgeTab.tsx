// Org dashboard "Knowledge base" tab — the registry's knowledge lane AS THE REGISTRY STRUCTURES IT
// (bundle → category → subcategory → subject) and how the fleet stands against it: one cell per
// subject × swept repo, the registry's own six-way absence vocabulary, and the dispatch flow that
// hands a repo its next act (populate → map → conform). Rebuilt 2026-09-05 (spark
// knowledge-base-rebuild); the Loom direction won the prototype round.
//
// SERVER component, filename PINNED as KnowledgeTab.tsx — same shell contract as RegistryTab /
// SkillsTab / MemoryTab (docs/ORG-TABS-REFACTOR.md). One data source (`getKnowledgeView`), so the
// single <Suspense> at the OrgTabChunks call site is enough and no boundary is added here.
//
// Reads TWO deep-link params from `sp`: `?domain=` (which bundle) and `?subject=` (the reader to
// open). Both are in `TAB_SCOPED_PARAM_KEYS`, so a tab switch clears them.
//
// Ascent never judges conformance: the consumer computes, the repo's own `/conform` writes verdicts
// into its `.ai/registry-map.json`, and the sweep reads them. This tab is a mirror with a hand.

import { Kicker } from "@/components/ui";
import { registryPreviewEnabled } from "@/lib/env";
import { getKnowledgeView } from "@/lib/org/knowledge-view";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";

import { KnowledgeLoom } from "./KnowledgeLoom";
import { KnowledgePreviewShell } from "./KnowledgePreviewShell";

type SearchParams = { [key: string]: string | string[] | undefined };

function Notice({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-divider bg-ink px-6 py-8">
      <Kicker tone="muted">Knowledge base</Kicker>
      <h2 className="mt-2 type-lede font-medium text-slate-100">{title}</h2>
      <p className="mt-2 max-w-2xl type-body-sm text-slate-400">{body}</p>
    </div>
  );
}

const one = (sp: SearchParams, key: string): string | null => {
  const v = sp[key];
  return typeof v === "string" && v ? v : null;
};

export async function KnowledgeTab({ slug, sp = {} }: { slug: string; sp?: SearchParams }) {
  const view = await getKnowledgeView(slug);

  if (view.status === "unmapped") {
    const notice = (
      <Notice
        title="No registry mapped yet"
        body={
          <>
            Knowledge bundles live in the org&apos;s registry repo under{" "}
            <span className="type-caption text-slate-300">knowledge/&lt;domain&gt;/</span>. Map the registry first — the Registry tab is
            the onboarding step this one depends on.
          </>
        }
      />
    );
    // DEVELOPMENT ONLY (`ASCENT_REGISTRY_PREVIEW`, hard-off in production): a shaped fleet a young org
    // cannot yet produce, offered only while nothing of the org's own could be confused with it.
    return registryPreviewEnabled() ? (
      <KnowledgePreviewShell slug={slug} fixture={fixtureKnowledgeView(slug)}>
        {notice}
      </KnowledgePreviewShell>
    ) : (
      notice
    );
  }

  if (view.status === "error") {
    return (
      <Notice
        title="The last index attempt failed"
        body={
          <>
            {view.error?.message ?? "No detail was recorded."} Counts below would be stale, so none are shown — an overview that renders old
            numbers without saying so is worse than one that renders none.
          </>
        }
      />
    );
  }

  if (view.status === "empty") {
    return (
      <Notice
        title="The registry publishes no bundles"
        body={
          <>
            <span className="type-caption text-slate-300">{view.registry?.fullName}</span> is mapped and indexed, but carries no{" "}
            <span className="type-caption text-slate-300">knowledge/</span> lane. A bundle is a directory of markdown plus a generated index;
            adding one is a pull request like any other.
          </>
        }
      />
    );
  }

  return <KnowledgeLoom view={view} slug={slug} initialDomain={one(sp, "domain")} initialSubject={one(sp, "subject")} />;
}
