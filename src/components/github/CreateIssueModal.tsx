"use client";

// Shared "file this as GitHub issues" gate — a source-agnostic dialog any surface can feed an
// IssueDraft (blocker docket today; roadmap items, security register, unowned repos tomorrow).
// Built on the brand Modal (app-root portal, focus trap, locked-while-filing), so this file owns
// only the issue workflow: the user reviews/edits the title + body, picks the target repos, and only
// then does anything hit GitHub — one POST /api/org/issue per selected repo, sequential, with
// per-repo status (link on success, message on failure). Issues are filed by the org's Ascent App
// installation and stamped + audit-logged with the signed-in user (see the route).

import { useEffect, useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";

export interface IssueTarget {
  name: string;
  fullName: string;
  /** Per-repo markdown appended under the shared body (e.g. this repo's report link). */
  footer?: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  labels?: string[];
  /** Short mono context line under the dialog title, e.g. "production blocker · 9 repos in view". */
  context?: string;
  targets: IssueTarget[];
}

type TargetStatus = { state: "idle" | "creating" | "done" | "error"; url?: string; number?: number; error?: string };

const FIELD_LABEL = "font-mono text-xs uppercase tracking-widest text-slate-500";

export function CreateIssueModal({ draft, onClose }: { draft: IssueDraft | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, TargetStatus>>({});
  const [running, setRunning] = useState(false);

  // (Re)arm the form whenever a new draft arrives; a fresh object per open resets prior results.
  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    setSelected(new Set(draft.targets.map((t) => t.fullName)));
    setStatus({});
    setRunning(false);
  }, [draft]);

  const targets = draft?.targets ?? [];
  const picked = targets.filter((t) => selected.has(t.fullName));
  const done = Object.values(status).some((s) => s.state === "done");
  const canFile = !running && picked.length > 0 && title.trim().length > 0;

  const toggle = (fullName: string) => {
    if (running) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  async function fileIssues() {
    setRunning(true);
    for (const t of picked) {
      setStatus((s) => ({ ...s, [t.fullName]: { state: "creating" } }));
      try {
        const res = await fetch("/api/org/issue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: t.fullName,
            title: title.trim(),
            body: t.footer ? `${body}\n\n${t.footer}` : body,
            labels: draft?.labels,
          }),
        });
        const data = (await res.json().catch(() => null)) as { url?: string; number?: number; error?: string } | null;
        setStatus((s) => ({
          ...s,
          [t.fullName]: res.ok
            ? { state: "done", url: data?.url, number: data?.number }
            : { state: "error", error: data?.error ?? `Failed (${res.status}).` },
        }));
      } catch {
        setStatus((s) => ({ ...s, [t.fullName]: { state: "error", error: "Network error." } }));
      }
    }
    setRunning(false);
  }

  return (
    <Modal open={draft !== null} onClose={onClose} locked={running} ariaLabel={`File GitHub issues: ${draft?.title ?? ""}`}>
      <ModalHeader kicker="Actions · GitHub" title="File as GitHub issues" context={draft?.context} />
      <ModalBody>
        <label className="block">
          <span className={FIELD_LABEL}>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={running || done}
            className="focus-ring mt-1 w-full rounded-lg border border-slate-700 bg-surface/40 px-3 py-2 text-base text-white disabled:opacity-60"
          />
        </label>
        <label className="mt-3 block">
          <span className={FIELD_LABEL}>Body (markdown)</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={running || done}
            rows={6}
            className="focus-ring mt-1 w-full resize-y rounded-lg border border-slate-700 bg-surface/40 px-3 py-2 font-mono text-sm text-slate-200 disabled:opacity-60"
          />
        </label>

        <div className="mt-4">
          <span className={FIELD_LABEL}>
            Repositories · {picked.length}/{targets.length}
          </span>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
            {targets.map((t) => {
              const st = status[t.fullName];
              return (
                <li key={t.fullName} className="flex items-center gap-3 text-sm">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(t.fullName)}
                      onChange={() => toggle(t.fullName)}
                      disabled={running || done}
                      className="accent-accent"
                    />
                    <span className="truncate font-mono text-slate-300">{t.name}</span>
                  </label>
                  {st?.state === "creating" && <span className="shrink-0 font-mono text-xs text-slate-500">filing…</span>}
                  {st?.state === "done" && (
                    <a href={st.url} target="_blank" rel="noreferrer" className="focus-ring shrink-0 font-mono text-xs text-accent hover:text-white">
                      #{st.number} ↗
                    </a>
                  )}
                  {st?.state === "error" && (
                    <span className="min-w-0 shrink truncate text-xs text-danger" title={st.error}>
                      {st.error}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="text-xs text-slate-500">
          Filed by the Ascent App on this org&apos;s installation, attributed to your login and audit-logged.
        </span>
        {done && !running ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white"
          >
            Close
          </button>
        ) : (
          <button
            type="button"
            onClick={fileIssues}
            disabled={!canFile}
            className="focus-ring rounded-lg bg-accent px-4 py-2 font-mono text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {running ? "Filing…" : `File ${picked.length} issue${picked.length === 1 ? "" : "s"}`}
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
