"use client";

// Prism library. The same useMemoryLibrary hook as Altimeter owns filters, the write form, the
// duplicate check and archive. Which row is open lives in the URL hash.
import { Frame, SectionHead } from "@/components/kit";
import { useMemoryLibrary } from "./useMemoryLibrary";
import { useMemoryScene } from "./useMemoryScene";
import { MemoryTrustV2 } from "./MemoryTrust.v2";
import { MemoryFilterV2 } from "./MemoryFilter.v2";
import { MemoryRowsV2 } from "./MemoryRows.v2";
import { MemoryAuthorFormV2 } from "./MemoryAuthorForm.v2";
import { MemoryNote } from "./MemoryNote";
import type { MemoryFormState } from "./MemoryTypes";
import type { MemoryRow } from "@/lib/db";

const EMPTY =
  "Nothing remembered yet. This is what your organization knows: decisions, findings and procedures that outlive the session they were learned in. Write one below and every member, and their agents, can recall it.";

export function MemoryPanelV2({
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
  defaultVisibility?: MemoryFormState["visibility"];
  registryBase: string | null;
}) {
  const m = useMemoryLibrary({ slug, initial, initialNamespaces, defaultVisibility });
  const [sceneId, setScene] = useMemoryScene();

  function archive(id: string) {
    void m.archive(id);
    if (sceneId === id) setScene(null);
  }

  return (
    <Frame aria-label="Shared org memory">
      <SectionHead
        eyebrow="Library"
        title="Shared org"
        named="memory"
        lede="Confidence runs from 0 to 1. The rows below are what this filter returns."
      />
      <MemoryTrustV2 memories={m.memories} loading={m.loading} />
      <div className="mt-5">
        <MemoryFilterV2
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
      </div>
      <div className="mt-5">
        {m.listError ? (
          <p role="alert" data-list-read-error className="type-body text-orange-300">{m.listError}</p>
        ) : m.memories.length === 0 && !sceneId ? (
          <p className="type-body text-slate-400">{m.loading ? "Loading…" : m.filtered ? "No memories match your filters." : EMPTY}</p>
        ) : (
          <MemoryRowsV2
            memories={m.memories}
            sceneId={sceneId}
            onOpen={setScene}
            viewerLogin={viewerLogin}
            isAdmin={isAdmin}
            onArchive={archive}
            canWrite={canWrite}
            onCorrect={m.startCorrection}
            registryBase={registryBase}
          />
        )}
      </div>
      <MemoryAuthorFormV2
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
        correcting={m.correcting}
        onCancelCorrection={m.cancelCorrection}
      />
      {m.error && <MemoryNote kind="risk">{m.error}</MemoryNote>}
    </Frame>
  );
}
