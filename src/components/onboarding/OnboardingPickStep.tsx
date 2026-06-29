"use client";

import { useEffect, useRef } from "react";
import { demoOrgHref } from "@/lib/site";

/** A GitHub App installation the signed-in user can scan through (private repos included). */
export interface Installation {
  login: string;
  id: string;
}

const SUGGESTIONS = ["vercel", "anthropics", "openai"];

/** The first phase: seeded-org CTA + installed-org / suggested-org shortcuts + public-handle form. */
export function PickStep({
  seededOrg,
  installations,
  suggestedOrgs,
  org,
  setOrg,
  loading,
  error,
  onLoadInstallation,
  onSubmit,
  onPickOrg,
}: {
  seededOrg?: string;
  installations: Installation[];
  suggestedOrgs: string[];
  org: string;
  setOrg: (v: string) => void;
  loading: boolean;
  error: string | null;
  onLoadInstallation: (login: string, id: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onPickOrg: (name: string) => void;
}) {
  const hasShortcuts = installations.length > 0 || suggestedOrgs.length > 0;
  return (
    <div key="pick" className="animate-phase-in space-y-4">
      {seededOrg && <SeededOrgBanner org={seededOrg} />}
      {installations.length > 0 && (
        <InstallationPicker installations={installations} onPick={onLoadInstallation} loading={loading} />
      )}
      {suggestedOrgs.length > 0 && (
        <SuggestedOrgs orgs={suggestedOrgs} onPick={onPickOrg} loading={loading} />
      )}
      <PickForm
        org={org}
        setOrg={setOrg}
        loading={loading}
        error={error}
        onSubmit={onSubmit}
        onPick={onPickOrg}
        dimmed={hasShortcuts}
      />
      {/* ONB-6: a zero-setup escape hatch — jump straight to a real, already-scanned org rollup
          instead of picking/scanning anything, for a user without an obvious org to start with. */}
      <p className="text-center text-sm text-slate-500">
        Not sure where to start?{" "}
        {/* The zero-setup "just show me" path (ONB-6): the SAME curated org the landing showcases (lib/site),
            so a user with no obvious org of their own can see a real rollup now. */}
        <a href={demoOrgHref()} className="focus-ring rounded-sm font-medium text-accent transition hover:text-white">
          See an example org report →
        </a>
      </p>
    </div>
  );
}

/**
 * Lets a signed-in user kick off the org step from one of their GitHub App installations, so
 * private/org repos are listed through the App (listInstallationRepos) rather than the
 * public-only listing. Rendered above the public-handle form when the session carries
 * installations.
 */
export function InstallationPicker({
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
export function SeededOrgBanner({ org }: { org: string }) {
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
 * Orgs auto-discovered from the user's GitHub account (public memberships + repo activity under
 * the default read:user scope) that aren't connected through the App yet. Each is a one-click
 * shortcut into the same select+scan flow as the public-handle form, so a new user can act on an
 * org they already belong to instead of typing a handle from scratch.
 */
export function SuggestedOrgs({
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

export function PickForm({
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
