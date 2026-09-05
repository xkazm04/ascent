# UAT full sweep — 2026-07-16

Diff-aware `update` (against 623 commits since the last real run, 2026-06-20) → full L1 (mass-parallel theoretical) → L2 (serial live, `LLM_PROVIDER=claude-cli`) → reconciliation → synthesis, across all 30 Characters.

## Scorecard

30 Character×journey passes this run; all 30 reached **L1**, 27 reached **L2** live. Zero `blocker`-severity findings — no journey is structurally dead.

- **L1:** Pass=1, Conditional=28, Fail=1 (Mei/OSS-maintainer — `badge-my-oss-repo` — blocked by a public sign-in wall that contradicts the journey's hard no-signup bar; not carried to L2).
- **L2-eligible:** 9/10 dedicated journeys, 20/20 pricing-20 roster characters (29 live passes total).
- On the dominant 20-Character `repeated-org-scans-worth-the-price` journey: 18 renew/conditional-renew, 1 explicit **non-renewal** (robert-enterprise-dotnet: "still would not certify at renewal"), 1 **downgrade-toward-churn** (yusuf-bootstrapped-rails).
- elena, marcus, sam, priya, oliver, raj, nadia, dana each ran their own dedicated journey and reached L2 with real findings.

## Top blocker/major by impact

1. **Executive Briefing trajectory renders a confident, dated ETA with zero low-data confidence caveat**, on the board/PDF/"Copy for LLM" export surface — while the identical low-data case is honestly caveated on `/trends`. Independently found by **14 of 20** Characters (`src/lib/org/briefing.ts:242-248`). The single most reachable, highest-frequency, highest-trust-erosion finding of the run.
2. **`/usage`'s low-balance banner false-fires** ("next scan will be refused") off `creditBalance === 0` alone, ignoring monthly allowance — contradicts the adjacent "comfortably within your allotment" text on the same page. Hit by 6 Characters, not even Free-tier-scoped.
3. **Data-integrity bug (Oliver, drive-testing-maturity):** a public-funnel scan's report, trend line, and recommendation tracker all independently forget the scan exists on reload. "The artifact I need — gone, on reload."
4. **Governance dashboard vs. `/api/gate` endpoint can disagree** on level/score/failing-dimensions for the same repo, live (raj).
5. **Reconciliation sweep:** `vercel/next.js` D4 score disagrees 92 (stale cached discovery register) vs 15 (fresh scan + governance page), triangulated across 3 independent surfaces/Characters. Full detail in [`_reconciliation.md`](./_reconciliation.md).

## Sharpest voices

- **Arjun** (ML platform lead), watching the same bug pattern twice: *"That's not reassuring, that's a pattern."* (`arjun-ml-platform--repeated-org-scans-worth-the-price.L2.md:45`)
- **Oliver** (QA lead), on the vanishing-scan bug: *"I came back to the same report five minutes later... the tool told me the repo had never been scanned... That's the artifact I need to walk into my VP's office with — gone, on reload."* (`oliver-qa-lead--drive-testing-maturity.L2.md:94`)
- **Yusuf** (bootstrapped Rails), the sharpest dissent: *"Verdict: downgrade, trending toward churn... I'm one more discovered inconsistency from cancelling entirely."* (`yusuf-bootstrapped-rails--repeated-org-scans-worth-the-price.L2.md:27`)
- **Priya** (platform lead), on discoverability tax: *"Seven stops for something you already know the name of."* (`priya-platform-lead--set-and-enforce-the-standard.L2.md:294-297`, screenshots in `shots-priya-l2/`)
- **Robert** (enterprise .NET), the only clean non-renewal: *"'I believe the content is good' and 'I can certify this line item to procurement' are different bars, and today I clear the first, not the second."* (`robert-enterprise-dotnet--repeated-org-scans-worth-the-price.md:19`)

## Panel verdict

The AI machinery itself — scoring, roadmaps, stack-fit reasoning, price math, noise suppression — is real and holds up every time it's driven live. Trust erodes at one consistent point: a correct caveat computed somewhere in the app silently fails to propagate to the highest-stakes surface (board briefing, usage banner, governance dashboard) a user would forward unedited. Fix that propagation and the product clears essentially every Character's bar; as-is, it delivers roughly 50–70% of its promised time-saved, with the rest spent double-checking exactly the surfaces meant to remove that work.

## Update-mode findings (pre-run overlay refresh)

Reviewed all 623 commits since the last real UAT run (b16be97, 2026-06-20) across a 1224-file diff. Updated 6 of 11 journey files whose bound surfaces materially changed — the org Overview's Movers/Trajectory/Goals cards were replaced by a repos×time heatmap + per-repo trajectories (Dana, repeat-scans), audit-trail viewer attribution and CSV-export integrity were fixed (Nadia, Raj), the pricing model moved to real numeric Pro/Team subscriptions plus a 5-scan/mo free allowance (Tomás, repeat-scans), a new org API-token skill-sync surface landed with no JTBD-level owner (Priya), and delivery/governance got a11y + reliability fixes (Raj). Lightly refreshed 2 character files (Priya for skill-sync, Victor for the now-real subscription pricing). No journey's surface was removed, so nothing was retired.

**Open gap:** the new personal-workspace feature (`Organization.kind` personal/org split, `/me`, track-this-repo exit, CI gate snippet, passport cards) is a genuinely new user-facing capability with no dedicated journey — flagged for sizing (own Character vs. folding into an existing one), not authored unprompted.

---
*Note: this file was reconstructed by the orchestrator after a workflow bug — the `runId` argument reached the script as `undefined`, so all per-run files were originally written to `uat/runs/undefined/` and later renamed into this directory. Stray `uat/runs/undefined/...` path citations inside the per-Character reports were bulk-corrected to this directory afterward. The synthesis subagent's own attempt to write this file was blocked by its tooling policy; content above is verbatim from that subagent's returned text.*
