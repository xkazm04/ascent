"use client";

// The shared "→ Track as initiative" affordance — the last button the diagnostic tabs were missing.
// Adoption, Delivery and Tech Stacks each construct a complete picture of what to do next and then
// (before this) handed off by hyperlink, throwing the structured payload away at the tab boundary.
// This button POSTs the payload they already hold to /api/org/initiatives, exactly like the
// Simulator's trackAsInitiative does (the canonical precedent): server-side createInitiative is
// idempotent on (org, title, dimId) and merges repos, so a double-click or retry can't duplicate.
//
// Authorization is deliberately NOT pre-checked here: the route runs requireOrgAccess, and a viewer
// without write access sees the failure as inline error text. Pre-hiding the button would need role
// plumbing through four server tabs for a control whose failure mode is already honest.

import { useState } from "react";
import Link from "next/link";
import { PRACTICES } from "@/lib/practices";
import { orgTabHref } from "@/lib/org/orgTabs";

export function CreateInitiativeButton({
  slug,
  title,
  dimId,
  practiceId,
  targetScore,
  repos,
  assigneeLogin,
  label = "Track as initiative →",
}: {
  slug: string;
  title: string;
  dimId: string;
  practiceId?: string | null;
  targetScore?: number;
  repos: string[];
  assigneeLogin?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          title,
          dimId,
          // GOAL-3: carry the starter shape so the initiative lands with its practice attached.
          practiceId: practiceId ?? PRACTICES.find((p) => p.dimId === dimId)?.id ?? null,
          ...(targetScore != null ? { targetScore } : {}),
          ...(assigneeLogin ? { assigneeLogin } : {}),
          repos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create initiative.");
      setState("done");
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Failed to create initiative.");
    }
  }

  if (state === "done") {
    return (
      <span className="font-mono text-xs text-emerald-300">
        Tracked ·{" "}
        <Link href={orgTabHref(slug, "plan")} className="focus-ring text-accent transition hover:text-white">
          view in Plan →
        </Link>
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        onClick={create}
        disabled={state === "busy"}
        className="focus-ring font-mono text-xs text-accent transition hover:text-white disabled:opacity-50"
      >
        {state === "busy" ? "Tracking…" : label}
      </button>
      {error && <span className="text-xs text-orange-300">{error}</span>}
    </span>
  );
}
