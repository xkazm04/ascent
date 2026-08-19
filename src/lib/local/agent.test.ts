// The autopilot's consent gate. The spawn path itself is exercised end-to-end by a real run (it is
// a subprocess wrapper, and mocking spawn would test the mock); what MUST be pinned is that the
// agent runner refuses without the explicit opt-in — an auto-editing agent must never be a default.

import { afterEach, describe, expect, it, vi } from "vitest";
import { autopilotEnabled, runClaudeAgent } from "@/lib/local/agent";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("autopilotEnabled", () => {
  it("is OFF by default", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    expect(autopilotEnabled()).toBe(false);
  });

  it("requires the explicit flag", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    // Suite runs non-production, so cliProviderAllowed() is true and the flag is the deciding input.
    expect(autopilotEnabled()).toBe(true);
  });

  it("stays OFF on a managed-cloud production build even with the flag set", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    expect(autopilotEnabled()).toBe(false);
  });
});

describe("runClaudeAgent consent refusal", () => {
  it("refuses to spawn anything when the flag is off, with the fix in the message", async () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    const r = await runClaudeAgent({ cwd: process.cwd(), prompt: "noop" });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("ASCENT_AUTOPILOT=1");
  });
});
