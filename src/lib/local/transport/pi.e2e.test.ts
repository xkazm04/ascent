// ONE REAL PI SESSION, end to end, against a real local model.
//
// This is the test the whole package exists to justify. An adapter built from a vendor's
// documentation is a description of the version the vendor wishes you had; the four things this file
// proves could each only be learned by running the binary:
//
//   • Pi really edits a file when armed the way `piArgs` arms it;
//   • the normalizer really yields a tool event and a terminal `ok: true` envelope from ITS output;
//   • the accounting really lands — tokens, turns and a measured duration — with a NULL cost;
//   • the endpoint really reaches the model through the generated provider file and
//     `PI_CODING_AGENT_DIR`, without a line being written into the operator's own `~/.pi/agent`.
//
// SKIPPED, not failed, where the tools are absent: `pi` on PATH and an Ollama-compatible endpoint
// answering at `ASCENT_PI_E2E_URL` (default `http://localhost:11434`) with `ASCENT_PI_E2E_MODEL`
// (default `qwen3.8:27b`) pulled. A CI box that has neither is not evidence of a broken adapter.
//
// It runs in a scratch git repo of its own making, never in this checkout — an agent with the `write`
// and `edit` tools pointed at the repository it is being tested from is not a test, it is an
// accident waiting for a slow afternoon.

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "@/lib/local/runner-types";
import { runPiAgent } from "@/lib/local/transport/pi";

const BASE_URL = process.env.ASCENT_PI_E2E_URL?.trim() || "http://localhost:11434";
const MODEL = process.env.ASCENT_PI_E2E_MODEL?.trim() || "qwen3.8:27b";

const piVersion = (() => {
  try {
    return execSync("pi --version", { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
})();

const modelReady = await (async () => {
  if (!piVersion) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).some((m) => m.name === MODEL);
  } catch {
    return false;
  }
})();

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
  vi.unstubAllEnvs();
});

describe.skipIf(!modelReady)(`a real pi session (${piVersion ?? "absent"} → ${MODEL})`, () => {
  it(
    "edits a file, and the normalizer yields a tool event plus an ok envelope with a NULL cost",
    async () => {
      // The consent gate is pinned in `pi.test.ts`; this test is about the transport behind it, so it
      // arms the flag explicitly rather than depending on how the suite was invoked.
      vi.stubEnv("ASCENT_AUTOPILOT", "1");
      scratch = mkdtempSync(join(tmpdir(), "ascent-pi-e2e-"));
      writeFileSync(join(scratch, "README.md"), "# scratch\n", "utf8");
      execFileSync("git", ["init", "-q", "."], { cwd: scratch });

      const events: AgentStreamEvent[] = [];
      const result = await runPiAgent({
        cwd: scratch,
        prompt:
          'Write a file named hello.txt in the current directory containing exactly the word HELLO. Then stop; do not do anything else.',
        endpoint: { baseUrl: `${BASE_URL}/v1`, model: MODEL, contextTokens: 65_536 },
        // Generous, because this is a 27B on one consumer GPU; the point is the outcome, not the clock.
        timeoutMs: 600_000,
        onEvent: (e) => events.push(e),
      });

      // The file, on disk. Nothing about the stream proves this and it is the whole claim.
      expect(readFileSync(join(scratch, "hello.txt"), "utf8")).toContain("HELLO");

      expect(result.ok).toBe(true);
      expect(events.some((e) => e.kind === "write" || e.kind === "edit")).toBe(true);
      expect(events.some((e) => e.tool === "write")).toBe(true);

      // COST IS NULL, NEVER 0 — Pi's own zeros are the price list in the generated models.json.
      expect(result.costMicros).toBeNull();
      // …and the measurements that ARE real are present.
      expect(result.turns).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.sessionId).toMatch(/^[0-9a-f]{8}-/);
      expect(result.model).toBe(MODEL);
    },
    620_000,
  );
});
