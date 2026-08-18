"use client";

// The Registry tab's WIRED action affordances. Every button here calls a real endpoint
// (`/api/org/:slug/registry{,/index,/migrate}`), reports its `{ error, code }` inline on failure and
// `router.refresh()`es the server view on success — see `useRegistryMutation`.
//
// WHAT RENDERS IS DECIDED BY `visibleActions(view.capabilities)`, not by this file. When the App is
// unconfigured or uninstalled nothing GitHub-shaped is drawn at all — not even a repo link — because
// the repo it would point at very likely does not exist. When the viewer is not an admin the state is
// readable and the actions are simply absent, with one line saying who can do it.
//
// Two affordances the prototype drew are deliberately NOT here: "propose pointer PRs to N repos" and
// "unmap / stay hosted" have no endpoint, so they are stated as next steps in prose (RegistryHowTo,
// RegistryStepperIndex) rather than rendered as buttons that log to the console.

import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { capabilityNotice, visibleActions, type RegistryActionId } from "./registryActionRules";
import { num, str, useRegistryMutation, type RegistryMutation } from "./useRegistryMutation";
import { ARTIFACT_LABEL } from "./registryModel";

export function RegistryButton({
  children,
  onClick,
  tone = "outline",
  disabled,
  title,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "primary" | "outline";
  disabled?: boolean;
  title?: string;
  href?: string;
}) {
  const cls = `${tone === "primary" ? CTA_PRIMARY : CTA_OUTLINE} text-sm disabled:cursor-not-allowed disabled:opacity-40`;
  if (href) {
    return (
      <a href={href} title={title} className={cls} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={cls}>
      {children}
    </button>
  );
}

/** The result of the last call, said out loud next to the control that made it. Never a toast. */
export function RegistryOutcomeLine({ m, action }: { m: RegistryMutation; action?: string }) {
  const err = m.error && (!action || m.error.action === action) ? m.error : null;
  const ok = m.outcome && (!action || m.outcome.action === action) ? m.outcome : null;
  if (err) {
    return (
      <p className="rounded-xl border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn" role="status">
        {err.message}
      </p>
    );
  }
  if (!ok) return null;
  return (
    <p className="text-sm text-slate-300" role="status">
      {ok.message}
      {ok.href ? (
        <>
          {" "}
          <a href={ok.href} className="font-mono text-xs text-accent hover:text-white" target="_blank" rel="noreferrer">
            {ok.hrefLabel ?? "open ↗"}
          </a>
        </>
      ) : null}
    </p>
  );
}

/** One honest sentence instead of buttons, plus the install link when (and only when) there is one. */
export function RegistryCapabilityNote({ view, slug }: { view: RegistryView; slug: string }) {
  const notice = capabilityNotice(view.capabilities, slug);
  if (!notice) return null;
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  return (
    <div className="space-y-2">
      <p className="max-w-2xl text-sm text-slate-400">{notice}</p>
      {actions.includes("install-app") && view.capabilities.installUrl ? (
        <RegistryButton href={view.capabilities.installUrl}>Install the GitHub App ↗</RegistryButton>
      ) : null}
    </div>
  );
}

/** Indexed-state header: re-index (member floor on the route, admin floor on the flag) + the repo. */
export function RegistryHeaderActions({ view, slug }: { view: RegistryView; slug: string }) {
  const m = useRegistryMutation();
  const actions: RegistryActionId[] = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });

  function reindex() {
    void m.run("reindex", `/api/org/${encodeURIComponent(slug)}/registry/index`, {
      describe: (d) => {
        const c = (d.counts ?? {}) as Record<string, unknown>;
        const sha = str(d.headSha);
        const warnings = Array.isArray(d.warnings) ? d.warnings.length : 0;
        return {
          message: `Indexed at ${sha ? sha.slice(0, 7) : "HEAD"} — ${num(c.skills) ?? 0} skills · ${num(c.practices) ?? 0} practices · ${num(c.memory) ?? 0} notes${warnings ? ` · ${warnings} file${warnings === 1 ? "" : "s"} skipped` : ""}`,
          ...(view.registry && sha ? { href: `${view.registry.url}/tree/${sha}`, hrefLabel: "view tree ↗" } : {}),
        };
      },
    });
  }

  if (actions.length === 0 || actions.includes("install-app")) {
    return <RegistryCapabilityNote view={view} slug={slug} />;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("reindex") ? (
          <RegistryButton onClick={reindex} disabled={m.pending !== null} title="Re-read the registry at HEAD and rebuild the mirror rows">
            {m.pending === "reindex" ? "Re-indexing…" : "Re-index"}
          </RegistryButton>
        ) : null}
        {actions.includes("open-repo") && view.registry ? (
          <RegistryButton href={view.registry.url}>Open on GitHub ↗</RegistryButton>
        ) : null}
      </div>
      <RegistryOutcomeLine m={m} />
    </div>
  );
}

/** Step 4's per-artifact action: one migration PR per type. `n/a` is a stated reason, not a button. */
export function RegistryMigrateAction({
  view,
  artifact,
  step,
  slug,
}: {
  view: RegistryView;
  artifact: "skills" | "practices" | "memory";
  step: RegistryView["migration"]["skills"];
  slug: string;
}) {
  const m = useRegistryMutation();
  const allowed = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" }).includes("migrate");

  if (step.state === "merged") {
    return (
      <span className="font-mono text-xs text-slate-500">
        merged · {step.moved}/{step.total}
      </span>
    );
  }
  if (step.state === "n/a") return <span className="font-mono text-xs text-slate-500">hosted mode</span>;
  if (step.state === "pr-open" && step.prUrl) {
    return (
      <a href={step.prUrl} className="font-mono text-xs text-accent hover:text-white" target="_blank" rel="noreferrer">
        review PR ↗
      </a>
    );
  }
  if (!allowed) {
    return (
      <span className="font-mono text-xs text-slate-600">
        {view.status === "unmapped" ? "map a registry first" : "admin only"}
      </span>
    );
  }

  function migrate() {
    void m.run("migrate", `/api/org/${encodeURIComponent(slug)}/registry/migrate?type=${artifact}`, {
      describe: (d) => {
        if (d.opened !== true) return { message: str(d.message) ?? `No hosted ${ARTIFACT_LABEL[artifact]} to migrate.` };
        const committed = Array.isArray(d.committed) ? d.committed.length : 0;
        return {
          message: `Migration PR #${num(d.prNumber) ?? "?"} opened — ${committed}/${num(d.total) ?? committed} files.`,
          ...(str(d.prUrl) ? { href: str(d.prUrl)!, hrefLabel: "review PR ↗" } : {}),
        };
      },
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={migrate}
        disabled={m.pending !== null}
        className="focus-ring font-mono text-xs text-accent transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {m.pending === "migrate" ? "opening PR…" : "open migration PR →"}
      </button>
      <RegistryOutcomeLine m={m} />
    </div>
  );
}
