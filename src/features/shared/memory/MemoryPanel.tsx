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
import { MemoryTrust } from "@/features/shared/memory/MemoryTrust";
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
        description="confidence 0–1 · the rows listed below"
      />

      {/* FIRST SIGHT: how trusted the org's remembered knowledge actually is. The list below can
          only ever show rows; the shape of the confidence axis is the thing a reader cannot
          assemble by scrolling, and it is the axis recall ranks on. */}
      <MemoryTrust memories={m.memories} loading={m.loading} />

      <MemoryFilterBar
        search={m.search}
        setSearch={m.setSearch}
        namespace={m.namespace}
        setNamespace={m.setNamespace}
        kind={m.kind}
        setKind={m.setKind}
        source={m.source}
        setSource={m.setSource}
        sort={m.sort}
        setSort={m.setSort}
        kinds={kinds}
        namespaces={m.namespaces}
      />

      <div className="mt-4">
        {m.memories.length === 0 ? (
          // (O) The argument belongs here, where a reader has nothing to look at and a reason to act.
          <p className="type-body text-slate-500">
            {m.loading
              ? "Loading…"
              : m.filtered
                ? "No memories match your filters."
                : "Nothing remembered yet. This is what your organization knows: decisions, findings and procedures that outlive the session they were learned in. Write one below and every member — and their agents — can recall it."}
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
      {m.error && <p className="mt-2 type-body-sm text-orange-300">{m.error}</p>}
    </Card>
  );
}
