"use client";

// The pending-invite roster. Extracted from MemberInvites.tsx (pure relocation of the <ul> region)
// so that file stays under the 200-LOC cap `src/features/**` carries while the panel grows the
// delivery disclosure it was missing (AGENTS.md: a file approaching the limit is the signal to
// extract, not to keep appending).

import type { InviteRow } from "./MembersTypes";
import { absoluteMoment, expiresIn } from "./memberTime";

export function InviteList({
  invites,
  copied,
  onCopy,
  onRevoke,
}: {
  invites: InviteRow[];
  copied: string | null;
  onCopy: (token: string) => void;
  onRevoke: (id: string) => void;
}) {
  // Rendering nothing left the owner unable to tell "nobody is waiting" from "the list didn't
  // load" — and the copy directly above promises a list. An empty state is the third state this
  // component can be in, so it says which one it is.
  if (invites.length === 0) {
    return (
      <p className="mt-3 type-mono-sm text-slate-600">No pending invites — everyone invited has joined or been revoked.</p>
    );
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {invites.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-2 type-mono-sm">
          <span className="text-slate-300">{i.githubLogin ? `@${i.githubLogin}` : i.email}</span>
          <span className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400">{i.role}</span>
          {i.invitedBy && <span className="text-slate-600">invited by @{i.invitedBy}</span>}
          {i.token ? (
            <button onClick={() => onCopy(i.token!)} className="text-accent transition hover:text-white">
              {copied === i.token ? "copied ✓" : "copy link"}
            </button>
          ) : (
            <span className="text-slate-600" title="The invite link is shown only when it's created. Revoke and re-issue to get a fresh link.">
              link shared at creation
            </span>
          )}
          <button onClick={() => onRevoke(i.id)} className="text-slate-600 transition hover:text-danger-soft">
            revoke
          </button>
          {/* Relative by default, absolute one hover away — the same sentence the invite mail sends
              the invitee, so one deadline reads one way (registry status-vocabulary →
              timestamp-display). The raw date left the owner subtracting to find what was lapsing. */}
          <span className="text-slate-600" title={absoluteMoment(i.expiresAt)}>
            {expiresIn(i.expiresAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
