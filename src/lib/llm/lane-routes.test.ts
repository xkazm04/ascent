// Where every LLM lane runs for one org, as a pure projection (routeLanes) plus the server loader that
// gathers its facts. The acceptance cases of llm-provider-abstraction#B (challenge-2026-09-23): the
// five lanes on the platform, the three that move to an active BYOM and the two that do not, the
// fail-closed lanes on an unresolvable BYOM, the no-engine floors, the briefing switch, and the
// "if switched on" preview for a saved-but-not-enabled provider. The loader guards: no secret leaves
// it, and it never calls a model.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockResolveState } = vi.hoisted(() => ({ mockResolveState: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomState: mockResolveState }));

import { LANE_IDS, previewByom, routeLanes, type LaneFacts, type LaneRow } from "@/lib/llm/lane-routes";
import { loadLaneRouting } from "@/lib/llm/lane-routes-load";
import { resolveLaneSummaryRunner } from "@/lib/local/lane-summary";
import type { OrgLlmConfigPublic } from "@/lib/db/org-llm";

const GEMINI = { engine: "gemini", model: "gemini-3.8-flash" } as const;
const PLATFORM = { scan: GEMINI, text: GEMINI };
const OPENROUTER = { state: "active", kind: "openrouter", model: "anthropic/claude-sonnet-4" } as const;
const byLane = (rows: LaneRow[]) => Object.fromEntries(rows.map((r) => [r.lane, r])) as Record<LaneRow["lane"], LaneRow>;
const facts = (over: Partial<LaneFacts>): LaneFacts => ({ byom: { state: "inactive" }, platform: PLATFORM, briefingEnabled: true, ...over });

function savedConfig(over: Partial<OrgLlmConfigPublic> = {}): OrgLlmConfigPublic {
  return {
    provider: "openrouter", enabled: false, modelId: "anthropic/claude-sonnet-4", region: null, authMode: "static",
    hasCredentials: true, lastValidatedAt: null, lastValidationError: null, createdBy: null, updatedAt: "2026-09-23T00:00:00.000Z",
    ...over,
  };
}

describe("routeLanes", () => {
  it("no BYOM: 5 rows (scans, athena, briefing, memory, lane summary), every one on the platform's gemini", () => {
    const rows = routeLanes(facts({}));
    expect(rows.map((r) => r.lane)).toEqual(["scans", "athena", "briefing", "memory", "laneSummary"]);
    expect(rows.map((r) => r.lane)).toEqual([...LANE_IDS]);
    for (const r of rows) {
      expect(r).toMatchObject({ engine: "gemini", model: "gemini-3.8-flash", account: "platform", state: "runs", bypassesByom: false });
    }
  });

  it("active OpenRouter BYOM: scans, athena and briefing move to yours; memory and lane summary stay on the platform, flagged", () => {
    const r = byLane(routeLanes(facts({ byom: OPENROUTER })));
    for (const lane of ["scans", "athena", "briefing"] as const) {
      expect(r[lane]).toMatchObject({ engine: "openrouter", model: "anthropic/claude-sonnet-4", account: "yours", state: "runs", bypassesByom: false });
    }
    for (const lane of ["memory", "laneSummary"] as const) {
      expect(r[lane]).toMatchObject({ engine: "gemini", account: "platform", state: "runs", bypassesByom: true });
    }
  });

  it("unresolvable BYOM: scans and athena blocked (no platform fallback), briefing on the template, memory and lane summary unchanged", () => {
    const r = byLane(routeLanes(facts({ byom: { state: "unresolvable" } })));
    expect(r.scans).toMatchObject({ state: "blocked", engine: null, model: null, account: "none" });
    expect(r.athena).toMatchObject({ state: "blocked", engine: null, account: "none" });
    expect(r.briefing).toMatchObject({ state: "template", engine: null, account: "none" });
    expect(r.memory).toMatchObject({ state: "runs", engine: "gemini", account: "platform", bypassesByom: true });
    expect(r.laneSummary).toMatchObject({ state: "runs", engine: "gemini", account: "platform", bypassesByom: true });
  });

  it("no platform text engine (LLM_PROVIDER=mock): text lanes have no engine, scans run the deterministic mock", () => {
    const r = byLane(routeLanes(facts({ platform: { scan: { engine: "mock", model: "deterministic-rubric" }, text: null } })));
    expect(r.memory).toMatchObject({ state: "no-engine", engine: null, account: "none" });
    expect(r.laneSummary).toMatchObject({ state: "no-engine", engine: null, account: "none" });
    expect(r.athena).toMatchObject({ state: "no-engine", engine: null });
    expect(r.scans).toMatchObject({ state: "runs", engine: "mock", account: "none" });
  });

  it("briefing switched off: the briefing row is off, never an engine, even with a BYOM active", () => {
    for (const byom of [{ state: "inactive" } as const, OPENROUTER]) {
      const r = byLane(routeLanes(facts({ byom, briefingEnabled: false })));
      expect(r.briefing).toMatchObject({ state: "off", engine: null, model: null, account: "none" });
    }
  });
});

describe("previewByom", () => {
  it("a saved-but-not-enabled provider previews as an active BYOM on the saved model", () => {
    expect(previewByom(savedConfig())).toEqual({ state: "active", kind: "openrouter", model: "anthropic/claude-sonnet-4", region: null });
    expect(previewByom(savedConfig({ provider: "bedrock", modelId: "us.anthropic.x", region: "eu-west-1" }))).toMatchObject({ kind: "bedrock", region: "eu-west-1" });
  });

  it("no preview without a saved config, without credentials, or when it is already on", () => {
    expect(previewByom(null)).toBeNull();
    expect(previewByom(savedConfig({ hasCredentials: false }))).toBeNull();
    expect(previewByom(savedConfig({ enabled: true }))).toBeNull();
  });
});

describe("loadLaneRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-test");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    vi.stubEnv("BRIEFING_NARRATIVE", "1");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no model call while loading the card"); }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the real platform engines and the org's BYOM, and adds the preview only for a saved-but-off config", async () => {
    mockResolveState.mockResolvedValue({ state: "inactive" });
    const off = await loadLaneRouting("acme", savedConfig());
    expect(byLane(off!.current).memory).toMatchObject({ engine: "openai", model: "gpt-test", account: "platform" });
    expect(byLane(off!.preview!).scans).toMatchObject({ engine: "openrouter", account: "yours" });
    expect((await loadLaneRouting("acme", null))!.preview).toBeNull();
    expect(mockResolveState).toHaveBeenCalledWith("acme");
  });

  it("guard: no secret crosses to the client (the projection is state, kind, model, region)", async () => {
    mockResolveState.mockResolvedValue({ state: "active", params: { kind: "openrouter", model: "m/x", apiKey: "sk-or-SECRET" } });
    const or = JSON.stringify(await loadLaneRouting("acme", null));
    expect(or).toContain("m/x");
    expect(or).not.toContain("sk-or-SECRET");
    mockResolveState.mockResolvedValue({
      state: "active",
      params: { kind: "bedrock", model: "us.b", region: "eu-west-1", credentials: { accessKeyId: "AKIA-ID", secretAccessKey: "AWS-SECRET" } },
    });
    const bedrock = JSON.stringify(await loadLaneRouting("acme", null));
    expect(bedrock).not.toContain("AWS-SECRET");
    expect(bedrock).not.toContain("AKIA-ID");
  });

  it("guard: loading makes no network call to any model (construction only)", async () => {
    mockResolveState.mockResolvedValue({ state: "active", params: { kind: "openrouter", model: "m/x", apiKey: "k" } });
    await loadLaneRouting("acme", savedConfig());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("\"couldn't tell\" is not \"no BYOM\": an unreadable BYOM state yields no routing rather than a platform guess", async () => {
    mockResolveState.mockRejectedValue(new Error("db down"));
    expect(await loadLaneRouting("acme", null)).toBeNull();
  });
});

describe("guard: resolveLaneSummaryRunner keeps its TextRunner | null contract (loop-lane.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a function when a platform engine resolves, null under mock", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-test");
    expect(typeof (await resolveLaneSummaryRunner("acme"))).toBe("function");
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect(await resolveLaneSummaryRunner("acme")).toBeNull();
  });
});
