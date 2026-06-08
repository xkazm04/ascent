"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { OnboardingChecklist, type ChecklistStep } from "@/components/onboarding/OnboardingChecklist";

interface OrgRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

/** A GitHub App installation the signed-in user can scan through (private repos included). */
interface Installation {
  login: string;
  id: string;
}

type Phase = "pick" | "select" | "scanning" | "done";

/** Rank repos for preselection: most-starred first, then most-recently-pushed. The recency
 *  tie-break is what makes the installation path (private repos, usually 0 stars) preselect the
 *  repos a user actually works in, while public listings still lead with their popular repos. */
const byProminence = (a: OrgRepo, b: OrgRepo) =>
  b.stars - a.stars || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");

// Cap the installation selector so a large org (hundreds/thousands of repos) yields a usable
// list rather than an endless wall of buttons — mirrors the public listing's bound. The
// most prominent repos surface first; the connect page offers full search over the rest.
const MAX_LIST = 50;

interface ScanRow {
  repo: string;
  level?: LevelId;
  overall?: number;
  error?: string;
}

const MAX_SELECT = 10;
// Abort an import if no SSE event arrives within this window — turns a server stall into a
// recoverable error instead of an indefinite "Scanning…" hang.
const STALL_MS = 45_000;

export function OnboardingFlow({
  hasInstallation = false,
  installations = [],
  suggestedOrgs = [],
  seededOrg,
}: {
  hasInstallation?: boolean;
  installations?: Installation[];
  /** Orgs auto-discovered at login that aren't installed yet — one-click "scan this org" nudges. */
  suggestedOrgs?: string[];
  /** Most-active org whose watchlist was pre-seeded at login; surfaced as a "dashboard ready" CTA. */
  seededOrg?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [org, setOrg] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  // The installation id behind the current source, when scanning through the GitHub App. It's
  // threaded into the import POST so the server mints an installation token and can read private
  // repos; null for the public-handle path (token-less / GITHUB_TOKEN listing).
  const [sourceInstallId, setSourceInstallId] = useState<string | null>(null);
  const [repos, setRepos] = useState<OrgRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, ScanRow>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Abort controller for the streaming import — aborted on Cancel and on unmount.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function loadRepos(e?: React.FormEvent, preset?: string) {
    e?.preventDefault();
    const handle = (preset ?? org).trim().replace(/^@/, "");
    if (!handle) return;
    if (preset) setOrg(preset);
    setLoading(true);
    setError(null);
    setRepos([]);
    setSourceInstallId(null); // public-handle path — no installation token
    setPhase("select"); // switch first so skeleton rows show while GitHub responds
    try {
      const res = await fetch(`/api/org/repos?org=${encodeURIComponent(handle)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed to list repos (${res.status}).`);
      const list = (data.repos ?? []) as OrgRepo[];
      if (list.length === 0) throw new Error("No public repositories found for that account.");
      setRepos(list);
      const top = [...list].sort(byProminence).slice(0, MAX_SELECT);
      setSelected(new Set(top.map((r) => r.fullName)));
      setSourceLabel(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("pick");
    } finally {
      setLoading(false);
    }
  }

  // Org step for the GitHub App path: pull an installation's repos (private included) via
  // /api/app/repos (which calls listInstallationRepos), then feed the SAME select+scan flow as
  // the public listing. This is the bridge the connect page advertises — onboarding can finally
  // reach a private repo, the highest-value activation moment.
  async function loadInstallationRepos(login: string, id: string) {
    setOrg(login);
    setLoading(true);
    setError(null);
    setRepos([]);
    setSourceInstallId(id);
    setPhase("select");
    try {
      const qs = new URLSearchParams({ org: login, installation_id: id });
      const res = await fetch(`/api/app/repos?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed to list installation repos (${res.status}).`);
      // The /api/app/repos rows carry extra fields (url, state); normalize to OrgRepo.
      const list = ((data.repos ?? []) as Partial<OrgRepo>[])
        .map((r) => ({
          fullName: String(r.fullName),
          owner: String(r.owner),
          name: String(r.name),
          private: Boolean(r.private),
          language: r.language ?? null,
          stars: r.stars ?? 0,
          pushedAt: r.pushedAt ?? null,
        }))
        .sort(byProminence)
        .slice(0, MAX_LIST);
      if (list.length === 0) throw new Error("No repositories accessible to this installation.");
      setRepos(list);
      setSelected(new Set(list.slice(0, MAX_SELECT).map((r) => r.fullName)));
      // Lowercase the source label: private scans persist under the lowercased owner slug, and
      // the org dashboard resolves the slug exactly — so a mixed-case login (e.g. "Netflix")
      // must be normalized here or the "View dashboard" link would 404.
      setSourceLabel(login.toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("pick");
    } finally {
      setLoading(false);
    }
  }

  function toggle(fullName: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(fullName)) next.delete(fullName);
      else if (next.size < MAX_SELECT) next.add(fullName);
      return next;
    });
  }

  function selectTop() {
    const top = [...repos].sort(byProminence).slice(0, MAX_SELECT);
    setSelected(new Set(top.map((r) => r.fullName)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function cancelScan() {
    abortRef.current?.abort();
  }

  async function startScan() {
    const picks = repos.filter((r) => selected.has(r.fullName));
    if (picks.length === 0) return;
    setPhase("scanning");
    setRows(Object.fromEntries(picks.map((r) => [r.fullName, { repo: r.fullName }])));
    setError(null);
    setAnnounce(`Scanning ${picks.length} ${picks.length === 1 ? "repository" : "repositories"}.`);

    const controller = new AbortController();
    abortRef.current = controller;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STALL_MS);
    };

    try {
      armStall();
      const res = await fetch("/api/org/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: sourceLabel,
          repos: picks.map((r) => r.fullName),
          // Pass the installation id (when this source came from the GitHub App) so the server
          // mints an installation token — required to read the private repos we just listed.
          installationId: sourceInstallId ?? undefined,
          mock: true,
          watch: true,
          schedule: "weekly",
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Import failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const total = picks.length;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall(); // progress arrived — reset the stall window
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          const lines = block.split("\n");
          let event = "message";
          let dataStr = "";
          for (const raw of lines) {
            const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          if (event === "repo") {
            const repo = String(data.repo);
            setRows((cur) => {
              const next = {
                ...cur,
                [repo]: {
                  repo,
                  level: data.level as LevelId | undefined,
                  overall: typeof data.overall === "number" ? data.overall : undefined,
                  error: typeof data.error === "string" ? data.error : undefined,
                },
              };
              const completed = Object.values(next).filter((r) => r.level || r.error).length;
              setAnnounce(`Scanned ${completed} of ${total}: ${repo}.`);
              return next;
            });
          } else if (event === "result") {
            setPhase("done");
            setAnnounce(`Scan complete — ${total} ${total === 1 ? "repository" : "repositories"}.`);
          } else if (event === "error") {
            setError(String(data.error ?? "Scan failed."));
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError(stalled ? "The scan stalled (no response). Please try again." : "Scan canceled.");
      } else {
        setError(err instanceof Error ? err.message : "Scan failed.");
      }
      setPhase("select");
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const checklistSteps = (): ChecklistStep[] => {
    const picked = selected.size > 0 || phase === "scanning" || phase === "done";
    const scanned = phase === "done";
    return [
      { label: "Install the GitHub App", done: hasInstallation, href: "/connect", hint: "Read private & org repos" },
      { label: "Pick repositories", done: picked, hint: "Choose what to scan" },
      { label: "Run your first scan", done: scanned, hint: "See your maturity scores" },
      { label: "Set a watch schedule", done: scanned, href: "/connect", hint: "Keep scores fresh automatically" },
      {
        label: "View cross-repo analysis",
        done: false,
        href: sourceLabel ? `/org/${encodeURIComponent(sourceLabel)}` : "/connect",
        hint: "Compare repos across your org",
      },
    ];
  };

  // ---- pick phase: choose an installed org (private repos) or enter a handle ----------
  if (phase === "pick") {
    const hasShortcuts = installations.length > 0 || suggestedOrgs.length > 0;
    return (
      <Shell>
        <div key="pick" className="animate-phase-in space-y-4">
          {seededOrg && <SeededOrgBanner org={seededOrg} />}
          {installations.length > 0 && (
            <InstallationPicker installations={installations} onPick={loadInstallationRepos} loading={loading} />
          )}
          {suggestedOrgs.length > 0 && (
            <SuggestedOrgs orgs={suggestedOrgs} onPick={(name) => loadRepos(undefined, name)} loading={loading} />
          )}
          <PickForm
            org={org}
            setOrg={setOrg}
            loading={loading}
            error={error}
            onSubmit={loadRepos}
            onPick={(name) => loadRepos(undefined, name)}
            dimmed={hasShortcuts}
          />
        </div>
      </Shell>
    );
  }

  // ---- select phase: choose up to MAX_SELECT repos -------------------------
  if (phase === "select") {
    const listing = loading && repos.length === 0;
    const atCap = selected.size >= MAX_SELECT;
    return (
      <Shell>
        <div key="select" className="animate-phase-in">
          <h1 className="text-2xl font-bold text-white">Choose repositories</h1>
          <p className="mt-1 text-slate-400">
            Up to {MAX_SELECT}. We preselected the {sourceInstallId ? "most recently active" : "most-starred"}.
            {sourceLabel && <> Source: {sourceLabel}</>}
          </p>

          {/* Sticky action bar: bulk select/clear + a filled progress pill for the cap. */}
          <div className="sticky top-16 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur">
            <CapPill count={selected.size} max={MAX_SELECT} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectTop}
                disabled={listing}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
              >
                Select top {MAX_SELECT}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={listing || selected.size === 0}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-600 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {listing ? (
              <SelectSkeleton />
            ) : (
              repos.map((r) => {
                const checked = selected.has(r.fullName);
                const capped = !checked && atCap;
                return (
                  <button
                    key={r.fullName}
                    type="button"
                    disabled={capped}
                    aria-disabled={capped}
                    title={capped ? `Limit reached — deselect one to swap (max ${MAX_SELECT})` : undefined}
                    onClick={() => toggle(r.fullName)}
                    className={`focus-ring flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition ${
                      checked
                        ? "border-accent bg-accent/10"
                        : capped
                          ? "cursor-not-allowed border-slate-800 opacity-40"
                          : "border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-on-accent" : "border-slate-600"}`}>
                      {checked && "✓"}
                    </span>
                    <span className="flex-1 truncate font-mono text-base text-white">{r.fullName}</span>
                    {r.private && (
                      <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-accent">
                        private
                      </span>
                    )}
                    {capped && (
                      <span className="font-mono text-sm uppercase tracking-widest text-slate-500">limit reached</span>
                    )}
                    {r.language && <span className="text-sm text-slate-500">{r.language}</span>}
                    <span className="text-sm text-slate-500">★ {r.stars.toLocaleString()}</span>
                  </button>
                );
              })
            )}
          </div>

          {!listing && (
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={startScan}
                disabled={selected.size === 0}
                className="focus-ring rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
              >
                Scan {selected.size} {selected.size === 1 ? "repo" : "repos"}
              </button>
              <button
                onClick={() => setPhase("pick")}
                className="focus-ring rounded-lg border border-slate-700 px-4 py-2.5 text-base text-slate-300 hover:border-slate-600"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ---- scanning + done phases ---------------------------------------------
  const completed = Object.values(rows).filter((r) => r.level || r.error).length;
  const errorCount = Object.values(rows).filter((r) => r.error).length;
  const scanTotal = Object.keys(rows).length;
  const pct = scanTotal ? Math.round((completed / scanTotal) * 100) : 0;

  return (
    <Shell>
      <div key={phase} className="animate-phase-in">
        {/* Polite live region — announces scan progress + completion for screen readers. */}
        <div role="status" aria-live="polite" className="sr-only">
          {announce}
        </div>

        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          {phase === "done" && (
            <span
              aria-hidden
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-base ${
                errorCount > 0
                  ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                  : "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {errorCount > 0 ? "!" : "✓"}
            </span>
          )}
          {phase === "done" ? "Scan complete" : "Scanning repositories"}
        </h1>
        <p className="mt-1 text-slate-400">
          {phase === "done"
            ? errorCount > 0
              ? `Here's how your repositories scored — ${errorCount} couldn't be scanned.`
              : "Here's how your repositories scored."
            : `Scanning ${scanTotal} repositories…`}
        </p>

        {/* Progress bar (accessible) — eased width, role=progressbar. */}
        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Scan progress: ${completed} of ${scanTotal} repositories`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-sm tabular-nums text-slate-400">
            {pct}% · {completed}/{scanTotal}
          </span>
          {phase === "scanning" && (
            <button
              type="button"
              onClick={cancelScan}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-danger/50 hover:text-danger-soft"
            >
              Cancel
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-base text-danger-soft">
            {error}
          </p>
        )}

        <div className="mt-5 space-y-1.5">
          {Object.values(rows).map((row) => (
            <ScanRowView key={row.repo} row={row} />
          ))}
        </div>

        {phase === "done" && (
          <>
            <div className="mt-6">
              <OnboardingChecklist steps={checklistSteps()} />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => router.push(`/org/${encodeURIComponent(sourceLabel)}`)}
                className="rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
              >
                View dashboard
              </button>
              <button
                onClick={() => {
                  setPhase("pick");
                  setRepos([]);
                  setSelected(new Set());
                  setRows({});
                  setError(null);
                  setSourceInstallId(null);
                }}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-base text-slate-300 hover:border-slate-600"
              >
                Scan another
              </button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

// The onboarding page provides the site chrome + width; the flow just renders its phase.
function Shell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const SUGGESTIONS = ["vercel", "anthropics", "openai"];

/** Filled progress pill that doubles as the X / MAX counter. */
function CapPill({ count, max }: { count: number; max: number }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-sm tabular-nums text-slate-300">
        {count}/{max} selected
      </span>
    </div>
  );
}

/** Skeleton rows mirroring the select-list layout, shown while repos are being listed. */
function SelectSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <div className="h-5 w-5 animate-pulse rounded bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-800" style={{ maxWidth: `${60 - i * 5}%` }} />
          <div className="h-3 w-10 animate-pulse rounded bg-slate-800/70" />
        </div>
      ))}
    </div>
  );
}

/**
 * Lets a signed-in user kick off the org step from one of their GitHub App installations, so
 * private/org repos are listed through the App (listInstallationRepos) rather than the
 * public-only listing. Rendered above the public-handle form when the session carries
 * installations.
 */
function InstallationPicker({
  installations,
  onPick,
  loading,
}: {
  installations: Installation[];
  onPick: (login: string, id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-6">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">From your GitHub App</div>
      <h2 className="mt-1 font-semibold text-white">Scan an installed organization</h2>
      <p className="mt-1 text-base text-slate-400">
        These are connected through the Ascent GitHub App, so{" "}
        <span className="text-slate-200">private repositories</span> are included.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {installations.map((inst) => (
          <button
            key={inst.id}
            type="button"
            disabled={loading}
            onClick={() => onPick(inst.login, inst.id)}
            className="focus-ring rounded-lg border border-accent/40 bg-slate-950/60 px-4 py-2.5 text-left transition hover:border-accent hover:bg-accent/10 disabled:opacity-50"
          >
            <span className="font-mono text-base text-white">{inst.login}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "Dashboard ready" CTA shown when login pre-seeded the watchlist for the user's most-active org.
 * Turns the blank first visit into an immediate next step — open the populated rollup — without
 * making the user pick and scan anything first.
 */
function SeededOrgBanner({ org }: { org: string }) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-emerald-300">Ready for you</div>
      <h2 className="mt-1 font-semibold text-white">
        We pre-loaded <span className="font-mono">{org}</span>&apos;s top repositories
      </h2>
      <p className="mt-1 text-base text-slate-400">
        Your most active organization is already on your watchlist. Open its dashboard to scan the
        fleet and see the cross-repo rollup — or start a fresh scan below.
      </p>
      <a
        href={`/org/${encodeURIComponent(org)}`}
        className="focus-ring mt-4 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-emerald-400"
      >
        View {org} dashboard →
      </a>
    </div>
  );
}

/**
 * Orgs auto-discovered from the user's GitHub account (read:org) that aren't connected through the
 * App yet. Each is a one-click shortcut into the same select+scan flow as the public-handle form,
 * so a new user can act on an org they already belong to instead of typing a handle from scratch.
 */
function SuggestedOrgs({
  orgs,
  onPick,
  loading,
}: {
  orgs: string[];
  onPick: (name: string) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-slate-500">
        Organizations you belong to
      </div>
      <h2 className="mt-1 font-semibold text-white">Scan one of your organizations</h2>
      <p className="mt-1 text-base text-slate-400">
        Discovered from your GitHub account. Scanning lists each org&apos;s{" "}
        <span className="text-slate-200">public repositories</span> — install the GitHub App to
        include private ones.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {orgs.map((login) => (
          <button
            key={login}
            type="button"
            disabled={loading}
            onClick={() => onPick(login)}
            className="focus-ring rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-left transition hover:border-accent hover:bg-accent/10 disabled:opacity-50"
          >
            <span className="font-mono text-base text-white">{login}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickForm({
  org,
  setOrg,
  loading,
  error,
  onSubmit,
  onPick,
  dimmed = false,
}: {
  org: string;
  setOrg: (v: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onPick: (name: string) => void;
  dimmed?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Return focus to the org field when a submit error appears so keyboard/SR users land on the
  // control that produced it (the error is also wired via aria-invalid + aria-describedby below).
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <label className="font-mono text-sm uppercase tracking-[0.3em] text-slate-500" htmlFor="onboarding-org">
        {dimmed ? "Or scan any public organization or user" : "GitHub organization or user"}
      </label>
      <form onSubmit={onSubmit} className="mt-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="onboarding-org"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="e.g. vercel or torvalds"
            autoFocus={!dimmed}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "onboarding-org-error" : undefined}
            className="focus-ring flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="focus-ring rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {loading ? "Listing…" : "List repos"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          try:
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="focus-ring rounded-full border border-slate-700 px-2.5 py-0.5 font-mono text-slate-300 transition hover:border-accent hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
        {error && (
          <p id="onboarding-org-error" role="alert" className="mt-3 text-base text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function ScanRowView({ row }: { row: ScanRow }) {
  const done = row.level && typeof row.overall === "number";
  const lc = row.level ? LEVEL_CLASSES[row.level] : null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5">
      <span className="flex-1 truncate font-mono text-base text-white">{row.repo}</span>
      {row.error ? (
        <span className="text-sm text-danger">{row.error}</span>
      ) : done ? (
        <span className={`rounded border px-2 py-0.5 font-mono text-sm ${lc?.border} ${lc?.bg} ${lc?.text}`}>
          {row.level && <span aria-hidden>{LEVEL_GLYPH[row.level]} </span>}
          {row.level} · {row.overall}
        </span>
      ) : (
        <span className="text-sm text-slate-500">scanning…</span>
      )}
    </div>
  );
}
