---
type: comparison-study
source: microsoft/ai-engineering-coach@18b1a3d
date: 2026-09-15
status: proposed
registry_run: intake-aecoach
---

# Ascent vs AI Engineering Coach: a peer comparison

**AI Engineering Coach** is a VS Code extension, shipped by Microsoft. It parses the local agent-session logs of six harnesses: VS Code chat, Copilot CLI, Xcode, Claude Code, Codex and OpenCode. It normalizes them into one session schema and runs 45 markdown rules over them. It then shows the developer a dashboard, a chat participant and a set of editor LM tools.

**Ascent** is the maturity index for AI-native engineering. It scores repositories on 9 dimensions (L1-L5), indexes an org's registry, and ingests vendor telemetry server-side.

**The difference is the unit.** Ascent measures the repository and the org. The coach measures one person's sessions.

**Why they are peers: UC3.** Ascent's UC3 ("individual care") plans a local `/mentor` sensor. That sensor reads a developer's own sessions and shares opt-in counts to `/org/developer` (docs/GOLDEN-USE-CASES.md:239, docs/REGISTRY-AND-CARE-IMPL.md:20-26). The sensor is not built yet, and the coach is a shipped example of one. So the question for each point: which of the coach's parts survive ascent's rules (counts, not content; the person as the only reader; a score that means the same thing across tenants), and which parts break them?

All coach paths are relative to `C:\t\intake-aecoach` at 18b1a3d. All ascent paths are relative to the ascent root, as of the working tree on 2026-09-15. That tree includes another session's uncommitted temporality change.

## Corrections to the seeded points

- **Ingestion.** Ascent ingests more than one vendor's OTLP. It also pulls Copilot seats and engagement (`src/lib/integrations/copilot.ts:1-10`). Neither source has a session shape. See point 1.
- **Inline tests.** The coach's 45 rules do not carry working inline tests. Only 4 of the 45 have a `# Tests` block, and no test runner executes those blocks. See point 42.
- **Agentic readiness.** Readiness is not computed from sessions. It is eight weighted checks for files on disk. Only context management (utilization, compactions) comes from sessions. See point 32.
- **Redaction.** Secret redaction is not applied before sharing. It runs when transcript text goes to a language model. The share card carries only totals. See point 38.
- **"MCP surface".** It is not an MCP server. It is a set of VS Code Language Model tools, registered through `vscode.lm.registerTool`. See point 40.
- **Seeds that held:** field honesty (with a cross-harness caveat, point 8), the keyword proxy (and ascent has the same property, point 15), late-night and weekend penalties, issue-credit precedence, the unkeyed lines rollup, and the trust gate. The trust-gate question has an answer: yes, ascent evaluates content authored by the scanned party, and it bounds the payoff of that content rather than hashing it (point 20).

---

## 1. Session ingestion and harness coverage

**1. Where the raw signal is read**
- coach: `src/core/parser-harnesses.ts:37-74`. Claude Code, Codex and OpenCode are collected here; VS Code, Copilot CLI and Xcode come from `parser-vscode*.ts` and `parser-xcode.ts`.
- ascent: `src/lib/integrations/sessions.ts:81-105` (Claude Code OTLP push, server-side); `src/lib/integrations/copilot.ts:1-10` (Copilot metrics pull, no cost and no sessions).
- verdict: **different forces**
- The coach runs on the developer's disk, so it can read history. Ascent's SaaS must never see transcripts ("Why not a scan", docs/GOLDEN-USE-CASES.md:268). The seed said ascent ingests one vendor; it ingests two, and neither carries the shape UC3 needs. A log parser belongs in the local mentor, not in the index.

**2. History parse vs an install-forward hook**
- coach: `src/core/parser-claude.ts:155-160` (reads existing JSONL files after the fact).
- ascent: `scripts/ascent-skills.mjs:237-262` (a PreToolUse `Skill` hook that appends events from install onward).
- verdict: **adapt**
- The hook has zero history on day one, but mentor `intake` promises "the last 30 d of local transcripts" (GOLDEN-USE-CASES.md:239). Intake needs a one-shot transcript reader. The hook stays the durable live producer, and the two must share one dedupe key (session id).

**3. Skill invokes read from history**
- coach: `src/core/parser-claude.ts:243-246` (`Skill` tool_use blocks become `skillsUsed`).
- ascent: `scripts/ascent-skills.mjs:250-259` (hook); `src/lib/mcp/tools.ts:412` (`report_skill_invoke`).
- verdict: **adopt**
- It is the same `Skill` tool call the hook sees live. Reading it from JSONL backfills `skillInvokes30d` for developers who install the mentor after months of use.

**4. Plan-mode signal for Claude Code**
- coach: `src/core/parser-claude.ts:680` (`agentMode: 'agent'` is hardcoded, and this parser never sets `slashCommand`); `src/core/rules/no-plan-mode.md:7` (`requiresIdeContext`).
- ascent: `src/lib/org/developer-view.ts:61` (`planModePct`, no producer yet).
- verdict: **keep ours**
- The coach does not read a plan-mode signal from Claude Code logs, so it cannot supply the number UC3 puts first. Ascent's field is right. The mentor must read plan mode itself: the coach parser offers no prior art to copy.

**5. Retries and tests-before-commit**
- coach: none. Nearest: `src/core/rules/runaway-agent-loops.md:29` (15 or more tools in one request) and `src/core/rules/repeated-prompts.md:31` (duplicate prompts).
- ascent: `src/lib/org/developer-view.ts:62-63`; GOLDEN-USE-CASES.md:239 ("same error 3x or more", "tests run before commit").
- verdict: **keep ours**
- A tool count measures volume, not a retry. No coach rule looks for a test run before a commit. Ascent's definitions name the failure mode and the verification act.

**6. Programmatic sessions are not the person's habit**
- coach: `src/core/types/session-types.ts:156-168` and `src/core/parser-claude.ts:73-82` (an `entrypoint` allow-list sorts sessions into interactive and programmatic).
- ascent: none. Nearest: `src/lib/integrations/sessions.ts:93` (only `userKey` is kept).
- verdict: **adopt**
- Some sessions are spawned by the SDK, a GitHub Action, or ascent's own loop lanes, and they would count as the developer's turns and plan-mode ratio. The mentor's shape counts should apply the same allow-list before they fold anything.

## 2. Normalized session schema and field honesty

**7. Accumulation scope written on the type**
- coach: `src/core/types/session-types.ts:70-79` (`promptTokens` = last agentic round; `completionTokens` = cumulative; cache fields are subsets).
- ascent: `src/lib/org/developer-view.ts:57-65` (`CareSessionShape`: no window, denominator or definition of a "turn" per field).
- verdict: **adopt**
- The share payload becomes a contract as soon as a second producer exists: an org fork of `skills/mentor/`, or a later Codex reader. Each field needs its window, denominator and unit written on the type, next to the value.

**8. One field, two scopes across harnesses**
- coach: `session-types.ts:70-72` says last round only, but `src/core/parser-claude.ts:343` and `:688` sum input plus cache across every assistant round into the same `promptTokens`.
- ascent: `src/lib/integrations/sessions.ts:105` and `:124-126` (one source per row; tokens summed within a session).
- verdict: **keep ours**
- The coach documents its field honesty for one harness while another harness fills the same field with a different scope. Ascent's rule of one source per row avoids that. The lesson for point 7: enforce each field's scope with a fixture per producer, not with prose.

**9. Why a value is empty**
- coach: `session-types.ts:95-109` (`endState` pending / errored / no-data); `src/core/analyzer-consumption.ts:73-86` and `:170-183` (these are excluded from the missing% denominator but still counted separately).
- ascent: `src/lib/org/developer-view.ts:76-89` (`CareActivityState`, for git activity only); `:313-315` (every null shape field renders as a dash).
- verdict: **adapt**
- Ascent already types "withheld vs absent" for git-side activity. The shape fields, however, collapse three cases into one null: not shared, not measurable from this harness, and zero. Carry a per-field reason, like the coach's no-data vs pending.

**10. A provenance tag on each number**
- coach: `src/core/analyzer-consumption.ts:43` (`kind: 'exact' | 'session-aggregated'`, used inside billing only).
- ascent: `src/lib/integrations/providers.ts:6-23` (`Fidelity`); docs/VALUE-CASE.md:46 (D32).
- verdict: **keep ours**
- Ascent's fidelity tier is typed all the way into the money columns and shown to the reader. The coach's tag never leaves the billing module.

**11. Counter temporality**
- coach: `src/core/analyzer-consumption.ts:47-55` (for session-aggregated harnesses, shutdown totals replace per-request placeholders).
- ascent: `src/lib/db/agent-sessions.ts:37-46`, `src/lib/integrations/sessions.ts:99`, `src/lib/integrations/otlp.ts:122-135`.
- verdict: **different forces**
- The coach reads finished files, where a total is final. Ascent ingests a live stream, where temporality decides whether a counter is set or added. The tree I read already carries the in-progress fix for the delta default (`agent-sessions.ts:42-44`, `agent-sessions.temporality.test.ts`). It is recorded here as context, not proposed as a feature.

**12. A named window that is not enforced**
- coach: `src/core/types/session-types.ts:70-75` (the scope is stated per field).
- ascent: `src/lib/registry/usage-samples.ts:136` and `:151` (`invokes30d += whole` for any file, even when that file declares `windowDays` other than 30).
- verdict: **adapt**
- A contributor file with a 90-day window is summed into a number named "30d". Apply the coach's discipline: normalize by the declared window, or rename the field.

## 3. Detection rules and extensibility

**13. Index detectors as code, not user data**
- coach: `docs/AUTHORING_RULES.md:13-17` (built-in, personal and project rule layers); `src/core/rule-pipeline.ts:6-17`.
- ascent: `src/lib/analyze/index.ts:310-312` (TypeScript detectors); `src/lib/maturity/model.ts:202` (`SCORING_RUBRIC_VERSION`).
- verdict: **keep ours**
- Ascent's score gates merges and is sold (`src/lib/llm/untrusted.ts:50-53`), so each detector change is a versioned rubric event, calibrated against a corpus. User-authored detectors would fork the index per org. The org-extensible layer ascent does want is registry content, and that already travels by PR.

**14. Mentor moves as markdown data**
- coach: `src/core/rules/lazy-prompting.md` (frontmatter thresholds, "How to Improve" section, detect block); `docs/AUTHORING_RULES.md:13-17`.
- ascent: GOLDEN-USE-CASES.md:245-247 (the move catalogue grows by org PRs to `skills/mentor/`).
- verdict: **adapt**
- For the mentor (not the index), the coach's shape fits: a move is a trigger over session counts, a threshold and a piece of advice. Keeping moves as markdown in the registry is the planned extension path. Borrow the frontmatter layout, not the DSL interpreter.

**15. Keyword proxies that saturate**
- coach: `src/core/rules/no-spec-driven-development.md:15` and `:41-48` (a first prompt containing "should", "must" or "ensure" counts as spec-driven).
- ascent: `src/lib/analyze/guidance-quality.ts:24` (any "never", "always", "avoid", "do not" or "important:" earns 6 points); `:22` (test-discipline phrases earn 8); fed into D1 at `src/lib/analyze/index.ts:312`.
- verdict: **adapt**
- The seed holds, and ascent has the same property with a worse consequence. The coach's proxy only moves a finding the user sees; ascent's moves a published D1 score. Measure each signal's fire rate on the bench corpus (test T3), and tighten or drop the signals that fire on nearly every guidance file.

**16. Work type from first-match regex**
- coach: `src/core/helpers.ts:328-335` (the first matching pattern wins, so "fix the refactor test" is a bug fix).
- ascent: none. Nearest: `src/lib/scoring/claims.ts:12-16` (cited, verified facets).
- verdict: **keep ours**
- If the mentor ever labels a developer's task mix, pattern order should not decide the label. Ascent's cite-and-verify pattern is the better base.

**17. Silent failure in rule evaluation**
- coach: `src/core/rule-pipeline.ts:274-276` (a check expression that fails to compile fires whenever anything matched); `src/core/dsl/index.ts:33-34` (reduce-expression errors become null); `src/core/rules/no-plan-mode.md:35-37` (visibly malformed string, and no fixture covers it).
- ascent: `src/lib/local/lane-report.ts:13-15` and `:37-41` (never throws, but reports a typed `parsed: false`); `src/lib/analyze/context-health.ts:168-173` (degraded input narrows the result).
- verdict: **keep ours**
- Ascent turns a failure into a named state. The coach turns it into either a silent fire or a silent null, and a broken rule shipped in the built-in set.

**18. Repeated prompts become skill suggestions**
- coach: `src/core/analyzer-workflows.ts:21` and `:222` (a fixed 2 minutes saved per repetition).
- ascent: `src/lib/org/developer-view.ts:45-46` (`expectedSaving` scored for this developer); `:51-52` (`registryPromotable`).
- verdict: **adapt**
- Clustering repeated prompts is exactly the evidence the "seed CLAUDE.md / install skill X" moves need (GOLDEN-USE-CASES.md:242). A constant of 2 minutes is an invented saving, though, and D32 forbids exactly that kind of number. Take the clustering; drop the constant.

## 4. Trust boundary for supplied rules and content

**19. Trust-on-first-use content hash**
- coach: `src/core/rule-trust.ts:6-26` and `:70-76` (any edit revokes approval); `:140-144` (a loader with no gate allows everything).
- ascent: none executable. Nearest: `src/lib/registry/policy.ts:1-8` (a small YAML subset; unknown fields are ignored).
- verdict: **different forces**
- The coach executes DSL that a workspace supplies, the moment the dashboard opens, so a hash gate is the right control there. Ascent never executes content from the scanned party; it parses a closed shape. The coach's allow-all fallback is also a reminder to make the gate mandatory by construction.

**20. Content from the scanned party that moves ascent's verdict**
- coach: n/a (the user is the only party).
- ascent:
  - `src/lib/llm/untrusted.ts:50-64` (repo text has no authority) and `:117` (`REPO_OUTPUT_PAYOFF`)
  - `src/lib/scoring/discrepancy-policy.ts:1-27` (a budget of at most 2 widened dimensions)
  - `src/lib/local/lane-report.ts:64-71` (dispatched ids are the authorization boundary) and `:140-141` (a skip stops re-dispatch but never closes a row)
  - `src/lib/analyze/passport-overlay.ts:7-15` (declines never move a score)
- verdict: **keep ours**
- The seeded question has an answer: yes, ascent reads content authored by the scanned party (file bodies, lane reports, `registry.yaml`, owner declines). Each channel has a bounded payoff instead of an approval hash. For a multi-tenant scorer, that is the stronger model.

**21. Self-reported counts without a ceiling**
- coach: n/a (a single user cannot inflate their own evidence against anyone).
- ascent: `src/lib/registry/usage-samples.ts:144-151` (contributor invoke counts summed with no cap) vs `src/lib/mcp/write-gate.ts:22-24` and `:95` (a per-token daily ceiling on self-reported evidence).
- verdict: **adapt**
- The MCP door caps self-reported evidence; the registry usage lane does not. The planned mentor `share` will be a third door. The coach's idea that "evidence outside what was approved is held" maps to one ceiling policy across all three doors.

## 5. Scoring and weighting

**22. Late-night and weekend requests as hygiene penalties**
- coach: `src/core/detectors/scoring.ts:16-26`; `src/core/rules/late-night-coding.md:29`; `src/core/rules/weekend-overwork.md:29`; `src/core/dsl/interpreter.ts:991-994` (machine-local `getHours`).
- ascent: none (no time-of-day signal anywhere under `src/`); `src/lib/org/developer-view.ts:9-12`.
- verdict: **keep ours**
- A score that falls when you work late becomes a report of when you work as soon as anyone else reads it. The local clock also misfiles Remote-SSH hosts and travel. Ascent's UC3 has no hour field that could leak.

**23. A streak rewarded and warned about at once**
- coach: `src/webview/page-achievements.ts:143-145` (a badge for a 30-day streak); `src/webview/page-peers.ts:31-34` (the streak goes into the social share text); vs `src/core/analyzer-insights.ts:575-577` and `src/core/constants.ts:87` (a 14-day streak raises a burnout alert).
- ascent: `src/lib/org/developer-view.ts:306-310` (saving from kept moves; no streak exists).
- verdict: **keep ours**
- A surface that celebrates the same number it warns about teaches nothing. Ascent's shape deliberately has no streak.

**24. The "code review" penalty measures model latency**
- coach: `src/core/detectors/scoring.ts:28-30` (AI code with `totalElapsed < 5000` is penalized); `src/core/parser-claude.ts:687` (`totalElapsed` = last assistant timestamp minus the user timestamp).
- ascent: none. Nearest: `src/lib/org/developer-view.ts:63` (`testsBeforeCommitPct`).
- verdict: **keep ours**
- A fast model reply says nothing about whether a human reviewed the change. Ascent's field measures an act of verification.

**25. Scoring the person vs placing the person in a band**
- coach: `src/core/detectors/scoring.ts:44-50` (weekly score = 100 minus penalty rate, per practice group).
- ascent: `src/lib/org/developer-view.ts:319-325` (band verdict, no score); GOLDEN-USE-CASES.md:268-273.
- verdict: **different forces**
- The coach scores the individual for the individual, which is coherent for a private tool. Ascent deliberately never scores a person, because a score "would frame the developer as a subject" once an org is in the room.

**26. Thresholds calibrated to the user's own history**
- coach: `src/core/analyzer-context.ts:54-91` (after 20 sessions, the optimal and limited context-utilization cutoffs move to the user's own p60 and p90).
- ascent: `src/components/org/shared/champions.ts:7` (fixed floors); `src/lib/org/developer-view.ts:69-74` (an org band as the external reference).
- verdict: **keep ours**
- A self-relative threshold normalizes a habit away: a developer who always saturates the context window eventually reads as "optimal". The coach cannot say the habit itself is the problem. The mentor should compare against the org band and absolute limits, not against the developer's own history.

**27. Band recoverability at the floor**
- coach: none. Nearest: `src/webview/page-peers.ts:17-27` (the card carries only the user's own totals, no comparison).
- ascent: `src/lib/org/developer-view.ts:69-70` (claims "no individual is recoverable"); `:151-155` (the floor is keyed on the population who *could* opt in); `src/components/org/shared/champions.ts:7` (`CHAMPION_MIN_POP = 3`).
- verdict: **adapt**
- If the three people who could opt in all share, the median of the band is one of their exact values. If one person shares, the band is that person. The coach avoids this by never comparing. Ascent should keep the comparison, but floor it on the number of sharers, with a higher minimum for quartiles, before C4 builds `shapeBands`.

**28. Calibration against the user's data vs a corpus**
- coach: `src/core/metric-engine.ts:280` (`calibrate`, flagged % over the user's own rows); `src/webview/panel-rpc.ts:1150`.
- ascent: `src/lib/analyze/calibration.test.ts:1-4`; `bench/matrix`; `reference-data/`.
- verdict: **different forces**
- A score must mean the same thing across tenants, so ascent calibrates against a fixed corpus. The coach tunes each user's thresholds interactively. For mentor moves, a per-developer "how often would this have fired" preview is legitimate, because nobody else reads it.

## 6. Context health and readiness

**29. The same 4000 threshold with opposite signs**
- coach: `src/core/rules/instruction-bloat.md:11` (`maxBytes: 4000` produces a finding), with the rationale in the rule body (always-on instructions cost input tokens on every request).
- ascent: `src/lib/analyze/guidance-quality.ts:14-15` (4000 characters or more earns 8 points, tied for the largest single D1 guidance signal).
- verdict: **adapt**
- The coach's cost argument holds for any always-loaded CLAUDE.md or AGENTS.md. Ascent pays for length even though the content signals already reward substance. Stop paying for raw size, and treat very large always-on guidance as a cost signal. This is a rubric event, gated on test T4 and the bench matrix.

**30. Which instruction file is measured**
- coach: `src/core/parser-vscode.ts:114` (only `.github/copilot-instructions.md`); `src/core/types/session-types.ts:147-152`.
- ascent: `src/lib/analyze/context-health.ts:24-29` (CLAUDE.md, AGENTS.md, cursor and windsurf rules, copilot-instructions, instruction directories); `:63-74` (a deterministic pick order).
- verdict: **keep ours**
- The coach's bloat rule cannot see a Claude Code or Codex user's instruction file at all. Ascent measures the file an agent actually reads first.

**31. How guidance rot is measured**
- coach: `src/core/analyzer-config.ts:171-186` (stale = newest config file older than 14 days while activity is newer).
- ascent: `src/lib/analyze/context-health.ts:86-113` (potency decays with commit churn); `:134-156` (dead `@file` references checked against the tree).
- verdict: **keep ours**
- Guidance rots with the commits that land after it, not with the calendar. A 14-day modification-time rule flags a stable file in a quiet repo and misses a fresh file that is already wrong.

**32. Readiness is presence on disk (seed corrected)**
- coach: `src/core/analyzer-config.ts:428-532` (eight weighted checks; any single workspace satisfies each one); `:500-505` (MCP probe paths, which do not include a root `.mcp.json`).
- ascent: `src/lib/analyze/index.ts:295-305` (presence, weighted); `:301` (the MCP regex matches `.mcp.json`).
- verdict: **keep ours**
- The seed said the coach's readiness comes from sessions. It is presence, the same kind of signal ascent already scores, with a narrower probe list. There is nothing here for ascent to take.

**33. Context use in the session, not presence in the repo**
- coach: `src/core/types/session-types.ts:14-22` (`CompactionEvent`); `src/core/analyzer-context.ts:93-121` (verdicts from utilization, saturation and compaction rate).
- ascent: none. Nearest: `src/lib/org/developer-view.ts:58-65` (no context-reset field, although GOLDEN-USE-CASES.md:239 lists "context resets").
- verdict: **adapt**
- Only the session shows whether guidance works. GOLDEN-USE-CASES names context resets, and `CareSessionShape` dropped them. Add compactions per session to the shape, measured against absolute limits (see point 26).

## 7. Cost, tokens and cache

**34. Deriving cost from tokens vs taking the vendor's cost**
- coach: `src/core/analyzer-consumption.ts:155-165` (per-request cost from token counts and a price table; VS Code input is the last round only, per `session-types.ts:70-72`).
- ascent: `src/lib/integrations/otlp.ts:142-147` and `src/lib/integrations/sessions.ts:127-129` (the vendor-reported cost metric, labelled by fidelity).
- verdict: **different forces**
- The coach must rebuild cost, and it knowingly undercounts where cumulative input is not persisted. Ascent has an authoritative cost stream for its measured tier. The mentor should share tokens and shape only, and never re-derive dollars locally.

## 8. Attribution to work items and outcomes

**35. Crediting sessions to issues**
- coach: `src/core/github-app-issue-credit-model.ts:139-154` (precedence: direct link, then pasted link, then a sole reference, then nothing); `:224-234` (the total is deduped by unique session); `src/core/github-app-issue-references.ts:25` (pasted links are read from the first two turns only); `src/core/github-app-database.ts:37-41` (Copilot App database only).
- ascent: `src/lib/db/agent-sessions.ts:10-21` (repo x period allocation; no per-PR link).
- verdict: **keep ours**
- The coach's top rung works only because its harness records the linked issue. Ascent's telemetry carries no PR or issue number, so its ladder would start at the guessing rung. If a per-item view ever lands, copy the coach's dedupe rule: its per-issue credits can sum to more than the total, because every workspace session is linked to every direct issue.

**36. Line-count bias and the missing source key**
- coach: `src/core/edit-loc-diff.ts:6-19` (reconstructs file versions, because whole-file rewrite tools over-count and ranged replace tools under-count).
- ascent: `src/lib/integrations/sessions.ts:136-143` (the vendor's lines metric); `src/lib/db/agent-sessions.ts:56` (the row key includes source); `:106-167` (`buildAttemptRollup` groups by repo only and sums `linesAdded` at `:143`).
- verdict: **adapt**
- The seed holds: persistence knows the source and the rollup forgets it. That is harmless with one provider, but not once Copilot or OpenAI rows land (`src/lib/integrations/providers.ts:72-100`), because each vendor counts lines with a different method. Key the rollup by source and never add lines across counting methods. The mentor should not count lines at all.

## 9. Privacy, sharing and the person as a party

**37. What the share sends, and to whom**
- coach: `src/webview/page-peers.ts:31-50` (lines of code, streak and flow score, posted to X, LinkedIn and Reddit).
- ascent: `src/lib/org/developer-view.ts:209-218` (a privacy ledger where every row is off by default and never-sent rows are named); `:232-241` (never-sent rows are locked by a set, not a regex); REGISTRY-AND-CARE-IMPL.md:20-26.
- verdict: **keep ours**
- The coach publishes vanity totals to social networks. Ascent sends opt-in counts to the person's own workspace, with an explicit negative ledger. The person stays a party to their data, not its subject.

**38. Secret redaction at LLM egress (seed corrected)**
- coach: `src/core/redact-secrets.ts:6-14` and `:16-33` (JWTs, connection-string credentials, GitLab PATs, quoted and key=value assignments); `src/mcp/tools.ts:50-55` (redaction at the single egress); `src/core/spotlight.ts:34-41`.
- ascent: `src/lib/llm/eval-log.ts:42-61` (a narrower pattern set, applied to the eval log only); `src/lib/llm/untrusted.ts:39-41` (`neutralize` strips markers but does not redact).
- verdict: **adapt**
- The coach redacts before a model sees transcript text, not before sharing (the card carries only totals). Ascent quotes text written by agents in its prompts, such as lane-report lessons (`src/lib/local/lane-report.ts:107-112`) and memory. Merge the coach's wider pattern set into one redactor and apply it at that egress.

**39. Datamarking vs a boundary with an output screen**
- coach: `src/core/spotlight.ts:6-21` and `:34-41` (every whitespace run is replaced with `^`).
- ascent: `src/lib/llm/untrusted.ts:50-64` (boundary); `:117` (per-channel payoff); `:171-191` (output screen).
- verdict: **keep ours**
- Ascent pairs its boundary with a screen on what the model sends back and a record of which output channel an injection would target. Datamarking trades away all whitespace fidelity and still has no output check.

## 10. Surfaces: dashboard, chat, MCP

**40. Editor LM tools vs a networked MCP door (seed corrected)**
- coach: `src/mcp/tools.ts:193-211` (`vscode.lm.registerTool`, local and read-only); `package.json:106`; `src/mcp/tools.ts:97-107` (a tool result that instructs the model: "Do NOT suggest alternative ways").
- ascent: `src/lib/mcp/protocol.ts:71`; `src/lib/mcp/tools.ts:383-436` (`report_attempt`, `report_skill_invoke`); `src/lib/mcp/write-gate.ts:14-24`.
- verdict: **keep ours**
- The coach's "MCP" folder holds editor LM tools, not an MCP server. Ascent's door is scoped, audited and ceilinged for writes. The coach also puts an instruction to the model inside tool output, the pattern ascent's boundary exists to refuse.

## 11. Performance and robustness

**41. Forked parse worker with ack-window backpressure**
- coach: `src/core/parse-worker.ts:27-31`; `src/core/parser-worker-host.ts:76-80`; `src/core/parse-worker-stream.ts:48-53`; `CHANGELOG.md:5-7`.
- ascent: none. Nearest: `scripts/ascent-skills.mjs` (a zero-dependency single-process CLI, per REGISTRY-AND-CARE-IMPL.md:283-285).
- verdict: **different forces**
- The coach holds every session in memory inside an Electron host with a roughly 2GB ceiling. The mentor emits counts from a one-shot CLI, so it can fold file by file without ever holding sessions. Take a streaming fold with bounded memory as a requirement; skip the fork.

**42. Inline rule fixtures are not executed (seed corrected)**
- coach: `docs/AUTHORING_RULES.md:80-81` (claims `npm test` runs them); `src/core/rule-parser.ts:371-391` (parses `# Tests` fixtures into `rule.tests`, which no test reads); `src/core/metric-engine.ts:147-150` and `:577-605` (the runnable path reads a different section, `# Test Cases` with `expect: flagged`, and is reachable only from `src/webview/panel-rpc.ts:1161-1177`). Only 4 of the 45 rules carry fixtures.
- ascent: `src/lib/analyze/calibration.test.ts:1-4`; `src/lib/org/developer-view.test.ts:102-106`.
- verdict: **keep ours**
- The seed's "45 rules with inline tests" does not hold. The documented fixture format and the executable format disagree, and nothing runs the documented one. Ascent's detectors sit under vitest directly, where a regex change fails the suite.

**43. Parity hash over real logs across two trees**
- coach: `scripts/parse-parity.ts:6-17` (builds the parser from both trees, runs each over the same local logs, and compares SHA-256 hashes of the output).
- ascent: none. Nearest: `src/lib/integrations/sessions.test.ts:43-116` (synthetic wire fixtures only).
- verdict: **adopt**
- Claude Code's JSONL format is undocumented and shifts between versions. A refactor of the mentor's counter should prove "same counts on my real logs" without committing those logs. This hash runs locally, and the logs never leave the machine.

---

## Tests to initiate

**T1. Claude Code session replay (UC3 shape fidelity)**
- **Instrument:** a hand-written JSONL fixture (roughly 40 lines) covering:
  - one interactive session: enters plan mode, calls `Skill`, runs a failing test, edits, reruns the test green, then commits;
  - one SDK-entrypoint session.
- **Arm A:** the coach's `parseClaudeSessions` (the `src/core/parser-claude.test.ts:97` harness), reading `agentMode`, `slashCommand`, `skillsUsed`, `launcherKind` and `promptTokens`.
- **Arm B:** the mentor intake counter, once built (feature 2), reading `planModePct`, `testsBeforeCommitPct`, `skillInvokes30d`, `turnsPerSession` and compactions.
- **Numbers that move:**
  - `planModePct`: Arm A has no field that can hold it (expect 0 or not representable); Arm B should report the plan turns out of N.
  - Sessions counted toward the shape: expect 2 in Arm A and 1 in Arm B.
  - `promptTokens` scope: Arm A sums all rounds, and point 8 predicts that differs from its documented scope.

**T2. Rollup source mixing (vitest, pure)**
- **Instrument:** `src/lib/db/agent-sessions.test.ts`, a new case for `buildAttemptRollup`: two rows for the same repo, `claude-code` with 100 lines and a synthetic `copilot` row with 100 lines.
- **Arm A:** the current rollup. **Arm B:** a source-keyed rollup.
- **Numbers that move:** `repos[0].linesAdded` (200 in one row, vs two rows of 100); the count of repo rows whose total mixes sources (1, vs 0).

**T3. Guidance keyword saturation, with a stuffed control**
- **Instrument:** a script over the guidance files in `reference-data/dump-*.json` and `bench/matrix`, calling `guidanceQuality` (`src/lib/analyze/guidance-quality.ts:11`) for each file.
- **Arm A:** the real guidance files.
- **Arm B:** a synthetic 4001-character CLAUDE.md that contains each trigger phrase once in neutral filler.
- **Numbers that move:** per-signal fire rate on Arm A (any signal above 85% is a zero-information candidate); D1 guidance points on Arm B vs the median real file (if the stuffed file reaches the 56-point maximum, the proxy can be gamed).

**T4. The 4000 boundary**
- **Instrument:** vitest over `guidanceQuality` and `deriveContextHealth`, using this repo's own AGENTS.md at three sizes: truncated to 3999 characters, as-is, and padded to 4001 with neutral prose.
- **Arm A:** ascent's current grading.
- **Arm B:** the coach's `instruction-bloat` threshold applied to the same bytes.
- **Numbers that move:** D1 points across the boundary (currently +3, from 5 to 8, for 2 characters of padding) vs the coach's verdict flipping to "bloat". After feature 4 lands, the ascent delta should be 0.

**T5. Usage-lane inflation and window**
- **Instrument:** vitest over `aggregateUsage` (`src/lib/registry/usage-samples.ts:101`) with two contributor files: an honest one (`invokes: 12`, `windowDays: 30`) and an inflated one (`invokes: 1000000`, `windowDays: 365`).
- **Arm A:** current code. **Arm B:** the ceiling plus window normalization (feature 6).
- **Numbers that move:** `invokes30d` (1000012 in Arm A vs a bounded, window-normalized value); `bySkill` for the shared skill.

**T6. Band recoverability**
- **Instrument:** vitest: three sharers with `planModePct` values [10, 40, 90]; compute p25/p50/p75 the way C4 intends; then assert what a sharer who knows their own value can infer.
- **Arm A:** floor on population (3, the current `belowFloor` rule).
- **Arm B:** floor on sharers, with a minimum of 5 for quartiles.
- **Numbers that move:** individual values exactly recoverable from the band (at least 1 in Arm A, 0 in Arm B, because it is suppressed).

---

## Features ranked

Scope test used for every item: `scope.does` = "the maturity index for AI-native engineering: scores repositories and manifests, consumes the registry index"; `does_not` = "agent runtime or companions; product UI beyond the index's own surfaces".

**1. Care share contract: per-field scope, why-empty state and launcher filter (UC3, C3 prerequisite)**
- **Why in scope:** it is the read model of the index's own `/org/developer` surface (REGISTRY-AND-CARE-IMPL.md section 5.4, lines 253-258). It fixes the payload `POST /api/me/mentor/share` will accept before any producer exists (points 6, 7, 9, 33).
- **Size:** 4 files, about 365 lines:
  - `src/lib/org/developer-view.ts`: +50 (per-field `scope` and `reason`, compactions field)
  - new `src/lib/org/care-shape-contract.ts`: about 140 (validator, window and denominator constants)
  - its test: about 160
  - `src/features/developer/CareShapeRow.tsx`: +15 (render the reason instead of a dash)

**2. Mentor intake counter over Claude Code JSONL (UC3 sequencing step 1)**
- **Why in scope:** GOLDEN-USE-CASES.md:275-279 puts `mentor init` and `intake` in the public distributable, and REGISTRY-AND-CARE-IMPL.md:283-285 names `mentor init|share` in the CLI. The counter is a sensor that emits counts, not a companion runtime. The coaching conversation stays in the registry's `skills/mentor/`.
- **Scope tension, for the owner:** `does_not: agent runtime or companions` should say explicitly that a local count-only sensor is admitted.
- **Covers:** plan mode, `Skill` invokes, tests-before-commit, retries (same error 3x), compactions, the interactive-entrypoint filter, and a bounded-memory streaming fold (points 2-6, 41). Pair it with a parity-hash script (point 43).
- **Size:** about 6 files, about 700 lines:
  - new `scripts/ascent-mentor-intake.mjs`: about 320
  - about 4 fixture JSONL files: about 120
  - `scripts/__tests__/ascent-mentor-intake.test.mjs`: about 220
  - parity script: about 40

**3. Source-keyed attempt rollup (before a second provider lands)**
- **Why in scope:** these are the unit-economics numbers the index publishes. Summing lines across counting methods would breach D32 (point 36).
- **Size:** 2-3 files, about 105 lines:
  - `src/lib/db/agent-sessions.ts`: +35 (source in the select and the group key)
  - `src/lib/db/agent-sessions.test.ts`: +60 (T2)
  - one consumer read site: about 10

**4. Stop rewarding guidance length (rubric event)**
- **Why in scope:** it scores repositories directly, and it resolves the sign contradiction with a credible cost argument (point 29).
- **Size:** 5 files, about 75 lines:
  - `src/lib/analyze/guidance-quality.ts`: about 10 changed
  - `src/lib/analyze/context-health.ts:77` (`GUIDANCE_QUALITY_MAX`): 1
  - `src/lib/analyze/calibration.test.ts`: +40 (T4)
  - `src/lib/maturity/model.ts:202`: 1 (rubric bump)
  - `docs/SCORING-VALIDITY.md`: +20
- **Gate:** land only after T3 and T4 and a bench matrix run.

**5. Guidance signal saturation census**
- **Why in scope:** it measures the validity of the index's own D1 detector (point 15). It is an instrument, with no product change.
- **Size:** 2 files, about 190 lines: new `scripts/guidance-signal-census.mjs` (about 130) and its test (about 60).

**6. One ceiling for self-reported counts, plus honest windows**
- **Why in scope:** the registry index sums these counts into skill dormancy and ranking, and the mentor share will add a third door (points 12, 21).
- **Size:** 3 files, about 140 lines:
  - `src/lib/registry/usage-samples.ts`: +30
  - `src/lib/registry/usage-samples.test.ts`: +70 (T5)
  - a shared ceiling constant beside `src/lib/mcp/write-gate.ts:95`: about 40

**7. Care band floor on sharers (UC3, C4 prerequisite)**
- **Why in scope:** it is the index's own org surface (Contributors > Care), and it makes the "no individual is recoverable" comment true (point 27).
- **Size:** 3 files, about 80 lines:
  - `src/lib/org/developer-view.ts`: +20 (`sharers` field, quartile minimum)
  - `src/lib/org/developer-view.test.ts`: +50 (T6)
  - `src/features/bought/contributors/CareOrgBandStrips.tsx`: +10 (suppressed copy)

**8. One redactor at the prompt egress for text written by agents**
- **Why in scope:** it hardens the index's own LLM calls over lane lessons and memory (point 38).
- **Size:** 4 files, about 170 lines:
  - new `src/lib/security/redact.ts`: about 70 (ascent's `eval-log.ts` patterns plus the coach's JWT, connection-string, GitLab PAT and quoted-assignment shapes)
  - `src/lib/llm/eval-log.ts`: -25 / +2
  - the call site where lane-report lessons become candidates: +5 (locate from `src/lib/local/lane-report.ts:142`)
  - test: about 90

---

## What ascent does better

- **Bounded payoff for text from the scanned party.** Untrusted content has no authority, each output channel's payoff is recorded, and a discrepancy budget caps how far the model can widen a score: `src/lib/llm/untrusted.ts:50-64`, `:117`; `src/lib/scoring/discrepancy-policy.ts:1-27`. The coach's only defense is a trust-on-first-use hash, which is right for its threat but has nothing to say about a multi-tenant scorer.
- **The model's judgment moves a score only through a verified citation:** `src/lib/scoring/claims.ts:12-16`. The coach's classifiers are first-match regexes (`src/core/helpers.ts:328-335`).
- **The person as a party.** The privacy ledger names what is never sent, and per-person org rows cannot be represented in the data: `src/lib/org/developer-view.ts:9-12`, `:209-241`. The coach posts streaks to social networks (`src/webview/page-peers.ts:31-50`).
- **Withheld is typed, not a null:** `src/components/org/shared/champions.ts:34-56`; `src/lib/org/developer-view.ts:76-89`; `src/lib/org/developer-view-load.ts:23-30`.
- **Floors are enforced by the producers,** so no consumer can forget them: `src/components/org/shared/champions.ts:9-18`.
- **Cost is allocated, not attributed, and rates are named for what they measure:** `src/lib/db/agent-sessions.ts:10-21`, `:209-213` (`producedRate` is "NOT a success rate").
- **Fidelity is typed end to end,** and 0 means "not reported": `src/lib/integrations/providers.ts:6-23`; `src/lib/integrations/copilot.ts:4-10`.
- **Dropped data is counted and named:** `src/lib/integrations/otlp.ts:15-17`, `:79-89`.
- **Guidance rot is measured by churn and dead references:** `src/lib/analyze/context-health.ts:105-113`, `:134-156`. The coach uses a 14-day modification-time rule.
- **Decision memory that resurfaces** when a finding changes kind, severity or age: `src/lib/analyze/passport-overlay.ts:7-15`.
- **A write door with scopes, plan gates and per-token ceilings:** `src/lib/mcp/write-gate.ts:14-24`. The coach's tools only read, for the editor's chat.
- **An agent's account is kept apart from the verdict:** `src/lib/local/lane-report.ts:5-7`, `:140-141`; `src/lib/mcp/tools.ts:383-392`.
- **Versioned rubric plus corpus calibration:** `src/lib/maturity/model.ts:202`; `src/lib/analyze/calibration.test.ts:1-4`; display-only derivations are pinned as display-only (`src/lib/analyze/context-health.ts:10-12`). The coach's documented rule fixtures never run (point 42).
- **One canonical time-zone frame:** `src/lib/org/timezone.ts:1-12`. The coach reads the machine-local hour (`src/core/dsl/interpreter.ts:991-994`).
