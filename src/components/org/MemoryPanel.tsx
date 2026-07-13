"use client";

// Shared Org Memory (Memory-as-a-Service MVP) — the browsable store: a server-filtered table (search ·
// namespace · kind · sort) over the org's memories, each row expanding to a MemoryCard. Members on a
// Team+ plan get the write form (with the Claude-CLI duplicate check); admins get archive.
//
// Filtering happens on the SERVER (?namespace=&kind=&search=&sort=) so the list stays cheap as the store
// grows — the same contract SkillsPanel uses, and the seam a future vector search slots into without
// touching this component.

import { useEffect, useRef, useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { MemoryList } from "@/components/org/MemoryPanel.List";
import { MemoryFilterBar } from "@/components/org/MemoryPanel.FilterBar";
import { MemoryAuthorForm, type MemoryFormState } from "@/components/org/MemoryPanel.AuthorForm";
import { runMemoryCheck, type CheckResponse } from "@/components/org/memoryCheck";
import type { MemoryRow, MemorySort } from "@/lib/db";

const EMPTY_FORM: MemoryFormState = {
  content: "",
  kind: "semantic",
  namespace: "",
  visibility: "shared",
  source: "",
  confidence: 1,
  tagsText: "",
};

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
}) {
  const [memories, setMemories] = useState<MemoryRow[]>(initial);
  const [namespaces, setNamespaces] = useState<string[]>(initialNamespaces);
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<MemorySort>("recent");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // write form + the write-intelligence pass
  const emptyForm: MemoryFormState = { ...EMPTY_FORM, visibility: defaultVisibility };
  const [form, setFormState] = useState<MemoryFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<CheckResponse | null>(null);
  const [supersedeId, setSupersedeId] = useState<string | null>(null);
  const checkAbort = useRef<AbortController | null>(null);

  const didMount = useRef(false);
  const setForm = (patch: Partial<MemoryFormState>) => setFormState((f) => ({ ...f, ...patch }));

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ org: slug, sort });
      if (namespace) params.set("namespace", namespace);
      if (kind) params.set("kind", kind);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/org/memory?${params.toString()}`);
      if (res.ok) {
        const body = (await res.json()) as { memories: MemoryRow[]; namespaces: string[] };
        setMemories(body.memories ?? []);
        setNamespaces(body.namespaces ?? []);
      }
    } catch {
      /* keep the current list on a transient fetch error */
    } finally {
      setLoading(false);
    }
  }

  // Re-query the server when a filter changes (debounced so typing doesn't spam). Skips the first run
  // so the server-rendered `initial` isn't immediately refetched.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, namespace, kind, sort]);

  // A check outlives the click that started it; abort it if the panel unmounts so the spawned CLI dies.
  useEffect(() => () => checkAbort.current?.abort(), []);

  /** Step 1 — ask whether this memory is novel, a duplicate, or a correction. Never blocks the save. */
  async function check() {
    checkAbort.current?.abort();
    const ac = new AbortController();
    checkAbort.current = ac;
    setChecking(true);
    setError(null);
    setVerdict(null);
    setSupersedeId(null);
    try {
      const v = await runMemoryCheck(
        { org: slug, content: form.content, kind: form.kind, namespace: form.namespace || undefined },
        ac.signal,
      );
      setVerdict(v);
      // Pre-select the strongest match only when the pass actually recommends replacing it; a mere
      // "related" verdict must not arm a destructive supersede behind an unread radio button.
      if (v.recommendation === "supersede" && v.duplicates[0]) setSupersedeId(v.duplicates[0].id);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "The duplicate check failed.");
      }
    } finally {
      if (checkAbort.current === ac) checkAbort.current = null;
      setChecking(false);
    }
  }

  function cancelCheck() {
    checkAbort.current?.abort();
    setChecking(false);
  }

  /** Step 2 — write. `supersedeId` (when chosen) retires the memory this one corrects, atomically. */
  async function save() {
    if (!form.content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tags = form.tagsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
      const res = await fetch("/api/org/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          content: form.content,
          kind: form.kind,
          namespace: form.namespace || undefined,
          visibility: form.visibility,
          source: form.source || undefined,
          confidence: form.confidence,
          tags,
          supersedeId: supersedeId ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed.");
      setFormState(emptyForm);
      setVerdict(null);
      setSupersedeId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    // DELETE is admin-gated; the control only renders for admins, but still check res.ok + roll back so
    // a failure can't make a memory vanish from the UI while it survives in the DB.
    const prev = memories;
    setError(null);
    setMemories((m) => m.filter((x) => x.id !== id));
    const res = await fetch(`/api/org/memory/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setMemories(prev);
      setError(
        ((await res?.json().catch(() => ({}))) as { error?: string })?.error ??
          "Couldn't archive the memory (admins only).",
      );
    }
  }

  const filtered = Boolean(search || namespace || kind);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Shared Org Memory"
        description="What your organization knows — decisions, findings and procedures that outlive the session they were learned in. Write once; every member (and their agents) can recall it. New writes are checked against what's already stored, so a correction replaces the memory it fixes instead of sitting beside it."
      />

      <MemoryFilterBar
        search={search}
        setSearch={setSearch}
        namespace={namespace}
        setNamespace={setNamespace}
        kind={kind}
        setKind={setKind}
        sort={sort}
        setSort={setSort}
        kinds={kinds}
        namespaces={namespaces}
      />

      <div className="mt-4">
        {memories.length === 0 ? (
          <p className="text-base text-slate-500">
            {loading
              ? "Loading…"
              : filtered
                ? "No memories match your filters."
                : "Nothing remembered yet — record the org's first durable memory below."}
          </p>
        ) : (
          <MemoryList
            memories={memories}
            expanded={expanded}
            setExpanded={setExpanded}
            viewerLogin={viewerLogin}
            isAdmin={isAdmin}
            onArchive={archive}
          />
        )}
      </div>

      <MemoryAuthorForm
        canWrite={canWrite}
        planAllowed={planAllowed}
        kinds={kinds}
        namespaces={namespaces}
        form={form}
        setForm={setForm}
        busy={busy}
        checking={checking}
        verdict={verdict}
        supersedeId={supersedeId}
        setSupersedeId={setSupersedeId}
        onCheck={check}
        onCancelCheck={cancelCheck}
        onDismissVerdict={() => {
          setVerdict(null);
          setSupersedeId(null);
        }}
        onSave={save}
      />
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
