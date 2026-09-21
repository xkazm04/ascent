// THE PREFLIGHT PROBE, pinned against the two failures measured on this machine on 2026-09-21 —
// both of which produce a RESULT rather than an error, which is why the probe refuses rather than
// warns.
//
// The spawn and the HTTP reads are the two seams that are faked; everything else is the real module.
// The fake spawn is also the INSTRUMENT for the zero-token claim: it records every argv the probe
// produces, and the test asserts that none of them is a completion.

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => ({
  calls: [] as { bin: string; args: string[] }[],
  reply: new Map<string, { code: number; stdout: string }>(),
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
}

vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: vi.fn((bin: string, args: string[]) => {
    spawned.calls.push({ bin, args });
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const key = args.join(" ");
    const reply = spawned.reply.get(key) ?? { code: 127, stdout: "" };
    setTimeout(() => {
      if (reply.stdout) child.stdout.emit("data", Buffer.from(reply.stdout, "utf8"));
      child.emit("close", reply.code);
    }, 0);
    return child;
  }),
}));

vi.mock("@/lib/local/transport/profile", () => ({
  transportProfile: (id: string) => ({
    id,
    label: id,
    bin: id === "claude" ? "claude" : "pi",
    timing: { agentMs: 1, planMs: 1, quietMs: 1 },
    zeroCost: id !== "claude",
    caps: { streamJson: null, editStance: null, planStance: null, resume: null, promptOnStdin: null },
  }),
}));

const { MIN_CONTEXT_TOKENS, MIN_SERVER_VERSION, parseProbe, probeRefusal, probeTransport, serializeProbe, versionAtLeast } =
  await import("./probe");

/** The live server's shapes, copied from real 2026-09-21 responses on this machine. */
interface ServerState {
  version: string;
  tags: string[];
  /** The LOADED context `/api/ps` reports, or null for "not resident". */
  resident: number | null;
  /** What `/api/ps` reports after the zero-token load call. */
  afterLoad: number | null;
}

const fetched: string[] = [];
let server: ServerState;
let reachable = true;

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      fetched.push(u);
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (!reachable) throw new Error("ECONNREFUSED");
      if (u.endsWith("/api/version")) return json({ version: server.version });
      if (u.endsWith("/api/tags")) {
        return json({ models: server.tags.map((t) => ({ name: t, model: t, details: { context_length: 262_144 } })) });
      }
      if (u.endsWith("/api/ps")) {
        const ctx = server.resident;
        return json({ models: ctx == null ? [] : [{ name: server.tags[0], model: server.tags[0], context_length: ctx }] });
      }
      if (u.endsWith("/api/generate")) {
        server.resident = server.afterLoad;
        return json({ model: server.tags[0], response: "", done: true, done_reason: "load" });
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }),
  );
}

const ENDPOINT = { baseUrl: "http://localhost:11434", model: "qwen3:27b", token: "ollama", contextTokens: 65_536 };

beforeEach(() => {
  spawned.calls.length = 0;
  spawned.reply.clear();
  spawned.reply.set("--version", { code: 0, stdout: "2.1.278 (Claude Code)\n" });
  spawned.reply.set(
    "auth status",
    { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }) },
  );
  fetched.length = 0;
  reachable = true;
  server = { version: "0.33.1", tags: ["qwen3:27b"], resident: 131_072, afterLoad: 131_072 };
  stubFetch();
});

describe("probeTransport — a healthy local arm", () => {
  it("passes every check and records both versions", async () => {
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(true);
    expect(probeRefusal(result)).toBeNull();
    expect(result.binVersion).toBe("2.1.278 (Claude Code)");
    expect(result.serverVersion).toBe("0.33.1");
    expect(result.findings.map((f) => f.check)).toEqual(["binary", "endpoint", "model", "context", "server-version", "auth"]);
  });

  it("reads the LOADED context from /api/ps, never the model's advertised maximum", async () => {
    // /api/tags advertises 262 144 for this model; /api/ps says the loaded instance has 131 072.
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.findings.find((f) => f.check === "context")?.observed).toBe("131072 tokens (loaded)");
  });

  it("loads a non-resident model with a ZERO-TOKEN load call and re-reads /api/ps", async () => {
    server = { ...server, resident: null, afterLoad: 131_072 };
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(true);
    expect(fetched.filter((u) => u.endsWith("/api/generate"))).toHaveLength(1);
    // Two /api/ps reads: before the load and after it.
    expect(fetched.filter((u) => u.endsWith("/api/ps"))).toHaveLength(2);
  });
});

describe("probeTransport — zero tokens (acceptance #1)", () => {
  it("never issues a completion: no `-p`, no prompt, no /api/chat", async () => {
    await probeTransport("claude", ENDPOINT);
    await probeTransport("claude", null);
    const argv = spawned.calls.map((c) => c.args.join(" "));
    // A local arm asks the binary its version and nothing else; a cloud arm adds the zero-token
    // `auth status`. Neither list contains a print/prompt invocation.
    expect(argv).toEqual(["--version", "--version", "auth status"]);
    for (const a of argv) expect(a).not.toContain("-p");
    expect(fetched.some((u) => u.includes("/api/chat") || u.includes("/v1/messages"))).toBe(false);
    // The ONE POST the probe makes is the load call, which carries no prompt and generates nothing —
    // the live server answers it with `{"done_reason":"load"}` and an empty response.
    expect(fetched.filter((u) => u.endsWith("/api/generate")).length).toBeLessThanOrEqual(1);
  });

  it("claims zeroToken only because nothing above spends — the claim and the evidence are one test", async () => {
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.zeroToken).toBe(true);
  });
});

describe("probeTransport — a truncated context is refused (acceptance #2)", () => {
  it("refuses a server serving 4096 tokens, naming the number and the remedy", async () => {
    server = { ...server, resident: 4_096, afterLoad: 4_096 };
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(false);
    const sentence = probeRefusal(result)!;
    expect(sentence).toContain("4096 tokens");
    expect(sentence).toContain(String(MIN_CONTEXT_TOKENS));
    expect(sentence).toContain("OLLAMA_CONTEXT_LENGTH");
    expect(sentence).toContain("truncated");
  });

  it("refuses this machine's measured 32768 too — below the floor is below the floor", async () => {
    server = { ...server, resident: 32_768, afterLoad: 32_768 };
    expect((await probeTransport("claude", ENDPOINT)).ok).toBe(false);
  });

  it("refuses rather than accepting the advertised maximum when nothing loads", async () => {
    server = { ...server, resident: null, afterLoad: null };
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(false);
    expect(probeRefusal(result)).toContain("did not report a loaded context");
  });
});

describe("probeTransport — a server below the key-value-cache fix is refused (acceptance #3)", () => {
  it("names the observed version and the minimum", async () => {
    server = { ...server, version: "0.32.15" };
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(false);
    const sentence = probeRefusal(result)!;
    expect(sentence).toContain("0.32.15");
    expect(sentence).toContain(MIN_SERVER_VERSION);
    expect(sentence).toContain("key-value cache");
  });

  it("versionAtLeast compares numerically, not lexically", () => {
    expect(versionAtLeast("0.32.15", "0.33.0")).toBe(false);
    expect(versionAtLeast("0.33.0", "0.33.0")).toBe(true);
    expect(versionAtLeast("0.100.0", "0.33.0")).toBe(true);
    expect(versionAtLeast("1.0", "0.33.0")).toBe(true);
    expect(versionAtLeast(null, "0.33.0")).toBe(false);
  });
});

describe("probeTransport — the other refusals", () => {
  it("an absent binary fails the binary check and never asks the server anything", async () => {
    spawned.reply.set("--version", { code: 127, stdout: "" });
    const result = await probeTransport("claude", null);
    expect(result.ok).toBe(false);
    expect(probeRefusal(result)).toContain("binary check failed");
  });

  it("an unreachable endpoint is a finding, not an exception, and skips the checks it cannot run", async () => {
    reachable = false;
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.check)).toEqual(["binary", "endpoint", "auth"]);
    expect(probeRefusal(result)).toContain("Start the inference server");
  });

  it("a model the server does not have is named with its pull command", async () => {
    server = { ...server, tags: ["qwen2.5:7b-instruct"] };
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(false);
    expect(probeRefusal(result)).toContain("ollama pull qwen3:27b");
  });

  it("a logged-out CLI on a CLOUD arm is refused by the zero-token auth check", async () => {
    spawned.reply.set("auth status", { code: 0, stdout: JSON.stringify({ loggedIn: false }) });
    const result = await probeTransport("claude", null);
    expect(result.ok).toBe(false);
    expect(probeRefusal(result)).toContain("claude auth login");
  });

  it("a LOCAL arm's auth is the endpoint token — the Anthropic seat is not consulted at all", async () => {
    spawned.reply.set("auth status", { code: 0, stdout: JSON.stringify({ loggedIn: false }) });
    const result = await probeTransport("claude", ENDPOINT);
    expect(result.ok).toBe(true);
    expect(spawned.calls.map((c) => c.args.join(" "))).toEqual(["--version"]);
  });

  it("a local endpoint with no token is refused: the client rejects its absence", async () => {
    const result = await probeTransport("claude", { ...ENDPOINT, token: null });
    expect(result.ok).toBe(false);
    expect(probeRefusal(result)).toContain("auth check failed");
  });

  it("a transport with no zero-token auth proof SAYS SO rather than passing on trust", async () => {
    spawned.reply.set("--version", { code: 0, stdout: "pi 0.1.0\n" });
    const result = await probeTransport("pi", null);
    expect(result.findings.find((f) => f.check === "auth")?.ok).toBe(false);
    expect(result.findings.find((f) => f.check === "auth")?.observed).toContain("no zero-token authentication check");
  });
});

describe("probeTransport — the spawn door", () => {
  it("spawns through the same env strip the real run uses (no CLAUDECODE markers)", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    const { spawn } = await import("node:child_process");
    await probeTransport("claude", null);
    const opts = vi.mocked(spawn).mock.calls[0]![2] as { env: NodeJS.ProcessEnv; shell: boolean };
    expect(opts.env.CLAUDECODE).toBeUndefined();
    expect(opts.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    // `shell: true` because Windows ships `claude.cmd` — the same door `runClaudeAgent` opens.
    expect(opts.shell).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("probeJson round-trips (acceptance #6)", () => {
  it("survives serialize → parse with every finding and both versions intact", async () => {
    server = { ...server, resident: 4_096, afterLoad: 4_096 };
    const result = await probeTransport("claude", ENDPOINT);
    const back = parseProbe(serializeProbe(result));
    expect(back).toEqual(result);
    expect(probeRefusal(back!)).toBe(probeRefusal(result));
  });

  it("a row that is not a probe reads back as null, never as a fabricated pass", () => {
    expect(parseProbe(null)).toBeNull();
    expect(parseProbe("")).toBeNull();
    expect(parseProbe("not json")).toBeNull();
    expect(parseProbe(JSON.stringify({ ok: true }))).toBeNull();
  });
});
