"use client";

// The "email me the report link" opt-in shown under the scan form. A live scan runs for minutes, so a
// signed-in user can ask to be emailed the report link rather than copying it down. State lives in
// ScanForm so submit() can read it.
//
// THE OPT-IN DOES NOT DETACH THE RUN, and the copy here must never imply it does. The scan's abort
// signal IS the client connection (api/scan/stream/route.ts passes request.signal into runScan), the
// disconnect catch refunds the quota slot and the credit, and the email is dispatched inside start()
// after the result frame - so closing the tab yields no report, no persisted row and no email. This
// copy used to read "Email me when it's done" over "(scans take a few minutes)", with a signed-out
// nudge saying "Don't want to wait? ... we'll email you the report when it's ready": a promise the
// server is built to refuse, in the same shape as the custom-address promise removed below.
// A detachable run was scoped as a real card (keeper-owned scan finalized in after(), re-attach over
// the existing coalesce join) and REJECTED on 2026-10-05: abort-on-disconnect is deliberate cost
// control, and the operator chose to keep the ceiling and fix the claim. The card and its premise are
// in .claude/scan-history/challenge-2026-10-05-cards.json if that trade is ever revisited; until then
// the tab-open requirement is stated, not implied.
// (scan-sweep --challenge challenge-2026-10-05, card 9 rejected)
//
// When the signed-in account exposes NO email (GitHub can hide it), the toggle is replaced by an honest
// explanation instead of a custom-address field. The stream route's open-relay hardening only ever
// sends to the viewer's own verified account address — a client-supplied address from an authenticated
// viewer is silently dropped server-side — so collecting one here walked the user through a promise
// ("email me when it's done", address validated, scan runs) the server is designed to refuse.
// (ambiguity-ui-scan-2026-07-16 scan-pipeline-ingestion #1)
//
// For a SIGNED-OUT visitor — the default first-timer, and the one most likely to abandon a multi-minute
// wait — the slot becomes a sign-in nudge instead of nothing: notify is the textbook reason to make an
// account, so the highest-friction part of the first run doubles as the conversion ask. The nudge only
// appears when an auth backend exists to sign into (auth != null); otherwise this renders nothing as before.

import { useId } from "react";
import { SignInButtonFor, type AuthMode } from "@/components/auth/SignInButtonFor";

export function NotifyToggle({
  signedIn,
  viewerEmail,
  notifyOn,
  onNotifyChange,
  auth = null,
}: {
  signedIn: boolean;
  viewerEmail?: string | null;
  notifyOn: boolean;
  onNotifyChange: (v: boolean) => void;
  /** The deployment's sign-in backend — drives the signed-out nudge (null hides it). */
  auth?: AuthMode;
}) {
  const id = useId();
  if (!signedIn) {
    // Nothing to sign into on this deployment → keep the prior "render nothing" behavior.
    if (!auth) return null;
    return (
      <div className="mt-3 text-left type-mono-sm text-slate-400">
        <p>
          <span className="text-slate-500">Want the link on record?</span> Scans take a few minutes.
          Sign in and we&apos;ll email you the report link when it&apos;s ready, so you don&apos;t have to
          copy it down.
        </p>
        <div className="mt-2">
          <SignInButtonFor auth={auth} next="/" variant="nav" label="Sign in to get the link emailed" />
        </div>
      </div>
    );
  }
  if (!viewerEmail) {
    // Signed in, but the account exposes no email: the server will only ever send to the verified
    // account address, so there is genuinely nothing to opt into. Say so honestly instead of offering
    // a checkbox + custom-address field whose promise the stream route silently drops.
    return (
      <p className="mt-3 text-left type-mono-sm text-slate-400">
        <span className="text-slate-500">Don&apos;t want to wait?</span> Your account has no email address,
        so we can&apos;t notify you when a scan finishes. Add one to your GitHub account (Settings →
        Emails) and sign in again to get the report link by email.
      </p>
    );
  }

  return (
    <div className="mt-3 text-left">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 type-mono-sm text-slate-300">
        <input
          id={id}
          type="checkbox"
          checked={notifyOn}
          onChange={(e) => onNotifyChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-accent focus-ring"
        />
        Email me the report link when it&apos;s done
        <span className="text-slate-500">(scans take a few minutes)</span>
      </label>

      {notifyOn && (
        <p className="mt-1.5 pl-6 type-mono-sm text-slate-500">
          We&apos;ll email you at <span className="text-slate-300">{viewerEmail}</span>. Keep this tab open:
          closing it cancels the scan.
        </p>
      )}
    </div>
  );
}
