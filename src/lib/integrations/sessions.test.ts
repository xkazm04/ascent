import { describe, expect, it } from "vitest";
import { parseOtlpSessions, type SessionsBody } from "./sessions";

const NOW = Date.parse("2026-08-14T12:00:00Z");
const nano = (iso: string) => String(Date.parse(iso) * 1e6);

const attr = (k: string, v: string) => ({ key: k, value: { stringValue: v } });

function body(o: {
  sessionId?: string;
  repo?: string;
  user?: string;
  metrics: { name: string; value: number; at?: string; type?: string }[];
}): SessionsBody {
  const resAttrs = [attr("git.repository", o.repo ?? "https://github.com/acme/web.git")];
  if (o.sessionId !== undefined) resAttrs.push(attr("session.id", o.sessionId));
  if (o.user) resAttrs.push(attr("user.email", o.user));
  return {
    resourceMetrics: [
      {
        resource: { attributes: resAttrs },
        scopeMetrics: [
          {
            metrics: o.metrics.map((m) => ({
              name: m.name,
              sum: {
                dataPoints: [
                  {
                    asDouble: m.value,
                    timeUnixNano: nano(m.at ?? "2026-08-14T10:00:00Z"),
                    ...(m.type ? { attributes: [attr("type", m.type)] } : {}),
                  },
                ],
              },
            })),
          },
        ],
      },
    ],
  };
}

describe("parseOtlpSessions", () => {
  it("folds an export into one attempt per session id", () => {
    const [s] = parseOtlpSessions(
      body({
        sessionId: "sess-1",
        user: "dev@acme.io",
        metrics: [
          { name: "claude_code.token.usage", value: 12000 },
          { name: "claude_code.cost.usage", value: 0.42 },
          { name: "claude_code.commit.count", value: 2 },
          { name: "claude_code.pull_request.count", value: 1 },
        ],
      }),
      NOW,
    );
    expect(s).toMatchObject({
      source: "claude-code",
      sessionId: "sess-1",
      repoFullName: "acme/web",
      userKey: "dev@acme.io",
      tokens: 12000,
      costCents: 42, // dollars → cents
      commits: 2,
      pullRequests: 1,
    });
  });

  // The whole point of the second shape: an attempt that produced nothing is still an attempt, and
  // it is what makes cost-per-unit-of-work differ from cost-per-token.
  it("records a session that produced no commit or PR", () => {
    const [s] = parseOtlpSessions(
      body({ sessionId: "sess-2", metrics: [{ name: "claude_code.cost.usage", value: 0.1 }] }),
      NOW,
    );
    expect(s).toMatchObject({ sessionId: "sess-2", commits: 0, pullRequests: 0, costCents: 10 });
  });

  // A missing session.id must produce NOTHING rather than a fabricated attempt — inventing one
  // session per export would corrupt cost-per-attempt far worse than having no attempts at all.
  it("yields nothing when the exporter sends no session.id", () => {
    expect(parseOtlpSessions(body({ metrics: [{ name: "claude_code.cost.usage", value: 1 }] }), NOW)).toEqual([]);
  });

  it("yields nothing for a repo it cannot resolve to a GitHub full name", () => {
    const b = body({ sessionId: "sess-3", repo: "https://gitlab.com/acme/web.git", metrics: [{ name: "claude_code.cost.usage", value: 1 }] });
    expect(parseOtlpSessions(b, NOW)).toEqual([]);
  });

  it("splits lines by the datapoint's type attribute", () => {
    const [s] = parseOtlpSessions(
      body({
        sessionId: "sess-4",
        metrics: [
          { name: "claude_code.lines_of_code.count", value: 120, type: "added" },
          { name: "claude_code.lines_of_code.count", value: 30, type: "removed" },
        ],
      }),
      NOW,
    );
    expect(s).toMatchObject({ linesAdded: 120, linesRemoved: 30 });
  });

  // Under-counting removals is a smaller distortion than discarding a real measurement.
  it("counts an unlabeled lines datapoint as added rather than dropping it", () => {
    const [s] = parseOtlpSessions(
      body({ sessionId: "sess-5", metrics: [{ name: "claude_code.lines_of_code.count", value: 40 }] }),
      NOW,
    );
    expect(s).toMatchObject({ linesAdded: 40, linesRemoved: 0 });
  });

  it("keeps the earliest and latest timestamps across a session's datapoints", () => {
    const [s] = parseOtlpSessions(
      body({
        sessionId: "sess-6",
        metrics: [
          { name: "claude_code.token.usage", value: 1, at: "2026-08-14T09:00:00Z" },
          { name: "claude_code.commit.count", value: 1, at: "2026-08-14T11:30:00Z" },
        ],
      }),
      NOW,
    );
    expect(s!.startedAt.toISOString()).toBe("2026-08-14T09:00:00.000Z");
    expect(s!.lastSeenAt.toISOString()).toBe("2026-08-14T11:30:00.000Z");
  });

  it("lower-cases the repo so it folds with AiUsageRecord's scopeKey", () => {
    const b = body({ sessionId: "s", repo: "https://github.com/Acme/Web", metrics: [{ name: "claude_code.cost.usage", value: 1 }] });
    expect(parseOtlpSessions(b, NOW)[0]!.repoFullName).toBe("acme/web");
  });

  it("ignores metrics outside the session set", () => {
    const b = body({ sessionId: "s", metrics: [{ name: "some.other.metric", value: 999 }] });
    expect(parseOtlpSessions(b, NOW)).toEqual([]);
  });

  it("is empty-safe", () => {
    expect(parseOtlpSessions({}, NOW)).toEqual([]);
    expect(parseOtlpSessions({ resourceMetrics: [] }, NOW)).toEqual([]);
  });

  it("falls back to the caller's timestamp when a datapoint carries none", () => {
    const b: SessionsBody = {
      resourceMetrics: [
        {
          resource: { attributes: [attr("git.repository", "acme/web"), attr("session.id", "s")] },
          scopeMetrics: [{ metrics: [{ name: "claude_code.cost.usage", sum: { dataPoints: [{ asDouble: 1 }] } }] }],
        },
      ],
    };
    expect(parseOtlpSessions(b, NOW)[0]!.startedAt.getTime()).toBe(NOW);
  });
});
