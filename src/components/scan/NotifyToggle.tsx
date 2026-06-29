"use client";

// The "email me when it's done" opt-in shown under the scan form. A live scan runs for minutes, so a
// signed-in user can ask to be emailed the report link instead of waiting on the tab. When the account
// has no email (GitHub can hide it), a custom-address field appears. State lives in ScanForm so submit()
// can read it.
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
  customEmail,
  onCustomEmailChange,
  auth = null,
}: {
  signedIn: boolean;
  viewerEmail?: string | null;
  notifyOn: boolean;
  onNotifyChange: (v: boolean) => void;
  customEmail: string;
  onCustomEmailChange: (v: string) => void;
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
  const needsCustom = notifyOn && !viewerEmail;

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

      {notifyOn && viewerEmail && (
        <p className="mt-1.5 pl-6 font-mono text-sm text-slate-500">
          We&apos;ll email you at <span className="text-slate-300">{viewerEmail}</span>.
        </p>
      )}

      {needsCustom && (
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={customEmail}
          onChange={(e) => onCustomEmailChange(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address for the report notification"
          className="mt-1.5 ml-6 w-64 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-accent"
        />
      )}
    </div>
  );
}
