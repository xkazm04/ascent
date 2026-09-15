// OTLP/JSON metrics → AiUsageRecord mapping for the Claude Code telemetry push path. Claude Code's
// OpenTelemetry exporter POSTs an ExportMetricsServiceRequest to <endpoint>/v1/metrics; the
// `git.repository` resource attribute (set via OTEL_RESOURCE_ATTRIBUTES in the connect snippet) carries
// the repository — which is what makes the attribution MEASURED. We fold the claude_code.* counters
// into one measured record per (repo, UTC day). Pure + testable: day bucketing uses each datapoint's
// timeUnixNano, falling back to a caller-supplied `fallbackMs`.

import type { UsageRecordInput } from "@/lib/db";
import { forgeFullName, parseForgeUrl } from "@/lib/forge/registry";

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
export interface OtlpMetricsBody {
  resourceMetrics?: OtlpResourceMetrics[];
}

/** Flatten OTLP attribute list into a plain string map. */
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

/** Why a datapoint could not be turned into a usage record. Reported back to the caller so an
 *  integration that receives forty datapoints and stores zero never LOOKS like one that is working. */
export type SkipReason = "unknown-metric" | "no-repo-attr" | "unsupported-host";

/** Resolve the `git.repository` resource attribute to a repo, or say why it can't be. Ascent's repo
 *  identity is `owner/name` for GitHub and a forge-prefixed `gitlab:group/project` elsewhere
 *  (moonshot #4), so a GitLab remote now RESOLVES to the row a GitLab scan persists instead of being
 *  reported as unsupported. A remote on a forge Ascent still cannot read has no row to attach spend
 *  to, so it stays `unsupported-host` — named, never silently dropped. */
export function resolveGitRepo(raw: string | undefined): { repo: string } | { reason: SkipReason; host: string } {
  if (!raw || !raw.trim()) return { reason: "no-repo-attr", host: "" };
  const s = raw.trim().replace(/\.git$/i, "");
  const gh = s.match(/github\.com[:/]([^/\s]+\/[^/\s]+)$/i);
  if (gh) return { repo: gh[1]! };
  const bare = s.match(/^([\w.-]+\/[\w.-]+)$/);
  if (bare) return { repo: bare[1]! };
  // #4 — the ONE line this lane changes here. The router owns "is this a forge we read", so a remote
  // resolves through exactly the parser the scanner would use; the identity it produces is the same
  // `forgeFullName` the persist layer writes, which is what makes the join actually land on a row.
  const routed = parseForgeUrl(s);
  if (routed && routed.forge !== "github") return { repo: forgeFullName(routed.forge, routed.owner, routed.repo) };
  // Name the host so the report is actionable ("12 datapoints from gitlab.com") rather than a bare
  // count. Falls back to a truncated raw value when the attribute isn't remote-URL-shaped at all.
  const host = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\s/]+@)?([^\s/:]+)[:/]/i.exec(s)?.[1] ?? s.slice(0, 40);
  return { reason: "unsupported-host", host: host.toLowerCase() };
}

/** Extract "owner/name" from a git remote URL (https or ssh, with/without .git) or an already-normalized
 *  "owner/name". Null when neither shape matches. Thin wrapper over {@link resolveGitRepo}. */
export function repoFromGitAttr(raw: string | undefined): string | null {
  const r = resolveGitRepo(raw);
  return "repo" in r ? r.repo : null;
}

function dpValue(dp: OtlpDataPoint): number {
  if (dp.asInt != null) {
    const n = Number(dp.asInt);
    return Number.isFinite(n) ? n : 0;
  }
  if (dp.asDouble != null) return Number.isFinite(dp.asDouble) ? dp.asDouble : 0;
  return 0;
}

function dpDayMs(dp: OtlpDataPoint, fallbackMs: number): number {
  const nano = dp.timeUnixNano != null ? Number(dp.timeUnixNano) : NaN;
  const ms = Number.isFinite(nano) && nano > 0 ? Math.floor(nano / 1e6) : fallbackMs;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface Bucket {
  repo: string;
  day: number;
  tokens: number;
  costCents: number;
  sessions: number;
  users: Set<string>;
}

/** The metric names this mapping understands. Every other `claude_code.*` (and everything from any
 *  other instrumentation sharing the exporter) carries no value we can attribute — it is COUNTED and
 *  reported, deliberately not stored. */
const KNOWN_METRICS = new Set(["claude_code.token.usage", "claude_code.cost.usage", "claude_code.session.count"]);

export interface OtlpParseResult {
  /** The measured per-repo records to persist. */
  records: UsageRecordInput[];
  /** Total datapoints seen in the export, stored or not. */
  received: number;
  /** Datapoints whose value was NOT stored, by reason. */
  skipped: Record<SkipReason, number>;
  /** The distinct non-GitHub hosts seen, so "12 datapoints skipped" can name gitlab.com. Capped. */
  unsupportedHosts: string[];
}

const MAX_REPORTED_HOSTS = 5;

/**
 * Map an OTLP/JSON metrics export into measured per-repo Claude Code usage records, AND report what
 * was dropped on the way. Three independent paths drop data — a metric outside the allowlist, a
 * resource with no `git.repository`, and a remote on a host whose repo identity Ascent doesn't model
 * (GitLab / Bitbucket / self-hosted) — and all three used to vanish without a trace, which made a
 * connector storing nothing indistinguishable from one that was working.
 *
 * Note on `unknown-metric`: the datapoint's VALUE is what gets dropped. A resource that also carries
 * a known metric still produces its record exactly as before — the count says "this number never
 * landed anywhere", not "the whole export was discarded".
 */
export function parseOtlpMetrics(body: OtlpMetricsBody, fallbackMs: number): OtlpParseResult {
  const buckets = new Map<string, Bucket>();
  const skipped: Record<SkipReason, number> = { "unknown-metric": 0, "no-repo-attr": 0, "unsupported-host": 0 };
  const hosts = new Set<string>();
  let received = 0;

  /** Count every datapoint under a resource we're about to abandon, so `received` stays a true total. */
  const countAll = (rm: OtlpResourceMetrics, reason: SkipReason) => {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const n = (metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? []).length;
        received += n;
        skipped[reason] += n;
      }
    }
  };

  for (const rm of body.resourceMetrics ?? []) {
    const res = attrMap(rm.resource?.attributes);
    const resolved = resolveGitRepo(res["git.repository"]);
    if (!("repo" in resolved)) {
      countAll(rm, resolved.reason);
      if (resolved.reason === "unsupported-host" && resolved.host && hosts.size < MAX_REPORTED_HOSTS) hosts.add(resolved.host);
      continue;
    }
    const repo = resolved.repo;
    const user = res["user.email"] ?? res["user.id"] ?? "";

    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const dps = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
        const known = KNOWN_METRICS.has(metric.name ?? "");
        for (const dp of dps) {
          received++;
          if (!known) skipped["unknown-metric"]++;
          const day = dpDayMs(dp, fallbackMs);
          const key = `${repo} ${day}`;
          const b = buckets.get(key) ?? { repo, day, tokens: 0, costCents: 0, sessions: 0, users: new Set<string>() };
          if (user) b.users.add(user);
          const v = dpValue(dp);
          switch (metric.name) {
            case "claude_code.token.usage":
              b.tokens += v;
              break;
            case "claude_code.cost.usage":
              b.costCents += Math.round(v * 100);
              break;
            case "claude_code.session.count":
              b.sessions += v;
              break;
          }
          buckets.set(key, b);
        }
      }
    }
  }

  const records = [...buckets.values()].map((b) => ({
    source: "claude-code",
    scope: "repo" as const,
    scopeKey: b.repo,
    periodStart: new Date(b.day),
    tokens: Math.round(b.tokens),
    costCents: Math.round(b.costCents),
    sessions: Math.round(b.sessions),
    seats: b.users.size,
    fidelity: "measured" as const,
  }));

  return { records, received, skipped, unsupportedHosts: [...hosts] };
}
