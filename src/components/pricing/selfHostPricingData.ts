// The two facts a self-hosted /pricing has to state, as data (rendered by SelfHostPricingBlueprint).
//
// (a) What the cloud plans buy that this install already has — derived from the SAME plan model the
//     entitlement gate reads (PLAN_CAPABILITIES / PLAN_FEATURES, src/lib/plans.ts), so a capability
//     that moves tiers moves here without anyone re-typing prose. The metering + operations rows are
//     the parts of the model that aren't capabilities and are stated once, beside them.
// (b) How the `/onboarding` skill sets an install up — the high-level shape of the skill's own steps
//     (.claude/skills/onboarding/SKILL.md, overlay in .claude/onboarding/config.md). Kept at the
//     altitude of "what happens", not the commands inside each step, so a re-ordered probe doesn't
//     make this page lie.
//
// Pure data: no React, no env reads — the Blueprint, the onboarding setup panel and a test import it.

import { PLAN_CAPABILITIES, PLAN_CAPABILITY_ORDER, PLAN_FEATURES, type PlanId } from "@/lib/plans";

export interface DiffRow {
  /** The thing being compared. */
  label: string;
  /** What the hosted cloud gives, phrased as the tier it arrives on or the limit it carries. */
  cloud: string;
  /** What this self-hosted install has. */
  local: string;
  /** True when the row is a capability gate the tiers unlock (renders with the tier tag). */
  gated: boolean;
}

/** "Team and up" for a tier the ladder continues past; "Custom" when it is the last rung. */
function fromTier(id: PlanId): string {
  return PLAN_FEATURES[id].billing === "custom" ? PLAN_FEATURES[id].label : `${PLAN_FEATURES[id].label} and up`;
}

const FREE = PLAN_FEATURES.free;

/** The paid-vs-local comparison, capabilities first (model-derived), then metering, then operation. */
export const CAPABILITY_DIFF: DiffRow[] = [
  ...PLAN_CAPABILITY_ORDER.map((c) => ({
    label: PLAN_CAPABILITIES[c].label,
    cloud: fromTier(PLAN_CAPABILITIES[c].minPlan),
    local: "On",
    gated: true,
  })),
  {
    label: "Private scans",
    cloud: `${FREE.includedCredits} free a month, then prepaid credits`,
    local: "Unmetered — no allowance, no credits, no 402",
    gated: false,
  },
  {
    label: "Seats",
    cloud: `${FREE.seats} on Free, more per tier`,
    local: "Unlimited",
    gated: false,
  },
  {
    label: "Scan history",
    cloud: `${FREE.retentionDays} days on Free, longer per tier`,
    local: "Your disk, your policy — no floor",
    gated: false,
  },
  {
    label: "Model",
    cloud: "Ours, or your own account on Team",
    local: "Any provider — Ollama, vLLM, the Claude CLI you already pay for",
    gated: false,
  },
  {
    label: "Operation",
    cloud: "Managed database, registered GitHub App, cron, alerts, someone on call",
    local: "Yours — which is the whole trade",
    gated: false,
  },
];

export interface OnboardingStep {
  /** Two-digit ordinal, typeset in mono. */
  n: string;
  title: string;
  body: string;
  /** The one command or probe a reader would recognise from the step, when there is one. */
  probe?: string;
}

/** The `/onboarding` skill, at the altitude a first-time operator needs to see the shape of it. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    n: "00",
    title: "Run it from the clone",
    body: "Open the repository in Claude Code and type the skill. It reads the project overlay so every question is about this app, not a generic setup.",
    probe: "/onboarding",
  },
  {
    n: "01",
    title: "Choose the mode",
    body: "Developer laptop, self-host for a team, or just evaluating. The answer decides which variables are required and which are merely recommended.",
  },
  {
    n: "02",
    title: "Probe the runtime",
    body: "Node, git, the Claude CLI, and Docker or a local model server only if a later choice needs them. Green is recorded, red is fixed or named.",
    probe: "npm run doctor",
  },
  {
    n: "03",
    title: "Pick capabilities as trades",
    body: "LLM engine, database, GitHub token, GitHub App, sign-in, cron, local mode, autopilot. Each option says what you get and what stays limited; “later” is always allowed.",
  },
  {
    n: "04",
    title: "Write .env.local",
    body: "Merged, never overwritten. Keys are written once and never echoed back — not partially, not to confirm.",
  },
  {
    n: "05",
    title: "Boot and verify",
    body: "Start the dev server, read the real port, probe the root and each configured group. A stale process running old env is the classic false green, so it says when to restart.",
    probe: "npm run dev",
  },
  {
    n: "06",
    title: "Read the capability matrix",
    body: "One row per feature in one of three honest states: works, degraded with a stated fallback, or hidden by design — with the exact variable and the re-entry command that finishes it.",
    probe: "/onboarding <group>",
  },
];

/** One-line answer to "why is there no price on this page" — the Blueprint masthead. */
export const SELF_HOST_LEDE =
  "This install runs the same code as the hosted cloud with every plan gate open. The tiers on the public pricing page buy operation, not capability, so there is nothing here to buy.";
