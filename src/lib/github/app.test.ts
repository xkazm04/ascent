// Webhook signature verification is the trust boundary for the GitHub App: a forged or unsigned
// payload must never be accepted (it can trigger token minting + scans). Locks in the HMAC-SHA256
// check, including the constant-time / length-guarded comparison and the secret-unset fail-closed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhook } from "./app";

const SECRET = "test-webhook-secret";
const sign = (body: string, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const BODY = JSON.stringify({ action: "created", installation: { id: 42 } });

beforeEach(() => vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhook(BODY, sign(BODY))).toBe(true);
  });

  it("rejects a signature computed over a different body (tamper)", () => {
    expect(verifyWebhook(BODY + " ", sign(BODY))).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhook(BODY, sign(BODY, "not-the-secret"))).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhook(BODY, null)).toBe(false);
  });

  it("rejects a malformed/short signature without throwing", () => {
    expect(verifyWebhook(BODY, "sha256=deadbeef")).toBe(false);
  });

  it("fails closed when the secret is not configured", () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "");
    expect(verifyWebhook(BODY, sign(BODY))).toBe(false);
  });
});
