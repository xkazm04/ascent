"use client";

// The "email me when it's done" opt-in shown under the scan form. A live scan runs for minutes, so a
// signed-in user can ask to be emailed the report link instead of waiting on the tab. State lives in
// ScanForm so submit() can read it.
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
      <div className="mt-3 text-left font-mono text-sm text-slate-400">
        <p>
          <span className="text-slate-500">Don&apos;t want to wait?</span> Scans take a few minutes —
          sign in and we&apos;ll email you the report when it&apos;s ready.
        </p>
        <div className="mt-2">
          <SignInButtonFor auth={auth} next="/" variant="nav" label="Sign in to get emailed" />
        </div>
      </div>
    );
  }
  if (!viewerEmail) {
    // Signed in, but the account exposes no email: the server will only ever send to the verified
    // account address, so there is genuinely nothing to opt into. Say so honestly instead of offering
    // a checkbox + custom-address field whose promise the stream route silently drops.
    return (
      <p className="mt-3 text-left font-mono text-sm text-slate-400">
        <span className="text-slate-500">Don&apos;t want to wait?</span> Your account has no email address,
        so we can&apos;t notify you when a scan finishes — add one to your GitHub account (Settings →
        Emails) and sign in again to get the report link by email.
      </p>
    );
  }

  return (
    <div className="mt-3 text-left">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 font-mono text-sm text-slate-300">
        <input
          id={id}
          type="checkbox"
          checked={notifyOn}
          onChange={(e) => onNotifyChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-accent focus-ring"
        />
        Email me when it&apos;s done
        <span className="text-slate-500">— scans take a few minutes</span>
      </label>

      {notifyOn && (
        <p className="mt-1.5 pl-6 font-mono text-sm text-slate-500">
          We&apos;ll email you at <span className="text-slate-300">{viewerEmail}</span>.
        </p>
      )}
    </div>
  );
}
