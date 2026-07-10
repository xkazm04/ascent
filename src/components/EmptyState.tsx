import Link from "next/link";
import type { ReactNode } from "react";

export interface EmptyStateAction {
  label: string;
  href: string;
  /** Render as the filled accent button (vs the default outline button). At most one per state. */
  primary?: boolean;
}

/**
 * The canonical empty/notice state for the whole app — one optional icon, a title, body copy, an
 * optional alert banner, a row of link actions, and an optional custom-action slot (children, e.g.
 * a client button or the GitHub sign-in CTA). Two scales:
 *   - `variant="page"`    full-height hero notice (whole-page empties, sign-in, org dashboards)
 *   - `variant="section"` a compact dashed in-card empty (per-section/inline empties)
 *
 * Every hand-rolled notice routes through here (SignInNotice, OrgEmpty, SectionEmpty, the trends
 * empty/error states, the repo-picker empties) so the empty/notice states stay visually consistent
 * and a future tweak lands in one place. Server/client safe — it owns no hooks, so client islands
 * (buttons, the sign-in CTA) can be passed in as `children`.
 */
export function EmptyState({
  icon,
  title,
  body,
  actions = [],
  alert,
  children,
  variant = "page",
}: {
  icon?: string;
  title?: string;
  body?: ReactNode;
  actions?: EmptyStateAction[];
  /** Optional banner rendered between the title and body (e.g. an expired-session alert). */
  alert?: ReactNode;
  /** Custom action node(s) (a client button, the GitHub sign-in CTA) rendered alongside `actions`. */
  children?: ReactNode;
  /** "page" = full-height hero notice; "section" = compact dashed in-card empty. */
  variant?: "page" | "section";
}) {
  const section = variant === "section";
  const wrap = section
    ? "rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 p-10 text-center"
    : "flex flex-col items-center py-24 text-center";
  const iconCls = section ? "text-3xl" : "text-5xl";
  const titleCls = section ? "text-base font-semibold text-white" : "mt-4 text-2xl font-bold text-white";
  const bodyCls = section ? "mt-1 text-base text-slate-400" : "mt-2 max-w-md text-slate-400";

  return (
    <div className={wrap}>
      {icon && (
        <div className={iconCls} aria-hidden="true">
          {icon}
        </div>
      )}
      {title != null &&
        (section ? <div className={titleCls}>{title}</div> : <h1 className={titleCls}>{title}</h1>)}
      {alert}
      {body != null && <p className={bodyCls}>{body}</p>}
      {(actions.length > 0 || children) && (
        <div className={`flex flex-wrap items-center justify-center gap-3 ${section ? "mt-3" : "mt-6"}`}>
          {children}
          {actions.map((a) => (
            <Link
              key={`${a.href}::${a.label}`}
              href={a.href}
              className={
                a.primary
                  ? "rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-on-accent transition hover:bg-accent-soft"
                  : "rounded-xl border border-slate-700 px-5 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The "scan this repo / go home" empty+error state shared by the per-repo trends and compare pages.
 * An EmptyState whose actions are an optional "Scan {repo}" primary link followed by "← Home"; only
 * the leading icon differs per page (📈 trends, 🔀 compare), so it's a prop. Server/client safe.
 */
export function RepoScanNotice({
  icon,
  title,
  body,
  repo,
}: {
  icon: string;
  title: string;
  body: string;
  repo?: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      actions={[
        ...(repo
          ? [{ label: `Scan ${repo}`, href: `/report?repo=${encodeURIComponent(repo)}`, primary: true }]
          : []),
        { label: "← Home", href: "/" },
      ]}
    />
  );
}
