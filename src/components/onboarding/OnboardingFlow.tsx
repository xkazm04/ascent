"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type ChecklistStep } from "@/components/onboarding/OnboardingChecklist";
import { PickStep, type Installation } from "@/components/onboarding/OnboardingPickStep";
import { SelectStep } from "@/components/onboarding/OnboardingSelectStep";
import { ScanStep } from "@/components/onboarding/OnboardingScanStep";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";
import type { OrgRepo } from "@/components/onboarding/types";
import { runImportScan } from "@/components/onboarding/importScan";

/** Credit context for the select step's cost disclosure, tagged with the org it was read for so a
 *  late response from a previously-picked org can never label the current one. */
interface OrgCredit {
  org: string;
  balance: number;
  unlimited: boolean;
}

type Phase = "pick" | "select" | "scanning" | "done";

// ONB-2: a refresh, an auth bounce, or accidental navigation used to drop the user back to step one.
// We persist just the inputs needed to rebuild the wizard (not the volatile repo list / scan rows) to
// sessionStorage, and rehydrate on mount by re-fetching the chosen source's repos and re-applying the
// saved selection — landing the user back on the select step where they left off.
const RESUME_KEY = "ascent:onboarding:v1";
interface ResumeSnapshot {
  org: string;
  sourceLabel: string;
  sourceInstallId: string | null;
  selected: string[];
}

/** Rank repos for preselection: most-starred first, then most-recently-pushed. The recency
 *  tie-break is what makes the installation path (private repos, usually 0 stars) preselect the
 *  repos a user actually works in, while public listings still lead with their popular repos. */
const byProminence = (a: OrgRepo, b: OrgRepo) =>
  b.stars - a.stars || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");

// Cap the installation selector so a large org (hundreds/thousands of repos) yields a usable
// list rather than an endless wall of buttons — mirrors the public listing's bound. The
// most prominent repos surface first; the connect page offers full search over the rest.
const MAX_LIST = 50;

const MAX_SELECT = 10;

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
  // Prepaid balance for the picked installation org — feeds the select step's cost disclosure
  // (the scan auto-watches repos on a weekly schedule, a recurring credit commitment). Read only
  // on the App path (the viewer owns that org); the public-handle path can't read tenant credits.
  const [credit, setCredit] = useState<OrgCredit | null>(null);
  // Whether the just-run scan was a PREVIEW (mock) — disclosed on the done state so the scores are
  // never mistaken for live numbers. Real only on the App path when the org actually has credits.
  const [previewScan, setPreviewScan] = useState(true);

  // Abort controller for the streaming import — aborted on Cancel and on unmount.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // ONB-2 — rehydrate once on mount (must run BEFORE the persist effect below so the snapshot is read
  // before that effect could overwrite it). Reads the saved source + selection and re-enters the
  // select step. Only the inputs are restored; the repo list is re-fetched live, so a stale scanning/
  // done phase resolves to a clean select step rather than a broken empty view.
  const rehydrated = useRef(false);
  useEffect(() => {
    if (rehydrated.current || typeof window === "undefined") return;
    rehydrated.current = true;
    let snap: ResumeSnapshot | null = null;
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      snap = raw ? (JSON.parse(raw) as ResumeSnapshot) : null;
    } catch {
      snap = null;
    }
    if (snap?.sourceLabel) void resumeFrom(snap);
    // Run-once on mount; resumeFrom is stable for this purpose and intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ONB-2 — persist the resumable inputs whenever they change. Never removes on the initial empty
  // mount (guarded on sourceLabel), and clears once the scan is saved server-side (the done state),
  // where the page's "welcome back" banner takes over.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (phase === "done") {
        sessionStorage.removeItem(RESUME_KEY);
        return;
      }
      if (!sourceLabel) return; // nothing meaningful to resume until a source is chosen
      const snap: ResumeSnapshot = { org, sourceLabel, sourceInstallId, selected: [...selected] };
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(snap));
    } catch {
      /* sessionStorage unavailable (private mode / quota) — resumability is best-effort */
    }
  }, [phase, org, sourceLabel, sourceInstallId, selected]);

  // Re-fetch the saved source's repos, then re-apply the saved selection (landing on the select step).
  async function resumeFrom(snap: ResumeSnapshot) {
    if (snap.sourceInstallId) await loadInstallationRepos(snap.org || snap.sourceLabel, snap.sourceInstallId);
    else await loadRepos(undefined, snap.sourceLabel);
    // Override the loaders' default top-N selection with the user's saved picks. A pick that's no
    // longer in the freshly loaded list is harmless (startScan intersects selection with `repos`).
    if (snap.selected.length) setSelected(new Set(snap.selected));
  }

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
    // Fire-and-forget: the balance enriches the cost disclosure but must never block the repo
    // list. The response is tagged with its org slug, so a stale resolution can't mislabel.
    const creditOrg = login.toLowerCase();
    fetch(`/api/org/credits?org=${encodeURIComponent(creditOrg)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.balance === "number") {
          setCredit({ org: creditOrg, balance: d.balance, unlimited: Boolean(d.unlimited) });
        }
      })
      .catch(() => {});
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
    const total = picks.length;
    // Run a REAL scan only on the App path AND when the org has credits (the import route meters +
    // refunds on failure) — otherwise a disclosed preview, so a credit-less org never dead-ends on a
    // 402 and scores are never silently fabricated. The public-handle funnel is always a preview.
    const canRunReal = !!sourceInstallId && !!credit && credit.org === sourceLabel && (credit.unlimited || credit.balance > 0);
    setPreviewScan(!canRunReal);
    try {
      const outcome = await runImportScan(
        {
          org: sourceLabel,
          repos: picks.map((r) => r.fullName),
          // Pass the installation id (when this source came from the GitHub App) so the server
          // mints an installation token — required to read the private repos we just listed.
          installationId: sourceInstallId ?? undefined,
          mock: !canRunReal,
        },
        controller,
        {
          onRepo: ({ repo, level, overall, error: rowError }) => {
            setRows((cur) => {
              const next = { ...cur, [repo]: { repo, level, overall, error: rowError } };
              const completed = Object.values(next).filter((r) => r.level || r.error).length;
              setAnnounce(`Scanned ${completed} of ${total}: ${repo}.`);
              return next;
            });
          },
          onResult: () => {
            setPhase("done");
            setAnnounce(`Scan complete — ${total} ${total === 1 ? "repository" : "repositories"}.`);
          },
          onError: (message) => setError(message),
        },
      );
      if (!outcome.ok) {
        if (outcome.aborted) {
          setError(outcome.stalled ? "The scan stalled (no response). Please try again." : "Scan canceled.");
        } else {
          setError(outcome.message ?? "Scan failed.");
        }
        setPhase("select");
      }
    } finally {
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
    return (
      <Shell>
        <PickStep
          seededOrg={seededOrg}
          installations={installations}
          suggestedOrgs={suggestedOrgs}
          org={org}
          setOrg={setOrg}
          loading={loading}
          error={error}
          onLoadInstallation={loadInstallationRepos}
          onSubmit={loadRepos}
          onPickOrg={(name) => loadRepos(undefined, name)}
        />
      </Shell>
    );
  }

  // ---- select phase: choose up to MAX_SELECT repos -------------------------
  if (phase === "select") {
    return (
      <Shell>
        <SelectStep
          repos={repos}
          selected={selected}
          loading={loading}
          sourceLabel={sourceLabel}
          sourceInstallId={sourceInstallId}
          credit={credit && credit.org === sourceLabel ? credit : null}
          maxSelect={MAX_SELECT}
          onToggle={toggle}
          onSelectTop={selectTop}
          onClear={clearSelection}
          onScan={startScan}
          onBack={() => setPhase("pick")}
        />
      </Shell>
    );
  }

  // ---- scanning + done phases ---------------------------------------------
  return (
    <Shell>
      <ScanStep
        phase={phase}
        rows={rows}
        error={error}
        announce={announce}
        preview={previewScan}
        checklistSteps={checklistSteps()}
        onCancel={cancelScan}
        onViewDashboard={() => router.push(`/org/${encodeURIComponent(sourceLabel)}`)}
        onScanAnother={() => {
          setPhase("pick");
          setRepos([]);
          setSelected(new Set());
          setRows({});
          setError(null);
          setSourceInstallId(null);
        }}
      />
    </Shell>
  );
}

// The onboarding page provides the site chrome + width; the flow just renders its phase.
function Shell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
