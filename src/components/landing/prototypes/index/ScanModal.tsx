"use client";

// Hero entry point for The Index: an action button that opens a dialog to start a scan. The dialog
// carries the expected-output rundown ("what you'll get"), and then one of two action surfaces:
//  • open deployments (or signed-in members) get the live repo input (ScanForm) plus a consent-gated
//    GitHub connect for the private-repo / saved-history path;
//  • gated deployments with no signed-in viewer get a "sign in to scan" panel instead — the wall is
//    enforced before any scan can run (first sign in, then scan).
// Replaces the inline hero input so the masthead stays clean and the promise is front-and-centre on open.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ScanForm } from "@/components/ScanForm";
import { QuotaMeter } from "@/components/QuotaMeter";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";
import { GitHubMark } from "@/components/auth/buttonChrome";
import { Kicker } from "@/components/ui";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

/** Which GitHub sign-in backend the deployment runs — decided server-side and passed down so the
 *  modal renders the matching CTA (or a get-started link when auth isn't configured at all). */
export type AuthMode = "supabase" | "github" | null;

// What a scan returns — the promise shown the moment the dialog opens. Counts come from the rubric so
// the copy can't drift from the model.
const OUTPUTS = [
  `A single 0–100 maturity score on a ${LEVELS.length}-level ladder`,
  `A radar across ${DIMENSIONS.length} weighted dimensions`,
  "The evidence behind every score",
  "A prioritized roadmap to climb to the next level",
];

/** Renders the GitHub sign-in affordance for whichever backend is configured (or a get-started
 *  fallback when none is). Shared by the gated "sign in to scan" panel and the private-repo connect CTA. */
function SignInButton({ auth, next, label }: { auth: AuthMode; next: string; label: string }) {
  const cls = "w-full justify-center";
  if (auth === "supabase") return <SupabaseSignInButton next={next} label={label} className={cls} />;
  if (auth === "github") return <GitHubSignInButton next={next} label={label} className={cls} />;
  // No auth backend on this deployment — fall back to the get-started flow rather than a dead button.
  return (
    <Link
      href="/onboarding"
      className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
    >
      <GitHubMark size={18} /> {label} →
    </Link>
  );
}

/** The "what you'll get" rundown, in a hairline panel matching the landing's bordered cards. */
function OutputsCard() {
  return (
    <div className="rounded-xl border border-divider bg-surface/40 p-5">
      <Kicker tone="muted">What you&apos;ll get</Kicker>
      <ul className="mt-3 space-y-2 text-base text-slate-300">
        {OUTPUTS.map((o) => (
          <li key={o} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0 text-accent" aria-hidden>→</span>
            <span>{o}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The private-repo GitHub connect CTA, gated on the consent checkbox. Until consent is given it's a
 *  disabled stand-in; once given it becomes the real connect for whichever backend is configured. */
function AuthCta({ auth, consent }: { auth: AuthMode; consent: boolean }) {
  if (!consent) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-base font-semibold text-slate-500"
      >
        <GitHubMark size={18} /> Continue with GitHub
      </button>
    );
  }
  return <SignInButton auth={auth} next="/connect" label="Continue with GitHub" />;
}

interface ScanModalProps {
  examples?: string[];
  auth: AuthMode;
  /** Whether the login wall is enforced on this deployment. When true, a scan requires a signed-in
   *  viewer — the dialog locks the scan form behind sign-in until one is present. */
  gated?: boolean;
}

/** Static stand-in shown while the Suspense boundary resolves during prerender — visually identical to
 *  the real trigger so the primary CTA is present in the cached HTML; hydration swaps in the live modal. */
function ScanTriggerFallback() {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-on-accent shadow-2xl shadow-black/40 transition hover:bg-accent-soft"
    >
      Scan a repository <span aria-hidden>→</span>
    </button>
  );
}

/** `ScanModalInner` reads `?scan=1` via `useSearchParams`; that de-opts any statically-optimizable page
 *  it's mounted on (the marketing homepage) unless it sits under a Suspense boundary. Isolate it here so
 *  the rest of the landing stays statically prerendered while the deep-link param resolves on the client. */
export function ScanModal(props: ScanModalProps) {
  return (
    <Suspense fallback={<ScanTriggerFallback />}>
      <ScanModalInner {...props} />
    </Suspense>
  );
}

function ScanModalInner({ examples, auth, gated = false }: ScanModalProps) {
  // `open` is DERIVED (below): the trigger toggles `manualOpen`, and a `?scan=1` deep-link opens it too.
  // Deriving instead of opening in an effect avoids a setState-in-effect cascade and any open-flash.
  const [manualOpen, setManualOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  // Signed-in state, resolved from the effective viewer (honors the dev bypass). Only consulted when
  // the gate is live; null until the fetch settles. Starts "locked" so a gated deploy never flashes
  // the scan form to a signed-out viewer.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Deep-link / cross-page entry: `?scan=1` opens the dialog, so a "Scan a repository" CTA on any page
  // (or the same-page register) lands directly on the action instead of one click short on the hero.
  const wantsScan = params.get("scan") === "1";
  const open = manualOpen || wantsScan;
  // Stable across renders (params/pathname/router are stable mid-session), so the focus effect that
  // depends on it doesn't re-run and re-grab focus while the dialog is open.
  const close = useCallback(() => {
    setManualOpen(false);
    // Drop a consumed `?scan=1`, else the derived `open` would immediately re-open (and a reload too).
    const sp = new URLSearchParams(params.toString());
    if (!sp.has("scan")) return;
    sp.delete("scan");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  // Resolve the viewer up front (not on open) so by the time the dialog is clicked the gate decision
  // is already settled. Skipped entirely when the gate is off — gating doesn't apply.
  useEffect(() => {
    if (!gated) return;
    let active = true;
    fetch("/api/auth/viewer")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`viewer ${r.status}`))))
      .then((d) => active && setSignedIn(Boolean(d?.signedIn)))
      // The gate is only a UX optimization — the scan endpoint enforces the login wall server-side. If
      // the viewer check itself FAILS (network blip / 5xx), do NOT cache "signed out": the old
      // `.catch(() => setSignedIn(false))` (and a non-ok response) locked a real signed-in member out of
      // the hero's primary CTA for the whole page lifetime. Fail OPEN to the scan form instead — a
      // genuinely signed-out user still hits the server 401 on submit, with a clear sign-in message.
      .catch(() => active && setSignedIn(true));
    return () => {
      active = false;
    };
  }, [gated]);

  // Close on Escape, lock background scroll, move focus INTO the dialog, trap Tab inside it, and return
  // focus to the trigger on close. Moving focus in matters because ScanForm only autofocuses its input
  // on wide + fine-pointer viewports — and the gated "sign in to scan" branch has no form at all — so
  // without this, touch/SR users would open the dialog with focus stranded on the now-obscured trigger.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current; // stable node; capture for the cleanup's focus-return
    const panel = panelRef.current;
    // Enter the dialog, unless a child (ScanForm's input on desktop) already grabbed focus this tick.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Focus trap: keep Tab cycling within the dialog rather than escaping to the page behind it.
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open, close]);

  // The scan form is reachable only when the wall is open, or a signed-in viewer is confirmed.
  const locked = gated && signedIn !== true;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setManualOpen(true)}
        aria-haspopup="dialog"
        className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-on-accent shadow-2xl shadow-black/40 transition hover:bg-accent-soft"
      >
        Scan a repository <span aria-hidden>→</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            // Backdrop click closes; clicks inside the panel (which stops propagation) don't.
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-modal-title"
            className="animate-fade-up relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-divider bg-surface-strong shadow-2xl outline-none ring-1 ring-white/5"
          >
            {/* Azure altimeter glow bleeding from the top edge — the landing's signature accent wash. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(42rem_18rem_at_50%_-32%,rgba(59,158,255,0.16),transparent_65%)]"
            />

            <div className="relative p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Kicker>Start a scan</Kicker>
                  <h2 id="scan-modal-title" className="mt-1.5 text-2xl font-bold tracking-tight text-white">
                    Scan a repository
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="focus-ring -mr-1 -mt-1 rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
                >
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <p className="mt-4 text-base leading-relaxed text-slate-300">
                {locked
                  ? "Paste any GitHub repo and Ascent reads it in about a minute. Here's what comes back:"
                  : "Paste any public GitHub repo. In about a minute, Ascent reads it and returns:"}
              </p>

              <div className="mt-4">
                <OutputsCard />
              </div>

              {locked ? (
                // Gate is live and no viewer — sign-in is the only path to a scan (first sign in, then scan).
                <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-5">
                  <Kicker>Sign in to scan</Kicker>
                  <p className="mt-2 text-base leading-relaxed text-slate-300">
                    Scanning is for signed-in members on this deployment. Sign in with GitHub to run your
                    scan — public repositories are free, and you&apos;ll also unlock private repos and saved
                    history.
                  </p>
                  <div className="mt-4">
                    <SignInButton auth={auth} next="/" label="Sign in with GitHub to scan" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-5">
                    <ScanForm autoFocus examples={examples} showExamples={false} auth={auth} />
                    <QuotaMeter />
                  </div>

                  <div className="my-6 flex items-center gap-3">
                    <span className="h-px flex-1 bg-divider" />
                    <Kicker tone="muted">Private repo?</Kicker>
                    <span className="h-px flex-1 bg-divider" />
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="text-sm leading-relaxed text-slate-400">
                      Authorize Ascent to read your repositories through the GitHub App — needed only for
                      private repos and saved scan history. Public scans never need an account.
                    </span>
                  </label>

                  <div className="mt-4">
                    <AuthCta auth={auth} consent={consent} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
