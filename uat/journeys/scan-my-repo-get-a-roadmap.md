---
character: Sam (Staff Engineer)
goal: "Scan a repo I know cold, tell me if the read matches mine, and hand me a roadmap I'd actually put in the next sprint."
promotion: discovery
seed: just a public GitHub repo URL Sam knows well (e.g. a repo they maintain, or a well-known one like vercel/next.js or facebook/react). No auth/DB needed for the public single-repo scan — every db helper is a safe no-op with DATABASE_URL unset, and LLM_PROVIDER=auto falls back to deterministic mock so a full report renders with zero keys. See uat/env.md.
references:
  - https://lethain.com/staff-engineer-archetypes/ — the Tech Lead "guides the approach and execution of a particular team"; Sam's own read of the repo is the ground truth — the scan has to reconcile with it, not lecture it.
  - https://shiftmag.dev/state-of-code-2025-7978/ — 96% of developers don't fully trust AI output and reviewing it "demands more effort"; so a score Sam can't re-trace to file:line evidence is dead on arrival.
  - https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/ — what closes the trust gap is "attribution and traceability built into systems"; the roadmap and badge only earn Sam's name if the provenance survives a skeptic's re-check.
---

## Trigger (why now)
Sam's VP keeps asking "are we AI-native yet, and what's the one thing to fix first?" Sam could block out the better part of a day to audit a repo and hand-write an improvement plan — they've done it before and resent the tedium. Instead they paste a repo they know cold into Ascent to see, in a couple of minutes, whether a tool can produce a read that matches theirs and a roadmap sharper than what they'd write by hand. Half the point is to catch the tool bullshitting.

## Definition of done (their POV)
- A scan completes on a pasted public repo URL with no signup, no keys, and visible progress (not a dead spinner).
- The overall maturity level, the 9 dimension scores, and the posture quadrant **reconcile with each other and with what Sam knows about the repo** — nothing reads strong where Sam knows the substance is thin (fake coverage, flaky CI, ceremonial config files).
- Sam can **re-trace every score to concrete evidence** — file:line / PR / commit / governance fact — via the signal→LLM→blended provenance track, and can see where the LLM and the deterministic detector disagreed.
- The roadmap names a **specific, evidence-grounded, highest-leverage next move** Sam would actually put in the next sprint — not "add more tests."
- Sam ends with a **badge / level they'd stake their name on** in a public README, and reaches this verdict in ~2–3 minutes (vs the better part of a manual audit day).

## Out of scope
- Org/fleet dashboards, trends history, /report/compare across two scans, and any authed `/org/*` surface — this journey is the free public single-repo scan only. (Compare/trends are their own journeys.)
- Generating and running the onboarding SKILL.md inside the target repo's own Claude CLI — Sam may *notice and judge* the offered `.ai/` standard + SKILL.md as artifacts, but executing them is not this journey.
- Buying credits, billing, Polar flows.
- Live-LLM nuance quality — mock mode is an acceptable substitute for the structural read; only flag obviously-degraded mock output, not "the prose could be richer."

## Discovery hints
Entry point(s): / (scan form) → /report/[owner]/[repo]. Do NOT script the steps — Sam finds their own path from the landing page; if they can't tell where to paste a repo, can't tell the scan is progressing, can't find the evidence behind a score, or can't locate the roadmap/badge, getting lost is itself a finding. Watch especially for: does Sam go looking for the provenance/evidence before trusting any number, and is it there when they look?

## Frozen happy path  (filled in only on `promote`)
_(not yet promoted — discovery)_
