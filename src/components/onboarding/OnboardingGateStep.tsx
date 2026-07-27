"use client";

// The wizard's ACCESS-GATE step. It replaces the scan when /api/org/import refuses the kickoff with
// an auth decision (401/403) — the last click of the advertised free public-org preview, which used
// to dead-end on the raw server string ("Sign in to manage this organization.") with no sign-in
// affordance anywhere in the flow.
//
// The sign-in CTA returns to /onboarding, and the wizard's RESUME_KEY sessionStorage snapshot
// (OnboardingFlow.model.ts) rehydrates the source + selection on the way back — so the round-trip
// costs the user nothing. `next=/onboarding` is a root-relative path, which is exactly what
// safeNext() (src/lib/auth.ts) preserves for both the Supabase and custom-OAuth callbacks.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SignInButtonFor, type AuthMode } from "@/components/auth/SignInButtonFor";
import type { ScanGate } from "@/components/onboarding/scanGate";

export function GateStep({
  gate,
  auth,
  selectedCount,
  onBack,
}: {
  gate: ScanGate;
  /** Which OAuth backend this deployment runs — resolved server-side by the onboarding page. */
  auth: AuthMode;
  /** How many repositories are still selected behind the gate — the thing we promise to keep. */
  selectedCount: number;
  onBack: () => void;
}) {
  const signin = gate.kind === "signin";
  return (
    <div key="gate" className="animate-phase-in">
      {/* Focus target for the step transition, matching every other step (ONB a11y #1). */}
      <h2
        data-step-heading
        tabIndex={-1}
        className="text-2xl font-bold text-white focus:outline-none"
      >
        {signin ? "Sign in to run this scan" : "You don't have access to this organization"}
      </h2>

      <Surface radius="xl" className="mt-4 p-5">
        <Kicker>{signin ? "One step left" : "Access"}</Kicker>
        <p className="mt-2 text-base text-slate-300">
          {signin ? (
            <>
              Scanning <span className="font-mono text-white">{gate.org}</span> needs a GitHub sign-in
              on this deployment. It&apos;s free, takes one round-trip, and{" "}
              {selectedCount > 0 ? (
                <>
                  we&apos;ll bring you straight back here with your{" "}
                  <span className="font-mono tabular-nums text-white">{selectedCount}</span> selected{" "}
                  {selectedCount === 1 ? "repository" : "repositories"} intact.
                </>
              ) : (
                <>we&apos;ll bring you straight back here.</>
              )}
            </>
          ) : (
            <>
              You&apos;re signed in, but your account isn&apos;t a member of{" "}
              <span className="font-mono text-white">{gate.org}</span>, so Ascent won&apos;t write
              scans into it. Install the Ascent GitHub App on that organization to claim it — or scan
              an organization you belong to.
            </>
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {signin ? (
            <SignInButtonFor auth={auth} next="/onboarding" label="Sign in with GitHub" />
          ) : (
            <Link
              href="/connect"
              className="focus-ring rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Connect the GitHub App →
            </Link>
          )}
          <button
            type="button"
            onClick={onBack}
            className="focus-ring rounded-lg border border-divider px-4 py-2.5 text-base text-slate-300 transition hover:border-slate-600"
          >
            Back to repositories
          </button>
        </div>

        {signin && auth === null && (
          // No OAuth backend on this deployment — a sign-in button would be a dead affordance, so say
          // what's actually true instead of rendering one.
          <p className="mt-3 text-sm text-slate-500">
            Sign-in isn&apos;t configured on this deployment. Ask an administrator to enable GitHub
            login, or run the scan from a deployment that has it.
          </p>
        )}
      </Surface>
    </div>
  );
}
