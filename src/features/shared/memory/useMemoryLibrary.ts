"use client";

// State/effects for MemoryPanel — the browsable list state, the debounced server refetch, the write
// form + duplicate-check pass, and the archive mutation. Extracted per the 200-LOC .tsx cap
// (docs/ORG-TABS-REFACTOR.md §3): this file owns no JSX so MemoryPanel.tsx stays a thin render of what
// this hook returns.

import { useEffect, useRef, useState } from "react";
import { runMemoryCheck, type CheckResponse } from "@/features/shared/memory/memoryCheck";
import { EMPTY_FORM, fetchMemoryList, postMemory } from "@/features/shared/memory/memoryLibraryApi";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow, MemorySort } from "@/lib/db";

export function useMemoryLibrary({
  slug,
  initial,
  initialNamespaces,
  defaultVisibility = "shared",
}: {
  slug: string;
  initial: MemoryRow[];
  initialNamespaces: string[];
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
      const body = await fetchMemoryList(slug, { sort, namespace, kind, search });
      if (body) {
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

  function dismissVerdict() {
    setVerdict(null);
    setSupersedeId(null);
  }

  /** Step 2 — write. `supersedeId` (when chosen) retires the memory this one corrects, atomically. */
  async function save() {
    if (!form.content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postMemory(slug, form, supersedeId);
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

  return {
    memories,
    namespaces,
    search,
    setSearch,
    namespace,
    setNamespace,
    kind,
    setKind,
    sort,
    setSort,
    expanded,
    setExpanded,
    loading,
    error,
    form,
    setForm,
    busy,
    checking,
    verdict,
    supersedeId,
    setSupersedeId,
    check,
    cancelCheck,
    dismissVerdict,
    save,
    archive,
    filtered: Boolean(search || namespace || kind),
  };
}
