// Org dashboard "Knowledge base" tab — the Reference Knowledge Bundles the mapped registry publishes
// (`knowledge/<domain>/`), at overview level only.
//
// SERVER component, filename PINNED as KnowledgeTab.tsx — same shell contract as RegistryTab /
// SkillsTab / MemoryTab (docs/ORG-TABS-REFACTOR.md). One data source (`getKnowledgeView`), so the
// single <Suspense> at the OrgTabChunks call site is enough and no boundary is added here.
//
// Takes NO `sp`: the tab reads nothing from the URL. It is deliberately terminal — no drill-down,
// no per-subject route. A bundle is ~1,000 markdown documents and the thing worth answering here is
// "what do we publish, and how much of it", not "read me a golden path": that is what a clone and an
// editor are for, and pretending otherwise would build a second, worse document browser.
//
// Sits LAST in the `Shared` group: the other three tabs are artifacts the registry distributes to
// every repo, and this one is the fourth — but it is the only one with no per-repo adoption state,
// so it reads as reference rather than as fleet posture.

import { Kicker } from "@/components/ui";
import { getKnowledgeView } from "@/lib/org/knowledge-view";

import { KnowledgeLedger } from "./KnowledgeLedger";

function Notice({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-divider bg-ink px-6 py-8">
      <Kicker tone="muted">Knowledge base</Kicker>
      <h2 className="mt-2 text-lg font-medium text-slate-100">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">{body}</p>
    </div>
  );
}

export async function KnowledgeTab({ slug }: { slug: string }) {
  const view = await getKnowledgeView(slug);

  if (view.status === "unmapped") {
    return (
      <Notice
        title="No registry mapped yet"
        body={
          <>
            Knowledge bundles live in the org&apos;s registry repo under{" "}
            <span className="font-mono text-xs text-slate-300">knowledge/&lt;domain&gt;/</span>. Map the registry
            first — the Registry tab is the onboarding step this one depends on.
          </>
        }
      />
    );
  }

  if (view.status === "error") {
    return (
      <Notice
        title="The last index attempt failed"
        body={
          <>
            {view.error?.message ?? "No detail was recorded."} Counts below would be stale, so none are shown —
            an overview that renders old numbers without saying so is worse than one that renders none.
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
            <span className="font-mono text-xs text-slate-300">{view.registry?.fullName}</span> is mapped and indexed,
            but carries no <span className="font-mono text-xs text-slate-300">knowledge/</span> lane. A bundle is a
            directory of markdown plus a generated index; adding one is a pull request like any other.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {view.provisional ? (
        <div className="rounded-2xl border border-divider bg-ink px-5 py-4">
          <Kicker tone="muted">Preview</Kicker>
          <p className="mt-1 text-sm text-slate-400">
            These counts are the registry&apos;s real contents read once by hand, not an index pass — the
            indexer walks skills, practices and memory today and does not parse{" "}
            <span className="font-mono text-xs text-slate-300">knowledge/**</span> yet. Shape is final;
            freshness is not.
          </p>
        </div>
      ) : null}
      <KnowledgeLedger view={view} />
    </div>
  );
}
