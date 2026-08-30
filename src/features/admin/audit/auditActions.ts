// THE AUDIT ACTION REGISTRY — one ordered list of the actions this app actually records, driving
// BOTH the badge metadata and the filter dropdown, so the two cannot drift apart.
//
// Extracted from `AuditLogCells.tsx` when the moonshot-#3 work-protocol actions pushed that file past
// the 200-LOC cap `src/features/**` carries (AGENTS.md). Pure relocation: the list, its derived
// `ACTION_META` map and `ACTION_FILTERS` moved verbatim, and `AuditLogCells` re-exports
// `ACTION_FILTERS` so no call site changed. Data only — no JSX, no hooks — so no `"use client"`.

// One ordered list of the audit actions the app actually records, driving BOTH the badge metadata
// and the filter dropdown — so they can't drift apart (the prior bug keyed on
// `recommendation.status_changed`, which is never written; the real action is `recommendation.updated`,
// and scan.regression / org.alerts.* / *.pr_opened / member.* / plan / retention were unrecognized).
const ACTIONS: { value: string; label: string; cls: string }[] = [
  { value: "scan.created", label: "Scan", cls: "border-accent/40 bg-accent/10 text-accent" },
  { value: "recommendation.updated", label: "Rec update", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "scan.regression", label: "Regression", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  { value: "org.alerts.webhook", label: "Alert sink", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.alerts.thresholds", label: "Alert rules", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "practice.pr_opened", label: "Practice PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "playbook.pr_opened", label: "Playbook PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  // MOONSHOT #33 — the two customer-repo writes the adoption ledger added.
  { value: "practice.rollout_opened", label: "Practice rollout", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "practice.registry_applied", label: "Registry practice PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  // MOONSHOT #26 — the local loop's one action that leaves the machine. The REFUSAL is labelled too,
  // and deliberately in the red family: by the time most refusals fire the branch is already on the
  // remote, so "we pushed and then could not open the PR" is a state an operator has to be able to
  // find here rather than discover on GitHub.
  { value: "loop.pr.opened", label: "Loop PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "loop.pr.refused", label: "Loop PR refused", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  // MOONSHOT #3 — the agent-neutral work protocol. All three are MACHINE writes on the org's own
  // ledger, so they get the violet treatment the other recommendation-layer writes carry rather than
  // a colour of their own: an agent claiming a row is the same KIND of event as a person handing one
  // off, and the actor column (`agent:<token name>`) is where the difference actually shows.
  { value: "followup.claim", label: "Follow-up claimed", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "followup.attempt", label: "Follow-up attempt", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "loop.remote_run_started", label: "Remote run armed", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  // G6-06: `org.gate_policy`/`playbook.updated` are genuinely recorded (see the route files below) but
  // were missing from this hand-maintained list, so they rendered as an unlabeled grey badge AND could
  // not be selected in the Action filter. See AuditLogCells.actions.test.ts, which walks every
  // recordAudit/recordOrgAudit call site in src/ and fails if a recorded action has no entry here — so
  // the next new action can't silently fall off the same way.
  { value: "org.gate_policy", label: "Gate policy", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  // W3 — the AI-stance module: draft/publish writes, per-repo acknowledgements, and the
  // AI_POLICY.md draft PR (recorded via openArtifactDraftPr with this action).
  { value: "org.ai_stance", label: "AI stance", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.ai_stance_ack", label: "Stance ack", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  // moonshot #8 — the four admission actions. The DECISION and the two customer-repo WRITES are
  // deliberately different colours: an examiner scanning this log should be able to see at a glance
  // which rows changed a record and which changed someone's repository.
  { value: "org.admission", label: "Admission decision", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.admission_propose", label: "Admission proposal", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "org.admission_ruleset", label: "Ruleset applied", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
  { value: "org.admission_ruleset_revert", label: "Ruleset reverted", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  // moonshot #4 — connecting or disconnecting a forge account. The row records the forge, the
  // external id and the host; it never records the credential or its ciphertext, which is why these
  // two are safe to render in a viewer any org admin can read.
  { value: "forge.installation.set", label: "Forge connected", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "forge.installation.cleared", label: "Forge disconnected", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  { value: "ai_stance.pr_opened", label: "AI policy PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "playbook.updated", label: "Playbook updated", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "playbook.deleted", label: "Playbook deleted", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "org.member.role", label: "Member role", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.member.removed", label: "Member removed", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "org.member.invited", label: "Member invited", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.member.invite_accepted", label: "Invite accepted", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.plan", label: "Plan change", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  // A briefing share link is a per-grant capability: minting one is the act that lets a document
  // leave the org, and opening one is the only record a stateless token could never give. Both are
  // read affordances rather than mutations, hence the neutral sky/slate treatment rather than red.
  { value: "briefing.share.minted", label: "Briefing shared", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "briefing.share.opened", label: "Briefing opened", cls: "border-slate-500/40 bg-slate-500/10 text-slate-300" },
  // Revoking is the one act in this trio that TAKES a capability away, so it reads like the other
  // revocations in this list (amber) rather than like its own siblings.
  { value: "briefing.share.revoked", label: "Briefing link revoked", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "org.llm_provider.updated", label: "LLM provider updated", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.llm_provider.disabled", label: "LLM provider disabled", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "integrations.token.rotate", label: "Ingest token rotated", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "integrations.copilot.sync", label: "Copilot synced", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org_api_token.created", label: "API token created", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org_api_token.revoked", label: "API token revoked", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "org_skill.created", label: "Skill created", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "org_skill.updated", label: "Skill updated", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org_skill.archived", label: "Skill archived", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  { value: "org_memory.created", label: "Memory created", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "org_memory.updated", label: "Memory updated", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org_memory.archived", label: "Memory archived", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  { value: "org_memory.reflected", label: "Memory reflected", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org_memory.decayed", label: "Memory decayed", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  // Publication-shaped: this one opens a pull request in the customer's own registry repo, so it
  // reads as an outbound act rather than as another edit to the memory table (#36).
  { value: "org_memory.pr_proposed", label: "Memory PR proposed", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org_decision.recorded", label: "Decision recorded", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  // Athena's action door. The ACCEPT is emerald because something was actually performed on the org's
  // behalf — it is the one place a companion's suggestion turns into a write, and the trail is the
  // reason that is safe to offer at all. The decline is slate: a considered "no" changed nothing.
  { value: "athena_proposal.accepted", label: "Athena action accepted", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "athena_proposal.declined", label: "Athena action declined", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  { value: "passport.pr_opened", label: "Passport PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "passport.overrides_set", label: "Passport overrides", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "passport.declines_set", label: "Passport declines", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "foundation.pr_opened", label: "Foundation PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  // moonshot #35 — the fleet rollout trio. The BATCH row is sky, not emerald: it is the record of the
  // act ("N repos attempted"), while the per-repo emerald rows beside it are the writes themselves.
  { value: "foundation.batch_opened", label: "Foundation rollout", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  // Provisioning WRITES A CREDENTIAL into a customer repo, so it reads as an event to notice (amber),
  // not as routine reporting — it is the largest blast radius in the foundation flow. Its revoke is
  // slate: taking the capability away is the safe direction, and painting it red would teach reviewers
  // to skim the colour that matters.
  { value: "foundation.reportback_provisioned", label: "Report-back provisioned", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "foundation.reportback_revoked", label: "Report-back revoked", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
  { value: "issue.create", label: "Issue created", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "billing.autorecharge", label: "Auto-recharge", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "conformance.reported", label: "Conformance report", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "outcomes.backfill", label: "Outcome backfill", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  // W2 — an evidence pack leaving the building. Amber, not sky: this is a governance-relevant EGRESS
  // (it can name individuals against unreviewed changes), so it should read as an event to notice in
  // the trail rather than as routine reporting.
  { value: "conformance.pack.export", label: "Evidence pack exported", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  // MOONSHOT #1 — someone checked the control ledger's seals. Sky, not amber: this is a READ, and it
  // is the read a reader should be encouraged to make. Its meta carries the days judged, `chainOk`,
  // and any day that failed, so the trail records the verdict and not merely the attempt.
  { value: "controls.verify", label: "Ledger integrity verified", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "data.erased", label: "Data erased", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "retention.purged", label: "Retention purge", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
];

export const ACTION_META: Record<string, { label: string; cls: string }> = Object.fromEntries(
  ACTIONS.map((a) => [a.value, { label: a.label, cls: a.cls }]),
);

export const ACTION_FILTERS = [
  { value: "", label: "All actions" },
  ...ACTIONS.map((a) => ({ value: a.value, label: a.label })),
];

