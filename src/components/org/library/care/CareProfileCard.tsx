"use client";

// The profile card. Everything on it is SELF-STATED (the mentor interview) or a hint the developer
// confirmed — nothing is inferred from data, which is the difference between care and a score of a
// person. The card therefore always offers "edit in your local profile" rather than an in-app form:
// the machine holds the source of truth, ascent holds the history.

import { Kicker } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { CareAction, CareLinkAction } from "./CareBits";
import type { CarePersonalView } from "@/lib/org/care-view";

export function CareProfileCard({ profile, tone = "calm" }: { profile: CarePersonalView["profile"]; tone?: "calm" | "readout" }) {
  const shared = Boolean(profile.sharedAt);
  const mono = tone === "readout";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
      <div className="min-w-0">
        {shared ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className={mono ? "font-mono text-2xl font-bold text-white" : "text-2xl font-medium text-white"}>
                {profile.role ?? "Role not stated"}
              </h3>
              {profile.archetypeHint ? (
                <span className="rounded-full border border-accent/50 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-accent">
                  {profile.archetypeHint} (your word, not ours)
                </span>
              ) : null}
            </div>
            <div className="mt-4">
              <Kicker tone="muted">What you said you want</Kicker>
              {profile.goals.length ? (
                <ul className="mt-2 space-y-1.5">
                  {profile.goals.map((g) => (
                    <li key={g} className="flex gap-2 text-base text-slate-200">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {g}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-base text-slate-500">No goals recorded yet.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <h3 className="text-2xl font-medium text-white">Your profile lives on your machine</h3>
            <p className="mt-2 max-w-prose text-base text-slate-400">
              Run the mentor locally and it interviews you, reads your own transcripts and writes{" "}
              <span className="font-mono text-slate-300">profile.md</span>. Nothing appears here until you choose to share
              it — and then it is here on the next laptop too.
            </p>
          </>
        )}
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
          {shared ? `shared ${timeAgo(profile.sharedAt!)}` : "never shared"}
        </span>
        {shared ? (
          <>
            <CareAction label="Share an update" intent="mentor.share" />
            <CareLinkAction label="Edit in your local profile.md" intent="profile.openLocal" />
          </>
        ) : (
          <CareAction label="Install the mentor" intent="mentor.install" />
        )}
      </div>
    </div>
  );
}
