// OTLP/JSON → per-session ATTEMPT rows (W3a). The session-scoped sibling of otlp.ts's day-bucket
// mapping, folded out of the SAME export in one pass by the caller.
//
// WHY A SECOND SHAPE OVER THE SAME BYTES. `AiUsageRecord` answers "what did this repo's AI cost on
// this day". It structurally cannot answer "what does a unit of work cost", because a day bucket has
// no notion of an attempt — which is the metric Port's AI-SDLC research says orgs get wrong by
// measuring adoption instead of outcomes. Claude Code's exporter already carries a `session.id`
// resource attribute on every datapoint; this reads it.
//
// WHAT IS AND IS NOT A FACT HERE:
//   FACT      — tokens, cost, commits, pull requests and lines, per session, as the agent reported.
//   NOT A FACT — which pull request a session produced. The telemetry carries no PR number, so any
//                session→AiChange link would be a repo+time-window guess. We do not make it. The
//                join to merged changes happens at repo × period level (agent-sessions.ts), where
//                both sides are counted.
//   NOT A FACT — that a session with no commit "failed". It is very often a question, a code read or
//                a debugging pass. Nothing here names an outcome; the counts are stored and the
//                derived reads say "produced code" / "did not", which is all the data supports.

import { repoFromGitAttr } from "@/lib/integrations/otlp";

/** One attempt, folded across however many exports carried its datapoints. */
export interface AgentSessionInput {
  source: string;
  sessionId: string;
  repoFullName: string;
  userKey: string | null;
  startedAt: Date;
  lastSeenAt: Date;
  tokens: number;
  costCents: number;
  commits: number;
  pullRequests: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * The session-scoped metrics. Deliberately a SUPERSET of otlp.ts's KNOWN_METRICS: the day-bucket
 * mapping only needs tokens/cost/sessions, while an attempt is characterized by what it PRODUCED,
 * so commits / PRs / lines matter here and are ignored there.
 */
const SESSION_METRICS = new Set([
  "claude_code.token.usage",
  "claude_code.cost.usage",
  "claude_code.commit.count",
  "claude_code.pull_request.count",
  "claude_code.lines_of_code.count",
]);

interface OtlpValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface OtlpAttr {
  key?: string;
  value?: OtlpValue;
}
interface OtlpDataPoint {
  asInt?: string | number;
  asDouble?: number;
  timeUnixNano?: string | number;
  attributes?: OtlpAttr[];
}
interface OtlpMetric {
  name?: string;
  sum?: { dataPoints?: OtlpDataPoint[] };
  gauge?: { dataPoints?: OtlpDataPoint[] };
}
interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpAttr[] };
  scopeMetrics?: { metrics?: OtlpMetric[] }[];
}
export interface SessionsBody {
  resourceMetrics?: OtlpResourceMetrics[];
}

function attrMap(attrs: OtlpAttr[] | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of attrs ?? []) {
    if (!a?.key || !a.value) continue;
    const v = a.value;
    if (typeof v.stringValue === "string") m[a.key] = v.stringValue;
    else if (v.intValue != null) m[a.key] = String(v.intValue);
    else if (v.doubleValue != null) m[a.key] = String(v.doubleValue);
    else if (v.boolValue != null) m[a.key] = String(v.boolValue);
  }
  return m;
}

function dpValue(dp: OtlpDataPoint): number {
  if (dp.asInt != null) {
    const n = Number(dp.asInt);
    return Number.isFinite(n) ? n : 0;
  }
  if (dp.asDouble != null) return Number.isFinite(dp.asDouble) ? dp.asDouble : 0;
  return 0;
}

function dpMs(dp: OtlpDataPoint, fallbackMs: number): number {
  const nano = dp.timeUnixNano != null ? Number(dp.timeUnixNano) : NaN;
  return Number.isFinite(nano) && nano > 0 ? Math.floor(nano / 1e6) : fallbackMs;
}

interface Acc extends Omit<AgentSessionInput, "startedAt" | "lastSeenAt"> {
  firstMs: number;
  lastMs: number;
}

/**
 * Fold an OTLP export into per-session attempts.
 *
 * A resource with no `session.id` yields NOTHING here — deliberately, and without an error: the
 * day-bucket path (parseOtlpMetrics) still stores its usage, so an older exporter that predates the
 * attribute keeps working exactly as before and simply contributes no attempt rows. Silently
 * inventing one session per export would corrupt cost-per-attempt far worse than having none.
 */
export function parseOtlpSessions(body: SessionsBody, fallbackMs: number): AgentSessionInput[] {
  const acc = new Map<string, Acc>();

  for (const rm of body.resourceMetrics ?? []) {
    const res = attrMap(rm.resource?.attributes);
    const sessionId = (res["session.id"] ?? "").trim();
    if (!sessionId) continue;
    const repo = repoFromGitAttr(res["git.repository"]);
    // No resolvable GitHub repo ⇒ no row to attribute the attempt to. otlp.ts already counts and
    // reports this case (unsupported-host / no-repo-attr); duplicating the reporting here would
    // double-count the same skipped datapoints in the ingest response.
    if (!repo) continue;
    const userKey = (res["user.email"] ?? res["user.id"] ?? "").trim() || null;
    const key = `${sessionId}`;

    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        if (!SESSION_METRICS.has(metric.name ?? "")) continue;
        for (const dp of metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? []) {
          const ms = dpMs(dp, fallbackMs);
          const e =
            acc.get(key) ??
            ({
              source: "claude-code",
              sessionId,
              repoFullName: repo.toLowerCase(),
              userKey,
              tokens: 0,
              costCents: 0,
              commits: 0,
              pullRequests: 0,
              linesAdded: 0,
              linesRemoved: 0,
              firstMs: ms,
              lastMs: ms,
            } satisfies Acc);
          e.firstMs = Math.min(e.firstMs, ms);
          e.lastMs = Math.max(e.lastMs, ms);
          const v = dpValue(dp);
          switch (metric.name) {
            case "claude_code.token.usage":
              e.tokens += v;
              break;
            case "claude_code.cost.usage":
              e.costCents += v * 100;
              break;
            case "claude_code.commit.count":
              e.commits += v;
              break;
            case "claude_code.pull_request.count":
              e.pullRequests += v;
              break;
            case "claude_code.lines_of_code.count": {
              // The exporter splits added/removed with a datapoint `type` attribute. An unlabeled
              // datapoint counts as ADDED rather than being dropped — under-counting removals is a
              // smaller distortion than discarding a real measurement.
              const t = attrMap(dp.attributes)["type"];
              if (t === "removed") e.linesRemoved += v;
              else e.linesAdded += v;
              break;
            }
          }
          acc.set(key, e);
        }
      }
    }
  }

  return [...acc.values()].map((e) => ({
    source: e.source,
    sessionId: e.sessionId,
    repoFullName: e.repoFullName,
    userKey: e.userKey,
    startedAt: new Date(e.firstMs),
    lastSeenAt: new Date(e.lastMs),
    tokens: Math.round(e.tokens),
    costCents: Math.round(e.costCents),
    commits: Math.round(e.commits),
    pullRequests: Math.round(e.pullRequests),
    linesAdded: Math.round(e.linesAdded),
    linesRemoved: Math.round(e.linesRemoved),
  }));
}
