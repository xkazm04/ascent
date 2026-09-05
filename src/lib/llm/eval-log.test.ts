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

  // The shapes that were MISSED. A PEM block and a Google key are among the most-committed secrets
  // there are, and neither resembles the OpenAI/GitHub/Slack prefixes the original list matched — so
  // the corpus this log captures (other people's source) carried them through verbatim to disk.
  it.each([
    [
      "an RSA private-key block, whole",
      `key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0aB
c3d4e5f6
-----END RSA PRIVATE KEY-----
done`,
      "MIIEowIBAAKCAQEA0aB",
    ],
    [
      "an OPENSSH private-key block",
      `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEA
-----END OPENSSH PRIVATE KEY-----`,
      "b3BlbnNzaC1rZXktdjEA",
    ],
    [
      "a bare private-key block",
      `-----BEGIN PRIVATE KEY-----
MIIEvQIBADAN
-----END PRIVATE KEY-----`,
      "MIIEvQIBADAN",
    ],
    ["a Google API key", "GEMINI_API_KEY=AIzaSyD-1234567890abcdefghijklmnopqrstu", "AIzaSyD-1234567890abcdefghijklmnopqrstu"],
    ["a Stripe live key", "STRIPE=sk_live_51H8xKfLkd0293ndkAOSJ", "sk_live_51H8xKfLkd0293ndkAOSJ"],
    ["an npm automation token", "//registry.npmjs.org/:_authToken=npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"],
    ["a labelled AWS secret key", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalrXUtnFEMI/K7MDENG"],
  ])("redacts %s", (_label, input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts the key MATERIAL, not just the PEM header", () => {
    // Redacting only the header would leave the actual key bytes in the log — the entire secret.
    const pem = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIBmS
AwEHoUQDQgAE
-----END EC PRIVATE KEY-----`;
    expect(redactSecrets(pem)).toBe("[REDACTED]");
  });

  it("leaves a bare 40-char blob alone — redacting every hash would gut the excerpts", () => {
    // An unlabelled AWS secret is indistinguishable from a sha1/base64 hash, and the log exists to
    // explain file excerpts. The labelled assignment form above is the tractable half.
    const sha = "commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3 touched src/index.ts";
    expect(redactSecrets(sha)).toBe(sha);
  });

  it("redactSecrets leaves ordinary prompt text untouched", () => {
    const clean = "REPOSITORY acme/widget — Language: TypeScript | Stars: 10";
    expect(redactSecrets(clean)).toBe(clean);
  });
});
