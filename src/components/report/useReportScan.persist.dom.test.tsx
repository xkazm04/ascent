// @vitest-environment jsdom
//
// The live-scan address bar rewrites to `/report/{owner}/{repo}` only when THIS scan is durable.
// These pin the two signals useReportScan exposes as `persisted`: a DB peek/salvage, and the SSE
// `persisted` frame emitted before `result`. An in-memory cache hit is not durable (DB may be off).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";

function validReport(owner = "acme", name = "app"): Record<string, unknown> {
  return {
    repo: { owner, name, url: `https://github.com/${owner}/${name}`, stars: 42 },
    level: { id: "L3", name: "Practicing", description: "desc" },
    posture: { label: "AI-native", blurb: "blurb" },
    engine: { provider: "anthropic", model: "claude" },
    aiUsage: { detected: true, commitFraction: 0.3 },
    overallScore: 71,
    adoptionScore: 60,
    rigorScore: 80,
    confidence: 0.9,
    headline: "A solid repo",
    archetype: "product",
    scannedAt: "2026-06-18T00:00:00.000Z",
    strengths: ["s1"],
    risks: ["r1"],
    dimensions: [
      {
        id: "D1",
        name: "Dim One",
        score: 70,
        signalScore: 65,
        llmScore: 75,
        weight: 0.2,
        summary: "ok",
        evidence: ["e1"],
        strengths: ["ds1"],
        gaps: ["g1"],
      },
    ],
    contributors: [{ login: "alice", commits: 10, aiCommits: 3 }],
    roadmap: [{ title: "Do X", dimension: "D1", impact: "high", effort: "low" }],
    discrepancies: [],
  };
}

function peekReply(headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    body: null,
    headers: new Headers(headers),
    json: async () => validReport(),
  } as unknown as Response;
}

function sseReply(frames: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(frames.join("")));
      c.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
    headers: new Headers(),
    json: async () => null,
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("useReportScan — persisted (durable store)", () => {
  it("a hit-db peek is durable", async () => {
    vi.mocked(fetch).mockResolvedValue(peekReply({ "x-ascent-cache": "hit-db" }));
    const { result } = renderHook(() => useReportScan("acme/app", false));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.persisted).toBe(true);
  });

  it("an in-memory cache peek is not durable", async () => {
    vi.mocked(fetch).mockResolvedValue(peekReply({ "x-ascent-cache": "hit" }));
    const { result } = renderHook(() => useReportScan("acme/app", false));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.persisted).toBe(false);
  });

  it("SSE persisted ok:true before result marks the live scan durable", async () => {
    const report = validReport();
    vi.mocked(fetch).mockResolvedValue(
      sseReply([
        `event: persisted\ndata: ${JSON.stringify({ ok: true })}\n\n`,
        `event: result\ndata: ${JSON.stringify(report)}\n\n`,
      ]),
    );
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.persisted).toBe(true);
  });

  it("SSE result without a persisted-ok frame stays not durable", async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseReply([`event: result\ndata: ${JSON.stringify(validReport())}\n\n`]),
    );
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.persisted).toBe(false);
  });
});
