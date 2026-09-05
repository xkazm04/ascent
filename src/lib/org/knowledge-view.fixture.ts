// Shaped example `KnowledgeView` — the fleet standing a young org cannot produce, so the Knowledge
// base tab can be READ before a registry is mapped and a sweep has run.
//
// SELECTED IN REACT STATE, NOT BY A SEARCH PARAM (same rule as `registry-view.fixture.ts`): a preview
// must never be a shareable URL that reads as someone's real fleet. Offered ONLY in development
// (`registryPreviewEnabled()`) by `KnowledgePreviewShell`, only while the real status is `unmapped`,
// and stamped as a preview with every action inert.
//
// CLIENT-SAFE BY CONSTRUCTION: type imports only, plus `titleOfSlug` from the client-safe shape module.
// Importing `./knowledge-view` for a VALUE here would drag `@/lib/db` into the browser bundle.
//
// THE TAXONOMY AND SUBJECT ROWS ARE REAL. They were generated from the ai-registry's own
// `knowledge/software-engineering/{taxonomy,index}.json` (52 of 214 subjects, every category kept),
// so slugs, files, digests, laws and `use_when` triggers are the registry's, not invented — a
// reviewer scoring a variant on "does it encode data I care about" is looking at the real nouns.
// The FLEET half (repos, verdicts, directions, dispatches) is shaped: eight repos chosen so every one
// of the eleven cell states, every stage and both dispatch modes are reachable from one view.

import type {
  KnowledgeCategory,
  KnowledgeCell,
  KnowledgeCellState,
  KnowledgeRepo,
  KnowledgeSubject,
  KnowledgeView,
  RegistryDispatchRow,
  SignalSummary,
} from "./knowledge-shape";

const S = (
  slug: string,
  category: string,
  subcategory: string | null,
  status: string,
  file: string,
  techniqueCount: number,
  digest: string,
  useWhen: string[],
  laws: string[],
): KnowledgeSubject => ({ bundle: "software-engineering", slug, category, subcategory, status, file, techniqueCount, useWhen, laws, digest });

export const SE_TAXONOMY: KnowledgeCategory[] = [
  { id: "ui-surfaces", title: "UI surfaces", order: 1, subjects: [], subcategories: [
    { id: "data-display", title: "Data display", subjects: ["table","feed","data-viz"] },
    { id: "shell-and-navigation", title: "Shell and navigation", subjects: ["app-shell","modal-stack"] },
    { id: "feedback-and-style", title: "Feedback and style", subjects: ["async-ui-states","status-vocabulary","design-tokens"] },
  ] },
  { id: "client-architecture", title: "Client architecture", order: 2, subjects: ["client-fetch-cache","client-state","demo-data-plane"], subcategories: [
  ] },
  { id: "llm-agent", title: "LLM & agent engineering", order: 3, subjects: [], subcategories: [
    { id: "prompt-and-context", title: "Prompt and context", subjects: ["prompt-assembly","agent-memory","structured-output","agent-instruction-files"] },
    { id: "orchestration", title: "Orchestration", subjects: ["fleet-orchestration","hitl-approval","remediation-handoff"] },
    { id: "runtime-and-io", title: "Runtime and I/O", subjects: ["subprocess-lifecycle","mcp-tools"] },
    { id: "evaluation-and-cost", title: "Evaluation and cost", subjects: ["eval-harness","cost-metering"] },
    { id: "companion", title: "Companion", subjects: ["companion-runtime"] },
  ] },
  { id: "backend-platform", title: "Backend platform", order: 4, subjects: [], subcategories: [
    { id: "data-layer", title: "Data layer", subjects: ["data-access","migrations"] },
    { id: "work-execution", title: "Work execution", subjects: ["background-jobs","scheduling"] },
    { id: "resilience", title: "Resilience", subjects: ["rate-limiting","error-handling","webhook-ingestion"] },
    { id: "platform-observability", title: "Platform observability", subjects: ["observability-telemetry"] },
  ] },
  { id: "operations", title: "Operations & governance", order: 5, subjects: [], subcategories: [
    { id: "governance-and-records", title: "Governance and records", subjects: ["audit-logging","data-retention","settings"] },
    { id: "service-operations", title: "Service operations", subjects: ["triage-queues","usage-analytics","plan-entitlements"] },
  ] },
  { id: "security", title: "Security", order: 6, subjects: [], subcategories: [
    { id: "identity-and-access", title: "Identity and access", subjects: ["authorization","credential-vault"] },
    { id: "data-and-transport", title: "Data and transport", subjects: ["browser-credential-boundary"] },
  ] },
  { id: "integration", title: "Integration", order: 7, subjects: ["cicd-monitoring","connector-catalog"], subcategories: [
  ] },
  { id: "engineering-process", title: "Engineering process", order: 8, subjects: [], subcategories: [
    { id: "codebase-stewardship", title: "Codebase stewardship", subjects: ["codebase-scanning","docs-sync"] },
    { id: "standards-and-gates", title: "Standards and gates", subjects: ["quality-gates","knowledge-registry"] },
    { id: "continuous-integration", title: "Continuous integration", subjects: ["runner-fleet"] },
  ] },
  { id: "engineering-assessment", title: "Engineering assessment", order: 9, subjects: [], subcategories: [
    { id: "maturity-and-conformance", title: "Maturity and conformance", subjects: ["maturity-ladders","conformance-checking"] },
    { id: "reporting-and-remediation", title: "Reporting and remediation", subjects: ["executive-reporting","adoption-measurement"] },
  ] },
  { id: "secret-custody-and-issuance", title: "Secret custody and issuance", order: 10, subjects: ["seal-and-key-hierarchy"], subcategories: [
  ] },
];

// One row per picked subject, VERBATIM from the bundle's index.json (file, digest, status, laws, use_when).
export const SE_SUBJECTS: KnowledgeSubject[] = [
  S("table", "ui-surfaces", "data-display", "forged", "knowledge/software-engineering/ui-surfaces/data-display/table/table.md", 5, "sha256:6a77e71f01e80b19", ["placing filter sort and window on server or client","a sort that only reorders the loaded page","deciding when a client-held table must move server-side"], ["count-carries-predicate","failure-not-empty-success","identity-survives-reuse","derivation-names-recomputation"]),
  S("data-viz", "ui-surfaces", "data-display", "reconciled", "knowledge/software-engineering/ui-surfaces/data-display/data-viz/data-viz.md", 6, "sha256:b6657691892c6b9b", ["deciding whether the chart engine ships in the entry chunk","choosing what holds the slot while engine and data wait","one malformed series blanks the whole dashboard"], ["creation-names-reaper","failure-not-empty-success","one-authority-per-vocabulary","identity-survives-reuse"]),
  S("feed", "ui-surfaces", "data-display", "forged", "knowledge/software-engineering/ui-surfaces/data-display/feed/feed.md", 5, "sha256:23236fee1ffbf827", ["one busy producer drowns the whole feed","deciding whether clusters may be stored or only derived","expanded clusters reset as new members arrive"], ["derivation-names-recomputation","count-carries-predicate","identity-survives-reuse","creation-names-reaper"]),
  S("async-ui-states", "ui-surfaces", "feedback-and-style", "forged", "knowledge/software-engineering/ui-surfaces/feedback-and-style/async-ui-states/async-ui-states.md", 7, "sha256:4d89ccb3b7b69ed0", ["making a pressed control acknowledge async work","a fast double-press submits twice","one press lights every sibling's spinner"], ["identity-survives-reuse","failure-not-empty-success","count-carries-predicate"]),
  S("status-vocabulary", "ui-surfaces", "feedback-and-style", "forged", "knowledge/software-engineering/ui-surfaces/feedback-and-style/status-vocabulary/status-vocabulary.md", 6, "sha256:0bdc30b0870393c6", ["deciding where locale resolution lives","sub-unit spend rendering as zero","auditing a checker blind to formatter callbacks"], ["gate-sees-target","one-authority-per-vocabulary","failure-not-empty-success","one-validation-door"]),
  S("design-tokens", "ui-surfaces", "feedback-and-style", "reconciled", "knowledge/software-engineering/ui-surfaces/feedback-and-style/design-tokens/design-tokens.md", 6, "sha256:285d0bf6dac74e64", ["choosing between generated mirrors and runtime readback","an animation wait fires before the motion lands","auditing a parity checker that found zero tokens"], ["one-authority-per-vocabulary","gate-sees-target","derivation-names-recomputation","failure-not-empty-success"]),
  S("app-shell", "ui-surfaces", "shell-and-navigation", "forged", "knowledge/software-engineering/ui-surfaces/shell-and-navigation/app-shell/app-shell.md", 6, "sha256:ae100598f7bfe8ef", ["defining what a nav badge counts and when it clears","every entry glows so nothing does","several signals compete for one nav slot"], ["count-carries-predicate","derivation-names-recomputation","one-authority-per-vocabulary","gate-sees-target"]),
  S("modal-stack", "ui-surfaces", "shell-and-navigation", "reconciled", "knowledge/software-engineering/ui-surfaces/shell-and-navigation/modal-stack/modal-stack.md", 6, "sha256:e4aa47b6a226c7fc", ["popover drifts off its anchor on scroll","choosing track or dismiss on ancestor scroll","submenu closes as the pointer moves toward it"], ["derivation-names-recomputation","count-carries-predicate","creation-names-reaper","one-authority-per-vocabulary"]),
  S("client-fetch-cache", "client-architecture", null, "reconciled", "knowledge/software-engineering/client-architecture/client-fetch-cache/client-fetch-cache.md", 10, "sha256:82eec4974811c25d", ["constructing a cache and deciding what belongs in it","a cache is full of entries nobody reads twice","choosing an eviction rule"], ["count-carries-predicate","identity-survives-reuse","one-authority-per-vocabulary","creation-names-reaper"]),
  S("client-state", "client-architecture", null, "forged", "knowledge/software-engineering/client-architecture/client-state/client-state.md", 12, "sha256:926f4d3e75e92e75", ["stale responses overwriting fresher answers","duplicate flights for identical questions","failed rollback erasing concurrent mutation"], ["identity-survives-reuse","one-authority-per-vocabulary","creation-names-reaper","one-validation-door"]),
  S("demo-data-plane", "client-architecture", null, "forged", "knowledge/software-engineering/client-architecture/demo-data-plane/demo-data-plane.md", 6, "sha256:1d54d97538ca77bd", ["shipping a fabricated surface a customer can reach","deciding whether a demo may render a badge or alert count","a real tenant reported numbers that do not match their account"], ["count-carries-predicate","failure-not-empty-success","one-authority-per-vocabulary","identity-survives-reuse"]),
  S("prompt-assembly", "llm-agent", "prompt-and-context", "forged", "knowledge/software-engineering/llm-agent/prompt-and-context/prompt-assembly/prompt-assembly.md", 20, "sha256:11edebaca05f8e15", ["a long session stalls visibly when the transcript crosses its compaction threshold","deciding how often to rewrite history against a provider cache discount","a summarizer paraphrased a standing instruction the operator gave"], ["count-carries-predicate","derivation-names-recomputation","failure-not-empty-success","one-authority-per-vocabulary"]),
  S("agent-memory", "llm-agent", "prompt-and-context", "forged", "knowledge/software-engineering/llm-agent/prompt-and-context/agent-memory/agent-memory.md", 18, "sha256:a98efbeead58b108", ["deciding whether a memory pipeline earns its cost","a memory system reports a score and nobody asked against what","choosing between two memory designs on one benchmark number"], ["count-carries-predicate","derivation-names-recomputation","one-validation-door","failure-not-empty-success"]),
  S("agent-instruction-files", "llm-agent", "prompt-and-context", "forged", "knowledge/software-engineering/llm-agent/prompt-and-context/agent-instruction-files/agent-instruction-files.md", 14, "sha256:77d429762d4c4d61", ["an agent keeps failing the same way and the instruction file keeps growing","deciding whether an observed failure should produce a new line at all","a rule has been restated three times and still is not followed"], ["failure-not-empty-success","gate-sees-target","absent-guard-is-loud","derivation-names-recomputation"]),
  S("structured-output", "llm-agent", "prompt-and-context", "reconciled", "knowledge/software-engineering/llm-agent/prompt-and-context/structured-output/structured-output.md", 9, "sha256:f317f1bcdc5da7b8", ["the request enumerates units the model must each answer","a validated artifact may still be half-answered","deciding whether a thin response is a failure"], ["failure-not-empty-success","gate-sees-target","count-carries-predicate","identity-survives-reuse"]),
  S("fleet-orchestration", "llm-agent", "orchestration", "forged", "knowledge/software-engineering/llm-agent/orchestration/fleet-orchestration/fleet-orchestration.md", 14, "sha256:a00b0ccc5058e6bd", ["a record arrives carrying no status and something must decide what to show","a session is permanently busy with no turn that could ever finish it","a liveness probe cannot reach the thing that answers whether a process exists"], ["unknown-is-not-a-value","failure-not-empty-success","one-validation-door","absent-guard-is-loud"]),
  S("hitl-approval", "llm-agent", "orchestration", "forged", "knowledge/software-engineering/llm-agent/orchestration/hitl-approval/hitl-approval.md", 13, "sha256:b8bf4feb62dcd7f0", ["grant tuple silently widened to whole capability","a stored grant never matches because the action is a composed string","re-ask initializes from defaults not stored answer"], ["gate-sees-target","identity-survives-reuse","creation-names-reaper","one-authority-per-vocabulary"]),
  S("remediation-handoff", "llm-agent", "orchestration", "forged", "knowledge/software-engineering/llm-agent/orchestration/remediation-handoff/remediation-handoff.md", 7, "sha256:a59d2ce05cfb8d3c", ["deciding how many findings to hand to one autonomous session","a weakness appears across most of the estate at once","matching last run's findings against this run's findings"], ["count-carries-predicate","identity-survives-reuse","derivation-names-recomputation","gate-sees-target"]),
  S("mcp-tools", "llm-agent", "runtime-and-io", "reconciled", "knowledge/software-engineering/llm-agent/runtime-and-io/mcp-tools/mcp-tools.md", 15, "sha256:db3919147e24468b", ["minting per-consumer tokens for a tool server","deciding whether listing tools needs a token","a caller's inbound token reaching downstream"], ["one-validation-door","gate-sees-target","creation-names-reaper","limits-are-derived"]),
  S("subprocess-lifecycle", "llm-agent", "runtime-and-io", "reconciled", "knowledge/software-engineering/llm-agent/runtime-and-io/subprocess-lifecycle/subprocess-lifecycle.md", 7, "sha256:d9717b151d3057be", ["a cancelled call still burns CPU after the surface stopped painting","choosing between a cooperative cancellation token and a kill boundary","an in-process plugin ignored its abort signal"], ["creation-names-reaper","count-carries-predicate","failure-not-empty-success","gate-sees-target"]),
  S("cost-metering", "llm-agent", "evaluation-and-cost", "reconciled", "knowledge/software-engineering/llm-agent/evaluation-and-cost/cost-metering/cost-metering.md", 8, "sha256:ac361bee21554c72", ["enumerating every path that can start metered spend","a lowered ceiling still letting calls through","choosing fail-open or fail-closed when the store is down"], ["gate-sees-target","one-validation-door","failure-not-empty-success","count-carries-predicate"]),
  S("eval-harness", "llm-agent", "evaluation-and-cost", "forged", "knowledge/software-engineering/llm-agent/evaluation-and-cost/eval-harness/eval-harness.md", 18, "sha256:7e85360e870b4468", ["deciding whether a property needs a judge","judge scoring what a checklist could catch","checks passing output a human would reject"], ["gate-sees-target","failure-not-empty-success","count-carries-predicate","identity-survives-reuse"]),
  S("companion-runtime", "llm-agent", "companion", "forged", "knowledge/software-engineering/llm-agent/companion/companion-runtime/companion-runtime.md", 7, "sha256:0d0b7d17a538708c", ["a companion is gaining the ability to act and not only talk","the model emits an action kind nothing executes","a model-composed surface has no way back to a good state"], ["one-authority-per-vocabulary","derivation-names-recomputation","one-validation-door","gate-sees-target"]),
  S("data-access", "backend-platform", "data-layer", "reconciled", "knowledge/software-engineering/backend-platform/data-layer/data-access/data-access.md", 12, "sha256:922e6f7cf97cc8ee", ["a caller holds many ids and only fetch-one exists","deciding join versus fetch-and-stitch","batch works in tests dies at four thousand ids"], ["gate-sees-target","count-carries-predicate","one-authority-per-vocabulary","absent-guard-is-loud"]),
  S("migrations", "backend-platform", "data-layer", "reconciled", "knowledge/software-engineering/backend-platform/data-layer/migrations/migrations.md", 9, "sha256:236c5264a1e85d15", ["backfilling a new column from existing fields","deciding whether a rewrite fits one transaction","a resumed batch skips rows it already converted"], ["identity-survives-reuse","derivation-names-recomputation","count-carries-predicate","one-authority-per-vocabulary"]),
  S("background-jobs", "backend-platform", "work-execution", "forged", "knowledge/software-engineering/backend-platform/work-execution/background-jobs/background-jobs.md", 6, "sha256:3f8769df97968b35", ["deciding how fast an idle loop should tick","wake signals arrive but work still gets missed","every loop fires together and spikes the store"], ["identity-survives-reuse","failure-not-empty-success","creation-names-reaper","count-carries-predicate"]),
  S("scheduling", "backend-platform", "work-execution", "reconciled", "knowledge/software-engineering/backend-platform/work-execution/scheduling/scheduling.md", 6, "sha256:440155430b17d557", ["choosing which suppression shape fits a reaction","deciding whether to suppress on a clock or an open artifact","same alert refiring while the condition still holds"], ["count-carries-predicate","failure-not-empty-success","derivation-names-recomputation","identity-survives-reuse"]),
  S("rate-limiting", "backend-platform", "resilience", "forged", "knowledge/software-engineering/backend-platform/resilience/rate-limiting/rate-limiting.md", 10, "sha256:a81b069ef7e72fbd", ["naming the burst semantic before picking a family","a one-second spike becomes a self-renewing lockout","clock sync steps backward and tokens get minted"], ["creation-names-reaper","derivation-names-recomputation","count-carries-predicate","one-validation-door"]),
  S("error-handling", "backend-platform", "resilience", "forged", "knowledge/software-engineering/backend-platform/resilience/error-handling/error-handling.md", 11, "sha256:7d61cb18c9c8439d", ["the error rate tracks traffic instead of health","a deploy shows a burst of failures that nobody can attribute","deciding whether a cancelled operation is worth telling anyone about"], ["unknown-is-not-a-value","verdict-survives-boundary","failure-not-empty-success","one-authority-per-vocabulary"]),
  S("webhook-ingestion", "backend-platform", "resilience", "reconciled", "knowledge/software-engineering/backend-platform/resilience/webhook-ingestion/webhook-ingestion.md", 6, "sha256:c45c1d6ac548e84d", ["reproducing a webhook failure from its record","replay runs clean but delivers garbage","deciding whether rejected deliveries are kept"], ["one-validation-door","creation-names-reaper","failure-not-empty-success","count-carries-predicate"]),
  S("observability-telemetry", "backend-platform", "platform-observability", "reconciled", "knowledge/software-engineering/backend-platform/platform-observability/observability-telemetry/observability-telemetry.md", 6, "sha256:a8d8676da144fd28", ["deciding where crash evidence lands on disk","deciding whether scrubbing can wait until upload","a crash store that crashes its own reader"], ["creation-names-reaper","gate-sees-target","one-authority-per-vocabulary","failure-not-empty-success"]),
  S("audit-logging", "operations", "governance-and-records", "forged", "knowledge/software-engineering/operations/governance-and-records/audit-logging/audit-logging.md", 9, "sha256:f7ce3d08d3dbd8f2", ["deciding which operations a ledger may export","correcting a record that was written wrong","an idempotency guard wants to live in the ledger"], ["deletion-is-not-repair","identity-survives-reuse","count-carries-predicate","failure-not-empty-success"]),
  S("data-retention", "operations", "governance-and-records", "forged", "knowledge/software-engineering/operations/governance-and-records/data-retention/data-retention.md", 6, "sha256:14f624480d0c165b", ["gating an irreversible destructive action","designing a delete-everything confirmation","reviewing a dangerous operator workflow"], ["gate-sees-target","one-validation-door","failure-not-empty-success","count-carries-predicate"]),
  S("settings", "operations", "governance-and-records", "forged", "knowledge/software-engineering/operations/governance-and-records/settings/settings.md", 12, "sha256:4b6026021bd23370", ["a default the user deleted comes back after every upgrade","shipping a new default entry into a collection users already edited","deciding between a settings schema version and something simpler"], ["unknown-is-not-a-value","identity-survives-reuse","derivation-names-recomputation","one-authority-per-vocabulary"]),
  S("plan-entitlements", "operations", "service-operations", "forged", "knowledge/software-engineering/operations/service-operations/plan-entitlements/plan-entitlements.md", 6, "sha256:5f5964288e73197b", ["gating a feature behind a plan","writing an upgrade prompt","a paid button that fails after it was shown"], ["gate-sees-target","one-validation-door","failure-not-empty-success","one-authority-per-vocabulary"]),
  S("usage-analytics", "operations", "service-operations", "forged", "knowledge/software-engineering/operations/service-operations/usage-analytics/usage-analytics.md", 6, "sha256:d1faf87976598af1", ["defining what counts as activation","a funnel rate comes back over 100%","deciding whether a zero-visit surface is dead"], ["count-carries-predicate","gate-sees-target","deletion-is-not-repair","creation-names-reaper"]),
  S("triage-queues", "operations", "service-operations", "forged", "knowledge/software-engineering/operations/service-operations/triage-queues/triage-queues.md", 6, "sha256:89add251704338ae", ["letting one judgment cover many items","a stale count after the queue mutated","deciding how much friction bulk-accept earns"], ["count-carries-predicate","identity-survives-reuse","creation-names-reaper","failure-not-empty-success"]),
  S("authorization", "security", "identity-and-access", "reconciled", "knowledge/software-engineering/security/identity-and-access/authorization/authorization.md", 10, "sha256:088440eaf997ec6d", ["designing what each denial record carries","deciding whether secrets enter the audit line","an empty trail reads as zero denials"], ["failure-not-empty-success","count-carries-predicate","gate-sees-target","one-authority-per-vocabulary"]),
  S("credential-vault", "security", "identity-and-access", "reconciled", "knowledge/software-engineering/security/identity-and-access/credential-vault/credential-vault.md", 9, "sha256:1772d33e2929beec", ["routing a provider to its best acquisition mode","credential fails inside automation days after entry","a tool refresh silently killed the vault's copy"], ["one-validation-door","failure-not-empty-success","gate-sees-target","creation-names-reaper"]),
  S("browser-credential-boundary", "security", "data-and-transport", "forged", "knowledge/software-engineering/security/data-and-transport/browser-credential-boundary/browser-credential-boundary.md", 8, "sha256:872dee7802148571", ["a public client needs counts computed from identifying rows","revoking a browser grant that a feature still depends on","a view is about to be published to an anonymous role"], ["gate-sees-target","derivation-names-recomputation","absent-guard-is-loud","creation-names-reaper"]),
  S("connector-catalog", "integration", null, "forged", "knowledge/software-engineering/integration/connector-catalog/connector-catalog.md", 6, "sha256:52a801634eec0a7d", ["shaping the internal model from consumer needs","unclassifiable failures turning into empty results","a dashboard shows zero for an unavailable field"], ["one-authority-per-vocabulary","failure-not-empty-success","identity-survives-reuse","creation-names-reaper"]),
  S("cicd-monitoring", "integration", null, "forged", "knowledge/software-engineering/integration/cicd-monitoring/cicd-monitoring.md", 6, "sha256:ec824b34b96db048", ["answering what version sits on staging","judging whether a slow run is abnormal","a success rate quoted without its window"], ["count-carries-predicate","derivation-names-recomputation","failure-not-empty-success","creation-names-reaper"]),
  S("quality-gates", "engineering-process", "standards-and-gates", "forged", "knowledge/software-engineering/engineering-process/standards-and-gates/quality-gates/quality-gates.md", 25, "sha256:d80c2a54a86f8a4a", ["an item passes many gates over months or years rather than one pipeline run","deciding what the record shows for an obligation a gate waived","a tracking board whose compliance column is mostly empty cells"], ["unknown-is-not-a-value","count-carries-predicate","gate-sees-target","absent-guard-is-loud"]),
  S("knowledge-registry", "engineering-process", "standards-and-gates", "forged", "knowledge/software-engineering/engineering-process/standards-and-gates/knowledge-registry/knowledge-registry.md", 8, "sha256:9c9f691ae63896a8", ["consumers need to know whether their copy is current","designing a generated index","choosing a content hash for drift detection"], ["derivation-names-recomputation","count-carries-predicate","one-authority-per-vocabulary","failure-not-empty-success"]),
  S("docs-sync", "engineering-process", "codebase-stewardship", "forged", "knowledge/software-engineering/engineering-process/codebase-stewardship/docs-sync/docs-sync.md", 12, "sha256:cfc6ed37a7d4c0f1", ["scoping a catch-up pass after long unenforced drift","telling covered-at-anchor from never-in-scope","an old marker promises the drift cannot return"], ["failure-not-empty-success","count-carries-predicate","gate-sees-target","one-authority-per-vocabulary"]),
  S("codebase-scanning", "engineering-process", "codebase-stewardship", "forged", "knowledge/software-engineering/engineering-process/codebase-stewardship/codebase-scanning/codebase-scanning.md", 11, "sha256:6a3441fc0f5a84b2", ["proving nothing references this code","dead modules keep each other looking alive","a generated file outlived its generator"], ["gate-sees-target","count-carries-predicate","one-authority-per-vocabulary","identity-survives-reuse"]),
  S("runner-fleet", "engineering-process", "continuous-integration", "forged", "knowledge/software-engineering/engineering-process/continuous-integration/runner-fleet/runner-fleet.md", 6, "sha256:5f9ab9dee3cb91cc", ["a job needs a specific platform or toolchain","adding a second kind of runner","a test suite silently skipped what it could not run"], ["one-authority-per-vocabulary","failure-not-empty-success","creation-names-reaper","gate-sees-target"]),
  S("maturity-ladders", "engineering-assessment", "maturity-and-conformance", "forged", "knowledge/software-engineering/engineering-assessment/maturity-and-conformance/maturity-ladders/maturity-ladders.md", 6, "sha256:0f2f1d831991ecba", ["cutting a continuous signal into named rungs","rung labels keep flipping between runs","choosing band edges"], ["derivation-names-recomputation","count-carries-predicate","one-authority-per-vocabulary","gate-sees-target"]),
  S("conformance-checking", "engineering-assessment", "maturity-and-conformance", "forged", "knowledge/software-engineering/engineering-assessment/maturity-and-conformance/conformance-checking/conformance-checking.md", 8, "sha256:dc327be35448d1e2", ["a repository owner disputes a conformance finding","tuning a detector that misfires","auditing a checker for false passes"], ["gate-sees-target","deletion-is-not-repair","derivation-names-recomputation","absent-guard-is-loud"]),
  S("adoption-measurement", "engineering-assessment", "reporting-and-remediation", "forged", "knowledge/software-engineering/engineering-assessment/reporting-and-remediation/adoption-measurement/adoption-measurement.md", 6, "sha256:4240281a64bbf913", ["reporting how far a practice has spread","an adoption headline rate is being requested","deciding whether an enablement push should target spread or depth"], ["count-carries-predicate","one-authority-per-vocabulary","failure-not-empty-success"]),
  S("executive-reporting", "engineering-assessment", "reporting-and-remediation", "forged", "knowledge/software-engineering/engineering-assessment/reporting-and-remediation/executive-reporting/executive-reporting.md", 6, "sha256:6315c7abe4f145f2", ["a period delta is negative and must still be printed","choosing headings for a report section","deciding whether a bad result may be omitted from a summary"], ["deletion-is-not-repair","one-authority-per-vocabulary","count-carries-predicate","creation-names-reaper"]),
  S("seal-and-key-hierarchy", "secret-custody-and-issuance", null, "forged", "knowledge/software-engineering/secret-custody-and-issuance/seal-and-key-hierarchy/seal-and-key-hierarchy.md", 6, "sha256:55d313eb16e99ade", ["the only custody of the root key is one external key service","adding a break-glass or second-region custody","deciding what happens when a seal is unreachable at start"], ["absent-guard-is-loud","creation-names-reaper","identity-survives-reuse","deletion-is-not-repair"]),
];

const SWEPT_AT = "2026-09-05T06:40:00.000Z";

const repo = (
  repositoryId: string,
  fullName: string,
  stage: KnowledgeRepo["stage"],
  patch: Partial<KnowledgeRepo> = {},
): KnowledgeRepo => ({
  repositoryId,
  fullName,
  stage,
  hasMap: stage === "conform" || stage === "current",
  hasContextMap: stage !== "populate",
  hasManifest: stage !== "populate",
  domains: stage === "populate" ? [] : ["software-engineering"],
  scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
  directions: [],
  contexts: 0,
  pairs: 0,
  judged: 0,
  deviations: 0,
  weaklyGoverned: [],
  sweptAt: SWEPT_AT,
  ...patch,
});

/** Eight repos, one per fact the matrix has to keep apart. Counts are filled from the cells below. */
const REPOS: KnowledgeRepo[] = [
  repo("r-web", "acme/web-app", "current", { contexts: 41, weaklyGoverned: ["Marketing pages"] }),
  repo("r-api", "acme/api", "conform", { contexts: 33, weaklyGoverned: ["Legacy SOAP bridge", "Cron shims"] }),
  repo("r-billing", "acme/billing-service", "conform", { contexts: 19 }),
  repo("r-infra", "acme/infra", "conform", {
    contexts: 24,
    scope: { outOfScopeCategories: ["software-engineering/ui-surfaces"], outOfScopeSubjects: ["software-engineering/companion-runtime"] },
    directions: [
      { subject: "eval-harness", bundle: "software-engineering", decision: "declined" },
      { subject: "hitl-approval", bundle: "software-engineering", decision: "deferred" },
      { subject: "audit-logging", bundle: "software-engineering", decision: "accepted" },
      { subject: "seal-and-key-hierarchy", bundle: "software-engineering", decision: "accepted" },
    ],
  }),
  repo("r-design", "acme/design-system", "current", {
    contexts: 12,
    scope: { outOfScopeCategories: ["software-engineering/llm-agent", "software-engineering/backend-platform"], outOfScopeSubjects: [] },
  }),
  repo("r-docs", "acme/docs-site", "current", { contexts: 9, domains: ["localization"] }),
  repo("r-mobile", "acme/mobile", "map", { contexts: 27 }),
  repo("r-pipeline", "acme/data-pipeline", "populate"),
];

/** FNV-1a — a stable, dependency-free spread so the shaped verdicts never reshuffle between renders. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h % 1000;
}

/** The registry's absence rule (`build-fleet-map.mjs`), first match wins. Mirrors `src/lib/registry/absence.ts`. */
function absence(s: KnowledgeSubject, r: KnowledgeRepo): KnowledgeCellState {
  if (!r.hasMap) return "no-map";
  if (!r.domains.includes(s.bundle)) return "out-of-domain";
  if (r.scope.outOfScopeCategories.includes(`${s.bundle}/${s.category}`) || r.scope.outOfScopeSubjects.includes(`${s.bundle}/${s.slug}`)) return "out-of-scope";
  const d = r.directions.find((x) => x.subject === s.slug && x.bundle === s.bundle);
  if (d) return d.decision;
  return "candidate";
}

const EVIDENCE: Record<string, string> = {
  deviation: "src/lib/route.ts:42 — the guard reads the raw env instead of the flag's definition",
  conformant: "src/lib/db/index.ts:118 — one validation door, every writer goes through it",
  "not-applicable": "no surface of this kind exists in the repo",
};

function verdict(s: KnowledgeSubject, r: KnowledgeRepo, h: number): KnowledgeCell {
  const stale = r.repositoryId === "r-api" && h % 7 === 0;
  let state: KnowledgeCellState;
  if (r.repositoryId === "r-web") state = (["conformant", "conformant", "deviation", "not-applicable"] as const)[h % 4] ?? "conformant";
  else if (r.repositoryId === "r-api") state = h % 10 < 4 ? "unknown" : h % 3 === 0 ? "deviation" : "conformant";
  else if (r.repositoryId === "r-billing") state = h % 10 < 7 ? "unknown" : "conformant";
  else if (r.repositoryId === "r-infra") state = h % 5 === 0 ? "deviation" : h % 5 === 1 ? "unknown" : "conformant";
  else state = h % 6 === 0 ? "deviation" : "conformant";
  return { subject: s.slug, repositoryId: r.repositoryId, state, stale, contexts: 1 + (h % 3), evidence: EVIDENCE[state] ?? null };
}

function buildCells(subjects: KnowledgeSubject[], repos: KnowledgeRepo[]): KnowledgeCell[] {
  const cells: KnowledgeCell[] = [];
  for (const r of repos) {
    for (const s of subjects) {
      const h = hash(`${s.slug}|${r.fullName}`);
      const present = r.hasMap && r.domains.includes(s.bundle) && absence(s, r) === "candidate" && h % 100 < 58;
      cells.push(present ? verdict(s, r, h) : { subject: s.slug, repositoryId: r.repositoryId, state: absence(s, r), stale: false, contexts: 0, evidence: null });
    }
  }
  return cells;
}

/** Fill each repo's pair / judged / deviation counts from its own cells, so the two never disagree. */
function countRepos(repos: KnowledgeRepo[], cells: KnowledgeCell[]): KnowledgeRepo[] {
  return repos.map((r) => {
    const mine = cells.filter((c) => c.repositoryId === r.repositoryId && c.contexts > 0);
    const pairs = mine.reduce((n, c) => n + c.contexts, 0);
    const judged = mine.filter((c) => c.state !== "unknown").reduce((n, c) => n + c.contexts, 0);
    const deviations = mine.filter((c) => c.state === "deviation").length;
    return { ...r, pairs, judged, deviations };
  });
}

const SIGNALS: SignalSummary[] = [
  { bundle: "software-engineering", subjectSlug: "agent-memory", contributors: 2, consults: 14, deviations: 9, citResolved: 6, citMoved: 1, citGone: 0 },
  { bundle: "software-engineering", subjectSlug: "quality-gates", contributors: 2, consults: 11, deviations: 3, citResolved: null, citMoved: null, citGone: null },
  { bundle: "software-engineering", subjectSlug: "plan-entitlements", contributors: 1, consults: 4, deviations: 6, citResolved: 2, citMoved: 0, citGone: 1 },
  { bundle: "software-engineering", subjectSlug: "cost-metering", contributors: 1, consults: 3, deviations: null, citResolved: null, citMoved: null, citGone: null },
];

const DISPATCHES: RegistryDispatchRow[] = [
  {
    id: "d-2", repositoryId: "r-mobile", repoFullName: "acme/mobile", stage: "map", mode: "local", status: "proposed",
    subjects: [], briefDigest: "sha256:5b1e…", actor: "kazda", branch: "ascent/registry-20260905-mobile",
    prUrl: "https://github.com/acme/mobile/pull/418", mapShaBefore: null, mapShaAfter: null, model: "sonnet",
    costMicros: 412_000, turns: 9, agentDurationMs: 184_000, summary: "Built .ai/registry-map.json for 27 contexts (92 pairs, 3 weakly governed).",
    error: null, createdAt: "2026-09-05T05:58:00.000Z", startedAt: "2026-09-05T05:58:04.000Z", endedAt: "2026-09-05T06:01:08.000Z",
  },
  {
    id: "d-1", repositoryId: "r-api", repoFullName: "acme/api", stage: "conform", mode: "brief", status: "handed_off",
    subjects: ["rate-limiting", "webhook-ingestion", "audit-logging", "authorization"], briefDigest: "sha256:c07a…", actor: "kazda",
    branch: null, prUrl: null, mapShaBefore: "9f3c1a2", mapShaAfter: null, model: null, costMicros: null, turns: null, agentDurationMs: null,
    summary: null, error: null, createdAt: "2026-09-04T16:20:00.000Z", startedAt: null, endedAt: null,
  },
];

export const KNOWLEDGE_DEMO_STATES = ["fleet"] as const;

/** The shaped view: one registry, two bundles (one mirrored down to subjects, one counts-only), eight repos. */
export function fixtureKnowledgeView(slug: string): KnowledgeView {
  const cells = buildCells(SE_SUBJECTS, REPOS);
  const repos = countRepos(REPOS, cells);
  return {
    status: "indexed",
    registry: { fullName: `${slug}/ai-registry`, url: `https://github.com/${slug}/ai-registry`, lastIndexedAt: "2026-09-05T06:38:00.000Z" },
    domains: [
      {
        name: "software-engineering", title: "Software engineering", subjects: 214, techniques: 1586, applications: 931, laws: 15,
        categories: SE_TAXONOMY.map((c) => c.id), useWhenCoverage: { written: 1586, total: 1586 }, taxonomy: SE_TAXONOMY,
      },
      {
        name: "llm-observability", title: "Llm observability", subjects: 17, techniques: 110, applications: 60, laws: 9,
        categories: ["tracing", "evaluation", "cost", "guardrails"], useWhenCoverage: { written: 110, total: 110 }, taxonomy: [],
      },
    ],
    totals: { domains: 2, subjects: 231, techniques: 1696, applications: 991 },
    subjects: SE_SUBJECTS,
    repos,
    cells,
    signals: SIGNALS,
    dispatches: DISPATCHES,
    sweep: { lastAt: SWEPT_AT, warnings: ["acme/legacy-monolith: .ai/registry-map.json is 612KB, over the 512KB read cap — previous rows kept"], truncated: false },
    capabilities: { canSweep: true, canBrief: true, canRunLocal: true },
  };
}
