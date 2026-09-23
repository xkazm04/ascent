"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";
import type { OrgRepo, RepoStanding } from "@/components/onboarding/types";
import { applyRunOverlay, overlayFromRun, standingFromWire } from "@/components/onboarding/repoStanding";
import type { RepoState } from "@/lib/db";
import { runImportScan } from "@/components/onboarding/importScan";
import { resolveScanMode, type CreditRead } from "@/components/onboarding/scanMode";
import { runRepoRetry } from "@/components/onboarding/retryRepo";
import { byProminence } from "@/components/onboarding/byProminence";
import { getAutoWatchOptIn, resetAutoWatchOptIn } from "@/components/onboarding/OnboardingSelectStep.watchOptIn";
import { getPreviewFirst, resetPreviewFirst } from "@/components/onboarding/OnboardingSelectStep.previewFirst";
import { resolveImportPlan } from "@/components/onboarding/importPlan";
import { setUpgradeScanFlag } from "@/components/onboarding/upgradeScan";
import { classifyScanFailure, gateAnnouncement, type ScanGate } from "@/components/onboarding/scanGate";
import { leftoverSkipReason, type ImportNotice } from "@/components/onboarding/skipReason";
import { useImportReattach } from "@/components/onboarding/useImportReattach";
import type { PickErrorSource } from "@/components/onboarding/OnboardingPickStep";
import {
  MAX_LIST,
  MAX_SELECT,
  RESUME_KEY,
  type OrgCredit,
  type Phase,
  type ResumeSnapshot,
  topSelection,
} from "@/components/onboarding/OnboardingFlow.model";
import {
  decodeSnapshot,
  encodeSnapshot,
  initialRun,
  rowSettled,
  runMode,
  runReducer,
  type Update,
} from "@/components/onboarding/OnboardingFlow.run";

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
  const [org, setOrg] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  // The installation id behind the current source, when scanning through the GitHub App. It's
  // threaded into the import POST so the server mints an installation token and can read private
  // repos; null for the public-handle path (token-less / GITHUB_TOKEN listing).
  const [sourceInstallId, setSourceInstallId] = useState<string | null>(null);
  const [repos, setRepos] = useState<OrgRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // G6-10: which of the pick step's three entry points (installation button, suggested-org button,
  // handle text form) produced `error`, so the UI can route the error/focus to that control instead
  // of always yanking focus to the unrelated handle input. Set at the start of each loader (so it's
  // always in sync with whichever attempt is in flight/just failed); read alongside `error` by PickStep.
  const [errorSource, setErrorSource] = useState<PickErrorSource>("form");
  const [loading, setLoading] = useState(false);
  const [announce, setAnnounce] = useState("");
  // Whether the public listing STOPPED LOOKING before the end of the account (/api/org/repos returns
  // `truncated` for exactly this: its page budget ran out with more pages available). The flag has been
  // on the response since the listing was bounded, but nothing ever read it — so a fork-heavy org's
  // partial list was presented as the org's complete reality. The select step discloses it.
  const [listTruncated, setListTruncated] = useState(false);

  // THE RUN (first-run-onboarding-wizard#A): phase, rows, gate, credit, plan, consent, notices, run
  // handle, re-attach flag and invite count live in ONE reducer (OnboardingFlow.run.ts). Its reset is
  // initialRun(), so "Scan another" can no longer leak a field someone forgot to add to a setter list
  // (ambiguity-ui #3 was exactly that: credit/previewCause/invitedCount leaked into run 2). The
  // done-screen mode flags are DERIVED from the recorded plan rather than stored beside it, so a run
  // re-attached from a v2 snapshot discloses live vs preview (and its owed upgrade) truthfully.
  const [run, dispatch] = useReducer(runReducer, undefined, initialRun);
  const { phase, rows, gate, credit, notices, invitedCount, reattached } = run;
  const importRunId = run.runId;
  const { previewScan, modeResolved, upgradePlanned, previewCause } = runMode(run);
  const setPhase = (next: Phase) => dispatch({ type: "phase", phase: next });
  const setRows = (update: Update<Record<string, ScanRow>>) => dispatch({ type: "rows", update });
  const setGate = (next: ScanGate | null) => dispatch({ type: "gate", gate: next });
  const setInvitedCount = (update: Update<number>) => dispatch({ type: "invited", update });
  const setCredit = (next: OrgCredit | null) => dispatch({ type: "credit", credit: next });

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

  // The in-flight credit read for the App-path source. It resolves to the OrgCredit, null ("the org
  // verifiably has no readable credit object"), or "failed" (the read itself errored — balance UNKNOWN,
  // a distinct state: fail-closed-to-preview is deliberate billing safety, but the cause must be
  // distinguishable so startScan can retry once and the done screen can explain honestly). startScan
  // awaits this so the money-gate decision never reads a null `credit` from an un-awaited fetch and
  // fabricates a preview on an org that actually has credits (ONB-1 race).
  const creditReady = useRef<Promise<CreditRead> | null>(null);

  // first-run-onboarding-wizard#B: what THIS session's finished runs scored, by fullName. "Scan
  // another" re-lists the installation, and /api/app/repos serves a 30s payload cache that can still
  // carry the pre-scan state; the overlay makes the next listing show (and preselect around) the run
  // the user just watched finish. Session memory only: the server's state catches up on its own.
  const runOverlay = useRef<Record<string, RepoStanding>>({});

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
  // G6-11: the numeric step behind both the sr-only announcement above AND the visible stepper the
  // Shell now renders — one source of truth so the two can never drift. A gate always surfaces while
  // `phase` is still "select" (see startScan/the personal-org check below), so no separate branch
  // is needed for it.
  const stepNumber: 1 | 2 | 3 = phase === "pick" ? 1 : phase === "select" ? 2 : 3;
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
    setStepAnnounce(`Step ${stepNumber} of 3: ${titles[phase]}`);
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
  // before that effect could overwrite it). Reads the saved source + selection and re-enters the step
  // it was taken on: a "scanning" snapshot with a run handle RE-ATTACHES to that run (below), and
  // anything else re-fetches the repo list live and lands back on select.
  const rehydrated = useRef(false);
  useEffect(() => {
    if (rehydrated.current || typeof window === "undefined") return;
    rehydrated.current = true;
    // v1 or v2 (OnboardingFlow.run.ts decodes both; a malformed snapshot is no snapshot).
    let snap: ResumeSnapshot | null = null;
    try {
      snap = decodeSnapshot(sessionStorage.getItem(RESUME_KEY));
    } catch {
      snap = null;
    }
    if (snap?.phase === "scanning" && snap.runId && snap.sourceLabel) {
      // A run was in flight when this tab went away. It did NOT stop (the import route's mapPool is
      // not tied to the request signal), so re-enter the scan step and FOLLOW it — re-running would
      // scan and charge the same repos twice, and going back to "select" would hide it entirely.
      resumeRunning(snap);
    } else if (snap?.sourceLabel) {
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
      // The snapshot now carries the STEP and, while scanning, the run's server-side handle. Without
      // them a refresh mid-scan rehydrated to "select" — the repo picker, with no sign that the run
      // was still going (and still spending) on the server, whose obvious next move is to run the
      // same scan a second time. v2 also carries the run's PLAN and CONSENT: without them a re-attached
      // run could not tell a live run from a preview (or a preview whose live upgrade is owed).
      const scanning = phase === "scanning";
      const raw = encodeSnapshot({
        org,
        sourceLabel,
        sourceInstallId,
        selected: [...selected],
        phase: scanning ? "scanning" : "select",
        runId: scanning ? run.runId : null,
        plan: scanning ? run.plan : null,
        consent: scanning ? run.consent : null,
      });
      sessionStorage.setItem(RESUME_KEY, raw);
    } catch {
      /* sessionStorage unavailable (private mode / quota) — resumability is best-effort */
    }
  }, [phase, org, sourceLabel, sourceInstallId, selected, run.runId, run.plan, run.consent]);

  // Re-enter the SCANNING step for a run that is still going server-side. Everything the step needs
  // comes from the snapshot (no repo re-listing: the rows, not the picker, are what the user is
  // looking at); the job states then arrive from the queue poll below.
  // A v2 snapshot also restores the run's plan and consent; a v1 one leaves both null, and only the
  // plan-dependent disclosures fall back to their defaults.
  function resumeRunning(snap: ResumeSnapshot) {
    setOrg(snap.org || snap.sourceLabel);
    setSourceLabel(snap.sourceLabel);
    setSourceInstallId(snap.sourceInstallId);
    setSelected(new Set(snap.selected));
    dispatch({
      type: "resume",
      repos: snap.selected,
      runId: snap.runId ?? null,
      plan: snap.plan ?? null,
      consent: snap.consent ?? null,
    });
    // A Retry on the done screen re-checks the money gate, which needs this source's balance. Kick the
    // read off now, as the App-path loader does; without it a re-attached paid run retried as a mock.
    if (snap.sourceInstallId) creditReady.current = fetchCredit(snap.sourceLabel);
    setAnnounce("Reconnected to a scan that is still running.");
  }

  // Re-fetch the saved source's repos, then re-apply the saved selection (landing on the select step).
  async function resumeFrom(snap: ResumeSnapshot) {
    if (snap.sourceInstallId) await loadInstallationRepos(snap.org || snap.sourceLabel, snap.sourceInstallId);
    else await loadRepos(undefined, snap.sourceLabel);
    // Override the loaders' default top-N selection with the user's saved picks. A pick that's no
    // longer in the freshly loaded list is harmless (startScan intersects selection with `repos`).
    if (snap.selected.length) setSelected(new Set(snap.selected));
  }

  async function loadRepos(e?: React.FormEvent, preset?: string, source: PickErrorSource = "form") {
    e?.preventDefault();
    const handle = (preset ?? org).trim().replace(/^@/, "");
    if (!handle) return;
    if (preset) setOrg(preset);
    setLoading(true);
    setError(null);
    setErrorSource(source);
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
  // /api/app/repos (listInstallationReposResult, including `truncated`), then feed the SAME
  // select+scan flow as the public listing. This is the bridge the connect page advertises —
  // onboarding can finally reach a private repo, the highest-value activation moment.
  async function loadInstallationRepos(login: string, id: string) {
    setOrg(login);
    setLoading(true);
    setError(null);
    setErrorSource("installation");
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
      // The /api/app/repos rows carry extra fields (url, state, dOverall); normalize to OrgRepo. The
      // `state` is KEPT as the row's standing (it used to be dropped here), then this session's own
      // finished runs are overlaid on it, since the route's payload cache can predate them.
      const list = applyRunOverlay(
        ((data.repos ?? []) as (Partial<OrgRepo> & { state?: Partial<RepoState> | null })[]).map((r) => ({
          fullName: String(r.fullName),
          private: Boolean(r.private),
          language: r.language ?? null,
          stars: r.stars ?? 0,
          pushedAt: r.pushedAt ?? null,
          standing: standingFromWire(r.state),
        })),
        runOverlay.current,
      )
        .sort(byProminence)
        .slice(0, MAX_LIST);
      if (list.length === 0) throw new Error("No repositories accessible to this installation.");
      setRepos(list);
      // Same honesty as the public listing: a page-capped GitHub App list is incomplete, not the
      // whole installation. GET /api/app/repos now returns `truncated`; the select step discloses it.
      setListTruncated(Boolean(data.truncated));
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

  // "Scan another": reset the FULL per-run state. The run half is `initialRun()` — derived from the
  // RunState type, so no field can be forgotten (the old 17-setter list leaked credit, previewCause and
  // invitedCount into run 2, ambiguity-ui #3). The source is dropped too, and the resume snapshot with
  // it: this is the user's explicit start-over, so it is the snapshot's reaper. Keeping sourceLabel
  // made the persist effect rewrite {phase:"select", sourceLabel:<old>}, and a refresh reopened it.
  function resetRun() {
    // Hand the finished run's scored rows to the session overlay BEFORE the reset drops them: they are
    // the only client record of what the run just measured (and whether it was a preview).
    runOverlay.current = {
      ...runOverlay.current,
      ...overlayFromRun(run.rows, run.plan, repos, new Date().toISOString()),
    };
    dispatch({ type: "reset" });
    creditReady.current = null;
    setRepos([]);
    setSelected(new Set());
    setError(null);
    setSourceInstallId(null);
    setSourceLabel("");
    setListTruncated(false);
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* sessionStorage unavailable — nothing was persisted either */
    }
    // The autoscan opt-in is per-run consent, not a sticky preference: a second run must start from
    // the safe default rather than inherit a tick the user made for a different repo set. Preview-
    // first likewise returns to its (safe, ON) default — a run that deliberately paid up front must
    // not silently make the NEXT run pay up front too.
    resetAutoWatchOptIn();
    resetPreviewFirst();
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
    // The run records the select step's consent as it starts: the snapshot persists it, and a Retry
    // reads it back instead of the module stores (which a reload resets to their defaults).
    const consent = { previewFirst: getPreviewFirst(), watchOptIn: getAutoWatchOptIn() };
    setError(null);
    dispatch({ type: "start", repos: picks.map((r) => r.fullName), consent });
    setAnnounce(`Scanning ${picks.length} ${picks.length === 1 ? "repository" : "repositories"}.`);

    const controller = new AbortController();
    abortRef.current = controller;
    const total = picks.length;
    // Notices as they arrive, for the leftover resolution in onResult (which cannot read the state it
    // just queued). One array per run, so a previous run's cap can never explain this one.
    const seen: ImportNotice[] = [];
    // The repos this stream has settled, for the live-region count (read synchronously, like `seen`).
    const settled = new Set<string>();
    // Settle the balance before deciding real-vs-preview. The whole decision (await the in-flight read,
    // retry once on an unknown balance, fail closed) lives in scanMode.ts so the per-repo retry on the
    // done screen re-checks the money gate through the SAME code path. The credit read is its own fetch
    // (not tied to `controller`), so it still resolves if the user cancels mid-wait; an aborted
    // controller is handled below by runImportScan ("Scan canceled").
    // Run a REAL scan on the App path when the org has credits (the import route meters + refunds on
    // failure) — otherwise a disclosed preview, so a credit-less org never dead-ends on a 402 and
    // scores are never silently fabricated. G7-17: the PUBLIC-handle funnel is ALSO real now — no
    // installation means public repos only, which `/report?repo=` already scores for free against the
    // monthly public-scan allowance. A preview there was the one place the funnel showed numbers no
    // model produced, and those rows feed the public register.
    const { canRunReal, creditUnknown, publicFunnel } = await resolveScanMode({
      sourceInstallId,
      sourceLabel,
      credit,
      creditReady,
      fetchCredit,
    });
    // W6b "fast preview first": on the App path with real headroom, the select step's (default-ON)
    // toggle turns this run into an instant mock preview and defers the LIVE, credit-drawing scan to
    // the dashboard header (one-shot flag written in onResult below). The whole request matrix —
    // mock/watch/schedule and whether an upgrade is owed — is the pure resolveImportPlan, so the
    // disclosed choreography and the committed POST cannot drift.
    const plan = resolveImportPlan({ canRunReal, publicFunnel, sourceInstallId, ...consent });
    // Recorded on the run (and so in the snapshot). An upgrade run IS a preview run (plan.mock), and
    // runMode() discloses it with the handoff copy instead of the "install the App / top up" recovery.
    const previewCause = !canRunReal && creditUnknown ? "credit_unknown" : null;
    dispatch({ type: "plan", plan: { ...plan, publicFunnel, previewCause } });
    try {
      const outcome = await runImportScan(
        {
          org: sourceLabel,
          repos: picks.map((r) => r.fullName),
          // Pass the installation id (when this source came from the GitHub App) so the server
          // mints an installation token — required to read the private repos we just listed.
          installationId: sourceInstallId ?? undefined,
          mock: plan.mock,
          // G7-17: tell the server to meter this run against the free monthly public-scan allowance
          // rather than prepaid credits. Only ever true on the token-less public-handle path.
          publicFunnel,
          // Recurring weekly autoscan enrolment is OPT-IN (the select step's checkbox writes this
          // store). Omitting the field meant runImportScan defaulted it to `Boolean(installationId)` —
          // true on every App-path run — so a scan click silently subscribed each repo to a standing,
          // billable weekly draw. Pass it EXPLICITLY: the server also defaults `watch` to true, so
          // "not opted in" must travel as false, never as an omission. The ONE exception is a
          // preview-then-upgrade run (plan.upgradeAfter), which watches with `schedule: "off"` when
          // not opted in — the header's live upgrade scans WATCHED repos only, and watching without a
          // schedule carries no recurring draw (see resolveImportPlan).
          watch: plan.watch,
          schedule: plan.schedule,
        },
        controller,
        {
          onRepo: ({ repo, level, overall, error: rowError, skipped }) => {
            const row = { repo, level, overall, error: rowError, skipped };
            dispatch({ type: "repo", row });
            // Skipped rows are terminal too (rowSettled), so a credit shortfall still counts up.
            if (rowSettled(row)) settled.add(repo);
            else settled.delete(repo);
            setAnnounce(`Scanned ${settled.size} of ${total}: ${repo}.`);
          },
          // EVERY notice is kept, not just the credit one: the server caps a batch for four distinct
          // reasons and each has a different recovery. `seen` is the same list, collected locally so
          // onResult below can read it synchronously (a state read there would see the pre-run value).
          // The run's identity, before any repo is scanned — persisted by the snapshot effect below, so
          // a refresh one second later can still find this run.
          onQueued: ({ runId }) => dispatch({ type: "queued", runId }),
          onNotice: (notice) => {
            seen.push(notice);
            dispatch({ type: "notice", notice });
          },
          onResult: (data) => {
            // The stream is done: any row still with no level/error/skipped was never reported (the
            // route emits no event for the repos it sliced off), so resolve those ghosts to a skipped
            // state instead of leaving a perpetual "scanning…" row + stuck progress bar. The reason is
            // the one the SERVER gave for capping this batch — or the neutral "not_scanned" when it
            // gave none. The old unconditional "insufficient_credits" relabel is exactly how a
            // monthly-allowance stop became a prepaid-balance lie on the done screen.
            // The same `result` action also records a late-joined runId and moves to "done".
            dispatch({ type: "result", runId: data?.runId, reason: leftoverSkipReason(seen) });
            // Preview-then-upgrade handoff: the mock rows are persisted, so record the one-shot flag
            // NOW (org + exact repo set). The dashboard header consumes it on mount and starts the
            // live scan there; a wizard refresh can't re-write it (the done phase never re-runs).
            if (plan.upgradeAfter) {
              setUpgradeScanFlag(
                sourceLabel,
                picks.map((r) => r.fullName),
              );
            }
            setAnnounce(`Scan complete. ${total} ${total === 1 ? "repository" : "repositories"}.`);
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
      // Direction 6: the retry resolves its request plan from the SAME consent the batch used, so
      // watch/schedule/publicFunnel travel with the retry instead of falling back to runImportScan's
      // App-path defaults (which re-subscribed a declined repo to the weekly draw). That is the RUN's
      // recorded consent: after a reload the module stores are back at their defaults, and reading
      // them downgraded a re-attached paid live run to a mock. Before any run has recorded one, the
      // stores are read at click time, as before.
      ...(run.consent ?? { previewFirst: getPreviewFirst(), watchOptIn: getAutoWatchOptIn() }),
      setRows,
      setAnnounce,
    });

  // RE-ATTACH: follow a run restored from a snapshot until every job settles. Read-only — the polling
  // lives in its own co-located hook (useImportReattach) so this module doesn't grow another block,
  // and it is inert (`active:false`) for every normally-started run.
  const reattach = useImportReattach({
    active: reattached && phase === "scanning",
    org: sourceLabel,
    runId: importRunId,
    // Never overwrites a settled row — the poll's view (job states) is coarser than anything on screen.
    onRows: (incoming) => dispatch({ type: "reattachRows", rows: incoming }),
    onSettled: () => {
      // The run is over. Rows the queue never accounted for get the neutral reason, exactly as the
      // streamed path resolves its leftovers — never an invented credit shortfall.
      dispatch({ type: "reattachSettled" });
      // The owed live upgrade survives the refresh: a v2 snapshot restored the plan, so the one-shot
      // handoff is written here exactly as the streamed path writes it on `result`.
      if (run.plan?.upgradeAfter) setUpgradeScanFlag(sourceLabel, [...selected]);
      setAnnounce("The scan you reconnected to has finished.");
    },
  });

  // Leaving mid-scan is expensive and invisible: the server keeps scanning (and, on a metered run,
  // charging) after the tab is gone. Ask before it happens. Registered only while a scan is actually
  // in flight and removed on settle/unmount, so it can never linger over the done screen. The browser
  // shows its own generic wording — preventDefault is the whole API.
  useEffect(() => {
    if (phase !== "scanning" || typeof window === "undefined") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

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
    errorSource,
    loading,
    announce,
    credit,
    previewScan,
    modeResolved,
    previewCause,
    upgradePlanned,
    invitedCount,
    setInvitedCount,
    notices,
    listTruncated,
    importRunId,
    // The reconnected surface: "off" for a run this tab started, otherwise the poll's live state.
    reattach,
    gate,
    setGate,
    flowRef,
    stepNumber,
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
