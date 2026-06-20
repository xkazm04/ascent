import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAssessment, evalLogEnabled, redactSecrets } from "./eval-log";
import type { LlmAssessment } from "@/lib/types";

const assessment: LlmAssessment = {
  dimensions: [],
  headline: "",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
};

const baseRec = {
  at: "2026-06-20T12:00:00.000Z",
  repo: "acme/widget",
  provider: "bedrock",
  model: "sonnet",
  degraded: false,
  coverage: { scored: 9, expected: 9 },
  latencyMs: 1234,
  system: "you are the engine",
  user: "REPOSITORY acme/widget",
  assessment,
};

describe("eval-log (Tiger P1-4)", () => {
  let dir: string | undefined;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
      dir = undefined;
    }
  });

  it("is a no-op (returns null, writes nothing) when ASCENT_EVAL_LOG_DIR is unset", () => {
    vi.stubEnv("ASCENT_EVAL_LOG_DIR", "");
    expect(evalLogEnabled()).toBe(false);
    expect(captureAssessment(baseRec)).toBeNull();
  });

  it("appends a JSONL record with prompt + assessment + provenance + metering when enabled", () => {
    dir = mkdtempSync(join(tmpdir(), "tiger-eval-"));
    vi.stubEnv("ASCENT_EVAL_LOG_DIR", dir);
    expect(evalLogEnabled()).toBe(true);

    const id = captureAssessment(baseRec);
    expect(id).toBeTruthy();
    expect(readdirSync(dir)).toContain("assessments-2026-06-20.jsonl");

    const rec = JSON.parse(readFileSync(join(dir, "assessments-2026-06-20.jsonl"), "utf8").trim());
    expect(rec.id).toBe(id);
    expect(rec.repo).toBe("acme/widget");
    expect(rec.provider).toBe("bedrock");
    expect(rec.coverage).toEqual({ scored: 9, expected: 9 });
    expect(rec.latencyMs).toBe(1234);
    expect(rec.system).toContain("you are the engine");
  });

  it("redacts obvious secrets from the captured prompt", () => {
    dir = mkdtempSync(join(tmpdir(), "tiger-eval-"));
    vi.stubEnv("ASCENT_EVAL_LOG_DIR", dir);
    captureAssessment({
      ...baseRec,
      user: "leak sk-ABCDEFGHIJKLMNOP12345 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    });
    const rec = JSON.parse(readFileSync(join(dir, "assessments-2026-06-20.jsonl"), "utf8").trim());
    expect(rec.user).not.toContain("sk-ABCDEFGHIJKLMNOP12345");
    expect(rec.user).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(rec.user).toContain("[REDACTED]");
  });

  it("redactSecrets leaves ordinary prompt text untouched", () => {
    const clean = "REPOSITORY acme/widget — Language: TypeScript | Stars: 10";
    expect(redactSecrets(clean)).toBe(clean);
  });
});
