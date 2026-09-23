// The provider registry is the ONE table every provider-selection question reads: which names are
// valid, which provider is usable here, what `auto` picks, what a scan constructs, what the text seam
// binds, and what an org's BYOM record maps to. These tests pin that the scan seam and the text seam
// can no longer disagree — the drift that left `nebius` (and before it `local`) resolvable for scans
// and "no engine" for every non-scan surface.
//
// Guard cases are labelled `guard:` — they pin behaviour that already held and must survive the move.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderName } from "@/lib/types";

const { mockResolveState } = vi.hoisted(() => ({ mockResolveState: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomState: mockResolveState }));

import { REGISTRY, autoProviderName, byomDescriptor } from "@/lib/llm/registry";
import { getProvider, getProviderForOrg, providerByName, resolveProviderChoice } from "@/lib/llm";
import { resolveLegRunner, resolveTextRunner } from "@/lib/llm/text";
import { resolveLegRunnerForOrg } from "@/lib/llm/text-org";

const MEMORY = { legKind: "memory" } as const;
const KEYS = Object.keys(REGISTRY) as ProviderName[];

// Every env var a descriptor reads, blanked per test so the host's real config cannot leak in.
const ENV_VARS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "BEDROCK_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "LOCAL_LLM_BASE_URL",
  "LOCAL_LLM_MODEL",
  "NEBIUS_API_KEY",
  "NEBIUS_MODEL",
  "VERCEL",
] as const;

/**
 * The minimum env that makes each provider AVAILABLE. Total over ProviderName on purpose: an 11th
 * union member with no fixture fails `tsc` here, exactly as one with no descriptor fails it in the
 * registry, so the parity contract below cannot silently skip a new provider.
 */
const FIXTURE_ENV: Record<ProviderName, Record<string, string>> = {
  gemini: { GEMINI_API_KEY: "k" },
  bedrock: { BEDROCK_REGION: "eu-central-1" },
  openai: { OPENAI_API_KEY: "k" },
  openrouter: { OPENROUTER_API_KEY: "k" },
  local: { LOCAL_LLM_BASE_URL: "http://localhost:11434/v1", LOCAL_LLM_MODEL: "qwen2.5-coder:14b" },
  nebius: { NEBIUS_API_KEY: "k", NEBIUS_MODEL: "zai-org/GLM-5.3-Flash" },
  mock: {},
  "claude-cli": { NODE_ENV: "development" },
  "codex-cli": { NODE_ENV: "development" },
  gateway: {},
};

/** The only providers that DECLARE no text seam — each with a reason in its descriptor. */
const DECLARED_NONE: ProviderName[] = ["codex-cli", "gateway", "mock"];

function applyEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => {
  for (const k of ENV_VARS) vi.stubEnv(k, "");
  mockResolveState.mockReset();
  mockResolveState.mockResolvedValue({ state: "inactive" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parity contract — every registry key resolves the same provider on both seams", () => {
  for (const key of KEYS) {
    it(`${key}: getProvider, providerByName and the text seam agree`, async () => {
      applyEnv({ ...FIXTURE_ENV[key], LLM_PROVIDER: key });
      expect(getProvider().name).toBe(key);
      // mock is excepted by contract: providerByName means "a REAL fallback", and mock is none.
      if (key === "mock") expect(providerByName(key)).toBeNull();
      else expect(providerByName(key)?.name).toBe(key);

      const leg = await resolveLegRunner(MEMORY);
      const seam = REGISTRY[key].textSeam;
      if ("none" in seam) {
        expect(leg).toBeNull();
        expect(seam.none.length).toBeGreaterThan(0);
      } else {
        expect(leg?.engine).toBe(key);
      }
    });
  }

  it("mock, codex-cli and gateway are the ONLY keys that declare no text seam", () => {
    const none = KEYS.filter((k) => "none" in REGISTRY[k].textSeam).sort();
    expect(none).toEqual([...DECLARED_NONE].sort());
  });
});

describe("resolveProviderChoice — the accepted list is derived from the registry", () => {
  it("accepts every registry key and `auto`", () => {
    for (const key of ["auto", ...KEYS]) {
      vi.stubEnv("LLM_PROVIDER", key);
      expect(resolveProviderChoice()).toBe(key);
    }
  });

  it("still throws on a typo, naming exactly ['auto', ...registry keys]", () => {
    vi.stubEnv("LLM_PROVIDER", "bedrok");
    let message = "";
    try {
      resolveProviderChoice();
    } catch (e) {
      message = (e as Error).message;
    }
    const listed = /expected one of ([^.]+)\./.exec(message)?.[1]?.split(", ");
    expect(listed).toEqual(["auto", ...KEYS]);
  });
});

describe("autoProviderName — the auto ladder, once", () => {
  it("gemini with a key, else local with BOTH knobs, else mock", () => {
    applyEnv(FIXTURE_ENV.local);
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(autoProviderName()).toBe("gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(autoProviderName()).toBe("local");
    vi.stubEnv("LOCAL_LLM_MODEL", "");
    expect(autoProviderName()).toBe("mock");
  });

  it("the GOOGLE_API_KEY alias counts as a Gemini key", () => {
    vi.stubEnv("GOOGLE_API_KEY", "k");
    expect(autoProviderName()).toBe("gemini");
  });

  it("never picks an explicit-only provider, even when it is available here", () => {
    applyEnv({ OPENAI_API_KEY: "k", BEDROCK_REGION: "us-east-1", NODE_ENV: "development", ...FIXTURE_ENV.nebius });
    expect(autoProviderName()).toBe("mock");
  });
});

describe("BYOM — one byomDescriptor mapping serves both seams", () => {
  const OPENROUTER = { kind: "openrouter", model: "m", apiKey: "k" } as const;

  it("an active openrouter config reports openrouter/m on the scan seam AND the text seam", async () => {
    mockResolveState.mockResolvedValue({ state: "active", params: OPENROUTER });
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(true);
    expect([provider.name, provider.model]).toEqual(["openrouter", "m"]);

    const leg = await resolveLegRunnerForOrg("acme", MEMORY);
    expect([leg?.engine, leg?.model]).toEqual(["openrouter", "m"]);
  });

  it("byomDescriptor is that mapping: name, model and the scan provider come from one place", () => {
    const d = byomDescriptor(OPENROUTER);
    expect([d.name, d.model, d.scan().name]).toEqual(["openrouter", "m", "openrouter"]);
    const b = byomDescriptor({
      kind: "bedrock",
      model: "eu.anthropic.claude-sonnet-4-6",
      region: "eu-west-1",
      credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
    });
    expect([b.name, b.model, b.scan().name]).toEqual(["bedrock", "eu.anthropic.claude-sonnet-4-6", "bedrock"]);
  });

  it("guard: active-but-unresolvable throws the fail-closed error on BOTH seams", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k"); // a platform engine IS available — it must still not be used
    mockResolveState.mockResolvedValue({ state: "unresolvable" });
    await expect(getProviderForOrg("acme")).rejects.toThrow(/BYOM is enabled/);
    await expect(resolveLegRunnerForOrg("acme", MEMORY)).rejects.toThrow(/BYOM is enabled/);
  });

  it("guard: a resolveByomState rejection propagates on BOTH seams", async () => {
    mockResolveState.mockRejectedValue(new Error("connection terminated"));
    await expect(getProviderForOrg("acme")).rejects.toThrow(/connection terminated/);
    await expect(resolveLegRunnerForOrg("acme", MEMORY)).rejects.toThrow(/connection terminated/);
  });
});

describe("guards — behaviour that held before the registry and must still hold", () => {
  it("guard: LLM_PROVIDER=mock -> no text engine, MockProvider for scans", async () => {
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect(await resolveTextRunner(MEMORY)).toBeNull();
    expect(getProvider().name).toBe("mock");
  });

  it("guard: claude-cli on a managed production host -> no text engine and no failover", async () => {
    applyEnv({ NODE_ENV: "production", ASCENT_SELF_HOSTED: "0", LLM_PROVIDER: "claude-cli" });
    expect(await resolveTextRunner(MEMORY)).toBeNull();
    expect(providerByName("claude-cli")).toBeNull();
  });

  it("guard: codex-cli and gateway stay declared-none on the text seam", async () => {
    applyEnv({ NODE_ENV: "development", LLM_PROVIDER: "codex-cli" });
    expect(await resolveTextRunner(MEMORY)).toBeNull();
    vi.stubEnv("LLM_PROVIDER", "gateway");
    expect(await resolveTextRunner(MEMORY)).toBeNull();
  });

  it("guard: LLM_PROVIDER=bedrock with no AWS env -> real BedrockProvider, but no failover", () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    expect(getProvider().name).toBe("bedrock");
    expect(providerByName("bedrock")).toBeNull();
  });

  it("guard: LLM_PROVIDER=gemini keyless -> a keyless GeminiProvider (fails loud at assess)", () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    expect(getProvider().name).toBe("gemini");
  });
});

// ── Source guard: the claude-cli text leg must stay prunable from the production trace ─────────
//
// The production build inlines NODE_ENV and folds `process.env.NODE_ENV !== "production"` to false,
// which prunes the block — dynamic import included — and drops claude-cli.ts (child_process.spawn)
// from the Node File Trace. A guard `throw` followed by the import does not fold the same way. So the
// shape is load-bearing, and this checks the CODE, not prose: comments are stripped before matching.
// String literals are NOT stripped, because the two literals ("production" and the module path) are
// the subject of the check; the regex requires them in code position, so prose cannot satisfy it.

const GUARDED_IMPORT =
  /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*"production"\s*\)\s*\{\s*const\s*\{\s*runClaudePrompt\s*\}\s*=\s*await\s+import\(\s*"@\/lib\/llm\/claude-cli"\s*\)/g;
const ANY_IMPORT = /runClaudePrompt\s*\}\s*=\s*await\s+import\(/g;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** True when the text leg's claude-cli import exists and EVERY occurrence sits inside the literal guard. */
function claudeImportIsPrunable(src: string): boolean {
  const code = stripComments(src);
  const guarded = code.match(GUARDED_IMPORT)?.length ?? 0;
  const all = code.match(ANY_IMPORT)?.length ?? 0;
  return guarded > 0 && guarded === all;
}

describe("guard: the claude-cli text leg keeps its literal NODE_ENV block", () => {
  it("registry.ts imports runClaudePrompt only inside `if (process.env.NODE_ENV !== \"production\")`", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/llm/registry.ts"), "utf8");
    expect(claudeImportIsPrunable(src)).toBe(true);
  });

  it("seeded violations fail the check (a matcher that stops matching must not read as clean)", () => {
    const guarded =
      'if (process.env.NODE_ENV !== "production") {\n  const { runClaudePrompt } = await import("@/lib/llm/claude-cli");\n}';
    expect(claudeImportIsPrunable(guarded)).toBe(true);
    // Only PROSE describes the guard: the comment is stripped, nothing is left to match.
    expect(claudeImportIsPrunable(guarded.split("\n").map((l) => `// ${l}`).join("\n"))).toBe(false);
    // The guard-then-throw shape the production trace cannot prune.
    const thrown =
      'if (process.env.NODE_ENV === "production") throw new Error("no");\nconst { runClaudePrompt } = await import("@/lib/llm/claude-cli");';
    expect(claudeImportIsPrunable(thrown)).toBe(false);
    // A second, unguarded import beside a guarded one.
    expect(claudeImportIsPrunable(`${guarded}\n${thrown}`)).toBe(false);
  });
});
