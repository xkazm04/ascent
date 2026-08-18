"use client";

// Shared Org Memory (Memory-as-a-Service MVP) — the browsable store: a server-filtered table (search ·
// namespace · kind · sort) over the org's memories, each row expanding to a MemoryCard. Members on a
// Team+ plan get the write form (with the Claude-CLI duplicate check); admins get archive.
//
// Filtering happens on the SERVER (?namespace=&kind=&search=&sort=) so the list stays cheap as the store
// grows — the same contract SkillsPanel uses, and the seam a future vector search slots into without
// touching this component.
//
// State/effects live in useMemoryLibrary.ts, extracted to keep this file under the 200-LOC .tsx cap
// (docs/ORG-TABS-REFACTOR.md §3).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { MemoryList } from "@/features/shared/memory/MemoryList";
import { MemoryFilterBar } from "@/features/shared/memory/MemoryFilterBar";
import { MemoryAuthorForm } from "@/features/shared/memory/MemoryAuthorForm";
import { useMemoryLibrary } from "@/features/shared/memory/useMemoryLibrary";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow } from "@/lib/db";

export function MemoryPanel({
  slug,
  initial,
  kinds,
  namespaces: initialNamespaces,
  viewerLogin,
  canWrite,
  isAdmin,
  planAllowed,
  defaultVisibility = "shared",
  registryBase,
}: {
  slug: string;
  initial: MemoryRow[];
  kinds: readonly string[];
  namespaces: string[];
  viewerLogin: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  planAllowed: boolean;
  /** Author-form default. Personal workspaces pass "private" — an individual's notes are their own
   *  scratch by default; sharing is the deliberate act (the org default is the reverse). */
  defaultVisibility?: MemoryFormState["visibility"];
  /** Blob-URL prefix of the mapped registry, or null when nothing is mapped (which also turns the
   *  per-row origin markers off — "hosted" is only news once a registry exists). */
  registryBase: string | null;
}) {
  const m = useMemoryLibrary({ slug, initial, initialNamespaces, defaultVisibility });

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Shared Org Memory"
        description="What your organization knows: decisions, findings and procedures that outlive the session they were learned in. Write once; every member (and their agents) can recall it. New writes are checked against what's already stored, so a correction replaces the memory it fixes instead of sitting beside it."
      />

      <MemoryFilterBar
        search={m.search}
        setSearch={m.setSearch}
        namespace={m.namespace}
        setNamespace={m.setNamespace}
        kind={m.kind}
        setKind={m.setKind}
        sort={m.sort}
        setSort={m.setSort}
        kinds={kinds}
        namespaces={m.namespaces}
      />

      <div className="mt-4">
        {m.memories.length === 0 ? (
          <p className="text-base text-slate-500">
            {m.loading
              ? "Loading…"
              : m.filtered
                ? "No memories match your filters."
                : "Nothing remembered yet. Record the org's first durable memory below."}
          </p>
        ) : (
          <MemoryList
          registryBase={registryBase}
            memories={m.memories}
            expanded={m.expanded}
            setExpanded={m.setExpanded}
            viewerLogin={viewerLogin}
            isAdmin={isAdmin}
            onArchive={m.archive}
          />
        )}
      </div>

      <MemoryAuthorForm
        canWrite={canWrite}
        planAllowed={planAllowed}
        kinds={kinds}
        namespaces={m.namespaces}
        form={m.form}
        setForm={m.setForm}
        busy={m.busy}
        checking={m.checking}
        verdict={m.verdict}
        supersedeId={m.supersedeId}
        setSupersedeId={m.setSupersedeId}
        onCheck={m.check}
        onCancelCheck={m.cancelCheck}
        onDismissVerdict={m.dismissVerdict}
        onSave={m.save}
      />
      {m.error && <p className="mt-2 text-sm text-orange-300">{m.error}</p>}
    </Card>
  );
}
