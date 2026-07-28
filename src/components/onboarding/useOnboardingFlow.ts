"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";
import type { OrgRepo } from "@/components/onboarding/types";
import { runImportScan } from "@/components/onboarding/importScan";
import { resolveScanMode, type CreditRead } from "@/components/onboarding/scanMode";
import { runRepoRetry } from "@/components/onboarding/retryRepo";
import { byProminence } from "@/components/onboarding/byProminence";
import { getAutoWatchOptIn, resetAutoWatchOptIn } from "@/components/onboarding/OnboardingSelectStep.watchOptIn";
import { classifyScanFailure, gateAnnouncement, type ScanGate } from "@/components/onboarding/scanGate";
import {
  MAX_LIST,
  MAX_SELECT,
  RESUME_KEY,
  type OrgCredit,
  type Phase,
  type ResumeSnapshot,
  topSelection,
} from "@/components/onboarding/OnboardingFlow.model";

// `personalOrg` is the viewer's PERSONAL workspace slug (Organization.kind === "personal"), resolved
// server-side by the onboarding page. It lets the wizard refuse a personal target UPFRONT — before a
// pointless import POST — instead of only catching requireFleetOrg's 403 after the fact. It is the
// real DB kind, not a "slug === my login" guess, so a viewer whose own namespace is a normal fleet org
// is unaffected.
//
// All wizard state, effects, and handlers for OnboardingFlow, relocated into a co-located hook so the
// component file stays under the 300-LOC cap (AGENTS.md). Pure relocation — behavior, hook-call order,
// and every closure are preserved exactly; the component consumes the returned bag unchanged.
export function useOnboardingFlow({ personalOrg = null }: { personalOrg?: string | null } = {}) {
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
  // How many teammates were invited from the done state (App path) — marks the checklist step done.
  const [invitedCount, setInvitedCount] = useState(0);
  // Whether the public listing STOPPED LOOKING before the end of the account (/api/org/repos returns
  // `truncated` for exactly this: its page budget ran out with more pages available). The flag has been
  // on the response since the listing was bounded, but nothing ever read it — so a fork-heavy org's
  // partial list was presented as the org's complete reality. The select step discloses it.
  const [listTruncated, setListTruncated] = useState(false);
  // How many repos the server deferred for insufficient credits this run — surfaced on the done
  // screen so a credit shortfall is disclosed rather than left as ghost "scanning…" rows.
  const [creditSkipped, setCreditSkipped] = useState(0);
  // An ACCESS gate returned by the import kickoff (401/403) — rendered as a human recovery step
  // INSTEAD of the raw server string. Distinct from `error` on purpose: `error` stays the channel for
  // genuine unexpected failures (where losing the server's diagnostic would be worse than a raw
  // string), while a gate is a known state the wizard knows how to get the user out of.
  const [gate, setGate] = useState<ScanGate | null>(null);

  // Abort controller for the streaming import — aborted on Cancel and on unmount.
  const abortRef = useRef<AbortController | null>(null);
  // Per-repo RETRIES run outside the batch: each owns its own controller (Cancel belongs to the batch,
  // and a retry must not hijack it) but still has to die on unmount, or an in-flight retry would write
  // state into an unmounted tree. The same set is the synchronous double-click guard — a React state
  // flag can't stop the second half of a double-click, which would fire two POSTs for one repo.
  const retriesRef = useRef<Map<string, AbortController>>(new Map());
  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const c of retriesRef.current.values()) c.abort();
    },
    [],
  );

  // Whether the just-run preview was caused by a FAILED credit read (network blip / 500) rather than
  // a genuine lack of credits — the done-screen banner must not tell a paying, App-installed org to
  // "install the GitHub App" when the only problem was a transient balance read.
  const [previewCause, setPreviewCause] = useState<"credit_unknown" | null>(null);

  // The in-flight credit read for the App-path source. It resolves to the OrgCredit, null ("the org
  // verifiably has no readable credit object"), or "failed" (the read itself errored — balance UNKNOWN,
  // a distinct state: fail-closed-to-preview is deliberate billing safety, but the cause must be
  // distinguishable so startScan can retry once and the done screen can explain honestly). startScan
  // awaits this so the money-gate decision never reads a null `credit` from an un-awaited fetch and
  // fabricates a preview on an org that actually has credits (ONB-1 race).
  const creditReady = useRef<Promise<CreditRead> | null>(null);

  // One credit read, shared by the load-time kick-off and startScan's retry. Resolves "failed" on a
  // non-OK response or a thrown fetch — never rejects, so awaiting it is always safe.
  function fetchCredit(creditOrg: string): Promise<CreditRead> {
    return fetch(`/api/org/credits?org=${encodeURIComponent(creditOrg)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (d && typeof d.balance === "number") {
          const c: OrgCredit = {
            org: creditOrg,
            balance: d.balance,
            unlimited: Boolean(d.unlimited),
            allowanceRemaining: typeof d.allowanceRemaining === "number" ? d.allowanceRemaining : null,
          };
          setCredit(c);
          return c;
        }
        return null;
      })
      .catch(() => "failed" as const);
  }

  // ONB a11y #1: a multi-step wizard must move focus to the new step and announce it, or keyboard/SR
  // users lose their place (focus falls to <body>) and get no feedback that a step advanced. We hold
  // a flow-root polite live region and, on each phase change, focus the new step's heading and
  // announce "Step N of 3: <title>". The mount-skip ref avoids announcing/stealing focus on first
  // render (initial autofocus belongs to the pick form's input).
  const flowRef = useRef<HTMLDivElement>(null);
  const [stepAnnounce, setStepAnnounce] = useState("");
  const firstPhaseRender = useRef(true);
  useEffect(() => {
    if (firstPhaseRender.current) {
      firstPhaseRender.current = false;
      return;
    }
    const titles: Record<Phase, string> = {
      pick: "Choose a source",
      select: "Choose repositories",
      scanning: "Scanning repositories",
      done: "Scan complete",
    };
    const step = phase === "pick" ? 1 : phase === "select" ? 2 : 3;
    setStepAnnounce(`Step ${step} of 3: ${titles[phase]}`);
    // Focus the new step's heading so keyboard/SR users land on the step that just rendered.
    const heading = flowRef.current?.querySelector<HTMLElement>("[data-step-heading]");
    heading?.focus();
  }, [phase]);

  // The gate replaces the step content without a phase change, so it needs the same focus discipline
  // the phase effect gives every other step — otherwise a keyboard/SR user whose scan was refused
  // hears nothing and focus stays where the (now unmounted) Scan button used to be. Its announcement
  // is DERIVED (below, at the return) rather than stored: a gate always lands in the same commit as
  // the return to "select", so a second setState here would only race the phase effect's title.
  useEffect(() => {
    if (!gate) return;
    flowRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [gate]);

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
    if (snap?.sourceLabel) {
      void resumeFrom(snap);
    } else {
      // ?org=<handle> — the intent handoff for links that already know which account the user wants
      // (the connect page's discovered-org chips). Without it those chips dropped the org and dumped
      // the user on a blank step 1. An in-progress snapshot always wins: a half-finished selection is
      // more specific than a link's suggestion. Read off location rather than useSearchParams so this
      // stays a plain mount effect (no CSR bailout / Suspense boundary needed).
      const preset = new URLSearchParams(window.location.search).get("org")?.trim();
      if (preset) void loadRepos(undefined, preset);
    }
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
    setGate(null); // a fresh source starts clean — the previous source's access gate no longer applies
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
      setListTruncated(Boolean(data.truncated));
      setSelected(topSelection(list));
      // Lowercase the source label to match the App path: the import route persists under
      // org.trim().toLowerCase(), and the org dashboard resolves the slug exactly — so a mixed-case
      // handle (e.g. "Facebook") must be normalized here or the terminal "View dashboard" link 404s.
      setSourceLabel(handle.toLowerCase());
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
    setGate(null); // a fresh source starts clean — the previous source's access gate no longer applies
    setRepos([]);
    setSourceInstallId(id);
    setPhase("select");
    // Fire-and-forget for the UI: the balance enriches the cost disclosure but must never block the
    // repo list. The response is tagged with its org slug, so a stale resolution can't mislabel. The
    // promise is stashed in creditReady so startScan can AWAIT the settled balance before choosing
    // real-vs-preview (a fast "Scan" click must not race an unresolved read into a mock — ONB-1).
    const creditOrg = login.toLowerCase();
    creditReady.current = fetchCredit(creditOrg);
    try {
      const qs = new URLSearchParams({ org: login, installation_id: id });
      const res = await fetch(`/api/app/repos?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed to list installation repos (${res.status}).`);
      // The /api/app/repos rows carry extra fields (url, state); normalize to OrgRepo.
      const list = ((data.repos ?? []) as Partial<OrgRepo>[])
        .map((r) => ({
          fullName: String(r.fullName),
          private: Boolean(r.private),
          language: r.language ?? null,
          stars: r.stars ?? 0,
          pushedAt: r.pushedAt ?? null,
        }))
        .sort(byProminence)
        .slice(0, MAX_LIST);
      if (list.length === 0) throw new Error("No repositories accessible to this installation.");
      setRepos(list);
      setSelected(topSelection(list));
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
    setSelected(topSelection(repos));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function cancelScan() {
    abortRef.current?.abort();
  }

  // "Scan another": reset the FULL per-run state, not just the visible rows/selection. The original
  // inline reset list predated the money/checklist state and left `credit` (a pre-scan snapshot the
  // next run's cost copy + money-gate would trust over a fresh read), `creditReady`, `previewScan`/
  // `previewCause`, `invitedCount`, and `creditSkipped` to leak into the second run — understating
  // recurring cost on a just-drained org and pre-ticking "Invite your team". (ambiguity-ui #3)
  function resetRun() {
    setPhase("pick");
    setRepos([]);
    setSelected(new Set());
    setRows({});
    setError(null);
    setSourceInstallId(null);
    setCredit(null);
    creditReady.current = null;
    setPreviewScan(true);
    setPreviewCause(null);
    setInvitedCount(0);
    setCreditSkipped(0);
    setGate(null);
    // The autoscan opt-in is per-run consent, not a sticky preference: a second run must start from
    // the safe default rather than inherit a tick the user made for a different repo set.
    resetAutoWatchOptIn();
  }

  async function startScan() {
    const picks = repos.filter((r) => selected.has(r.fullName));
    if (picks.length === 0) return;
    // UPFRONT personal-tier refusal: importing scans under a personal workspace is what requireFleetOrg
    // rejects (the lens invariant — a public repo's series lives in the shared "public" org). Gating
    // here spares the user a doomed round-trip and, more importantly, means the handoff is the FIRST
    // thing they see rather than a 403 whose message quotes an internal API route.
    if (personalOrg && sourceLabel === personalOrg) {
      setGate({ kind: "personal", org: sourceLabel });
      return;
    }
    setPhase("scanning");
    setRows(Object.fromEntries(picks.map((r) => [r.fullName, { repo: r.fullName }])));
    setError(null);
    setGate(null);
    setCreditSkipped(0);
    setAnnounce(`Scanning ${picks.length} ${picks.length === 1 ? "repository" : "repositories"}.`);

    const controller = new AbortController();
    abortRef.current = controller;
    const total = picks.length;
    // Settle the balance before deciding real-vs-preview. The whole decision (await the in-flight read,
    // retry once on an unknown balance, fail closed) lives in scanMode.ts so the per-repo retry on the
    // done screen re-checks the money gate through the SAME code path. The credit read is its own fetch
    // (not tied to `controller`), so it still resolves if the user cancels mid-wait; an aborted
    // controller is handled below by runImportScan ("Scan canceled").
    // Run a REAL scan only on the App path AND when the org has credits (the import route meters +
    // refunds on failure) — otherwise a disclosed preview, so a credit-less org never dead-ends on a
    // 402 and scores are never silently fabricated. The public-handle funnel is always a preview.
    const { canRunReal, creditUnknown } = await resolveScanMode({
      sourceInstallId,
      sourceLabel,
      credit,
      creditReady,
      fetchCredit,
    });
    setPreviewScan(!canRunReal);
    setPreviewCause(!canRunReal && creditUnknown ? "credit_unknown" : null);
    try {
      const outcome = await runImportScan(
        {
          org: sourceLabel,
          repos: picks.map((r) => r.fullName),
          // Pass the installation id (when this source came from the GitHub App) so the server
          // mints an installation token — required to read the private repos we just listed.
          installationId: sourceInstallId ?? undefined,
          mock: !canRunReal,
          // Recurring weekly autoscan enrolment is OPT-IN (the select step's checkbox writes this
          // store). Omitting the field meant runImportScan defaulted it to `Boolean(installationId)` —
          // true on every App-path run — so a scan click silently subscribed each repo to a standing,
          // billable weekly draw. Pass it EXPLICITLY: the server also defaults `watch` to true, so
          // "not opted in" must travel as false, never as an omission.
          watch: getAutoWatchOptIn(),
        },
        controller,
        {
          onRepo: ({ repo, level, overall, error: rowError, skipped }) => {
            setRows((cur) => {
              const next = { ...cur, [repo]: { repo, level, overall, error: rowError, skipped } };
              // Skipped rows are terminal too, so they count toward "completed" — otherwise the
              // progress bar would stall below 100% on a credit shortfall.
              const completed = Object.values(next).filter((r) => r.level || r.error || r.skipped).length;
              setAnnounce(`Scanned ${completed} of ${total}: ${repo}.`);
              return next;
            });
          },
          // A credit shortfall caps the batch server-side; forward the count so it's disclosed and
          // the leftover (never-scanned) rows can be resolved to a skipped state on completion.
          onNotice: ({ reason, skipped }) => {
            if (reason === "insufficient_credits" && skipped > 0) setCreditSkipped(skipped);
          },
          onResult: () => {
            // The stream is done: any row still with no level/error/skipped was deferred for credits
            // (the route emits no event for the repos it sliced off), so resolve those ghosts to a
            // skipped state instead of leaving a perpetual "scanning…" row + stuck progress bar.
            setRows((cur) => {
              let leftover = 0;
              const next: typeof cur = {};
              for (const [key, r] of Object.entries(cur)) {
                if (!r.level && !r.error && !r.skipped) {
                  leftover += 1;
                  next[key] = { ...r, skipped: "insufficient_credits" };
                } else {
                  next[key] = r;
                }
              }
              if (leftover > 0) setCreditSkipped((n) => Math.max(n, leftover));
              return next;
            });
            setPhase("done");
            setAnnounce(`Scan complete — ${total} ${total === 1 ? "repository" : "repositories"}.`);
          },
          // An SSE `error` event can arrive and the stream still end "cleanly" (runImportScan resolves
          // ok:true), so the outcome handler below never runs — without advancing the phase here the
          // wizard is stranded on "scanning" forever with no done-state and no way to recover. Move
          // back to "select" so the error shows and the user can retry.
          onError: (message) => {
            setError(message);
            setPhase("select");
          },
        },
      );
      if (!outcome.ok) {
        if (outcome.aborted) {
          setError(outcome.stalled ? "The scan stalled (no response). Please try again." : "Scan canceled.");
        } else {
          // An ACCESS refusal (401/403 from requireOrgAccess) is a known state with a real recovery —
          // render the gate step instead of echoing the server's raw string, which is the dead end the
          // public-preview funnel used to hit at its very last click. Anything else is a genuine
          // failure and keeps the server's diagnostic.
          const g = classifyScanFailure({ status: outcome.status, message: outcome.message }, sourceLabel);
          if (g) setGate(g);
          else setError(outcome.message ?? "Scan failed.");
        }
        setPhase("select");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }


  // Re-run ONE errored repo. The mechanism lives in retryRepo.ts (a pure function over injected deps)
  // so this hook doesn't grow another 80 lines and the retry is directly testable on its own.
  const retryRepo = (fullName: string) =>
    runRepoRetry({
      fullName,
      sourceLabel,
      sourceInstallId,
      credit,
      creditReady,
      fetchCredit,
      retries: retriesRef,
      setRows,
      setAnnounce,
    });

  return {
    router,
    phase,
    setPhase,
    org,
    setOrg,
    sourceLabel,
    sourceInstallId,
    setSourceInstallId,
    repos,
    setRepos,
    selected,
    setSelected,
    rows,
    setRows,
    error,
    setError,
    loading,
    announce,
    credit,
    previewScan,
    previewCause,
    invitedCount,
    setInvitedCount,
    creditSkipped,
    listTruncated,
    gate,
    setGate,
    flowRef,
    // The gate's title wins while a gate is up — it IS the step the user is looking at.
    stepAnnounce: gate ? gateAnnouncement(gate) : stepAnnounce,
    loadRepos,
    loadInstallationRepos,
    toggle,
    selectTop,
    clearSelection,
    cancelScan,
    resetRun,
    startScan,
    retryRepo,
  };
}
