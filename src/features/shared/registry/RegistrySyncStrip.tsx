// "Where does this content live?" — ONE answer, rendered identically at the top of Skills, Memory and
// Practices.
//
// Those three tabs are the registry's consumers. Before a registry is mapped everything they show is
// ascent's own; after it is mapped, the rows with `origin === "registry"` are a mirror of files in a
// repo the customer owns and are not ascent's to edit. A reader cannot tell those two worlds apart
// from a table of rows, so the tab has to say it — and say it the SAME way three times, which is why
// this is one component fed by one loader (`src/lib/org/registry-sync.ts`) rather than three strips
// that drift.
//
// It never blocks a tab: with nothing mapped it is a pointer, not a gate, and the tab's own content
// (hosted rows, its own empty state) renders below exactly as before.
//
// Server-safe — no hooks, no handlers.

import Link from "next/link";
import { timeAgo } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistrySync } from "@/lib/org/registry-sync";

const ARTIFACT_NOUN: Record<"skills" | "practices" | "memory", string> = {
  skills: "Skills",
  practices: "Practices",
  memory: "Memory",
};

const LINK = "font-mono text-xs text-accent transition hover:text-white";

/** The counts line — what the last index pass actually read out of the repo. */
function CountsLine({ sync }: { sync: RegistrySync }) {
  const c = sync.counts;
  return (
    <span className="font-mono text-xs text-slate-500">
      <span className="tabular-nums text-slate-300">{c.skills}</span> skills ·{" "}
      <span className="tabular-nums text-slate-300">{c.practices}</span> practices ·{" "}
      <span className="tabular-nums text-slate-300">{c.memory}</span> memory notes
      {c.lessons > 0 ? (
        <>
          {" "}
          · <span className="tabular-nums text-slate-300">{c.lessons}</span> lessons
        </>
      ) : null}
    </span>
  );
}

export function RegistrySyncStrip({
  sync,
  slug,
  artifact,
}: {
  sync: RegistrySync;
  slug: string;
  /** Which tab is asking — only used to name this tab's own noun first in the unmapped sentence. */
  artifact: "skills" | "practices" | "memory";
}) {
  const registryHref = orgTabHref(slug, "registry");

  if (!sync.mapped) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-divider bg-surface/40 px-4 py-3">
        <p className="text-sm text-slate-400">
          Nothing is backed by a registry yet — {ARTIFACT_NOUN[artifact]}, and everything beside it, lives only in ascent.
        </p>
        <Link href={registryHref} className={LINK}>
          set up the registry →
        </Link>
      </div>
    );
  }

  const indexed = sync.lastIndexedAt ? `indexed ${timeAgo(sync.lastIndexedAt)}` : "mapped, not indexed yet";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-divider bg-surface/40 px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-400">
        <span>Backed by</span>
        <a href={sync.url ?? "#"} className="font-mono text-sm text-slate-200 transition hover:text-white" target="_blank" rel="noreferrer">
          {sync.fullName}
        </a>
        <span className="font-mono text-xs text-slate-500">· {indexed} ·</span>
        <CountsLine sync={sync} />
      </p>
      <Link href={registryHref} className={LINK}>
        registry →
      </Link>
    </div>
  );
}
