// The REAL HMAC verification path for the per-org ingest token — nothing mocked. This is the entire
// auth story for the internet-facing /api/integrations/ingest surface, and until this file existed it
// had zero direct coverage: both ingest route test files mock `parseIngestToken` out, so a regression
// in the mac derivation, the constant-time compare, or the length guard would have gone unnoticed.
//
// The secret is captured at module load, so the module is imported dynamically AFTER the env is
// stubbed (a static import would hoist above the assignment and pick up the ambient ENCRYPTION_KEY).

import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "test-ingest-secret-do-not-use";

type TokenModule = typeof import("./ingest-token");
let mod: TokenModule;

beforeAll(async () => {
  process.env.INTEGRATIONS_INGEST_SECRET = SECRET;
  mod = await import("./ingest-token");
});

/** Independently derived expected mac — deliberately NOT calling the module's own helper, so the test
 *  pins the wire format rather than agreeing with whatever the implementation happens to do. */
function expectedMac(slug: string): string {
  return createHmac("sha256", SECRET).update(`otel:${slug}`).digest("hex").slice(0, 32);
}

describe("ingestToken / parseIngestToken — real HMAC round-trip", () => {
  it("mints asc_otel.<slug>.<mac> with the independently derived mac", () => {
    const token = mod.ingestToken("acme");
    expect(token).toBe(`asc_otel.acme.${expectedMac("acme")}`);
  });

  it("verifies a valid token and recovers the org slug", () => {
    expect(mod.parseIngestToken(mod.ingestToken("acme"))).toEqual({ slug: "acme" });
  });

  it("tolerates surrounding whitespace (headers get trimmed in transit)", () => {
    expect(mod.parseIngestToken(`  ${mod.ingestToken("acme")}\n`)).toEqual({ slug: "acme" });
  });
});

describe("forged tokens are rejected", () => {
  it("rejects a tampered mac of the correct length", () => {
    const token = mod.ingestToken("acme");
    const mac = token.split(".")[2]!;
    // Flip the last hex digit — same length, so this exercises timingSafeEqual, not the length guard.
    const flipped = mac.slice(0, -1) + (mac.endsWith("a") ? "b" : "a");
    expect(flipped).toHaveLength(mac.length);
    expect(mod.parseIngestToken(`asc_otel.acme.${flipped}`)).toBeNull();
  });

  it("rejects a mac of the wrong length before timingSafeEqual can throw", () => {
    const mac = mod.ingestToken("acme").split(".")[2]!;
    expect(mod.parseIngestToken(`asc_otel.acme.${mac.slice(0, 16)}`)).toBeNull();
    expect(mod.parseIngestToken(`asc_otel.acme.${mac}00`)).toBeNull();
    expect(mod.parseIngestToken("asc_otel.acme.")).toBeNull();
  });

  it("rejects another org's mac (cross-tenant: the mac is bound to the slug)", () => {
    const other = mod.ingestToken("globex").split(".")[2]!;
    expect(mod.parseIngestToken(`asc_otel.acme.${other}`)).toBeNull();
    // …and the same mac still verifies under its OWN slug, proving the rejection is the binding.
    expect(mod.parseIngestToken(`asc_otel.globex.${other}`)).toEqual({ slug: "globex" });
  });

  it("rejects a malformed prefix or the wrong number of segments", () => {
    const mac = expectedMac("acme");
    expect(mod.parseIngestToken(`asc_oteL2.acme.${mac}`)).toBeNull();
    expect(mod.parseIngestToken(`ghp_token.acme.${mac}`)).toBeNull();
    expect(mod.parseIngestToken(`acme.${mac}`)).toBeNull();
    expect(mod.parseIngestToken(`asc_otel.acme.${mac}.extra`)).toBeNull();
    expect(mod.parseIngestToken("")).toBeNull();
    expect(mod.parseIngestToken("asc_otel..")).toBeNull();
  });

  it("rejects a non-hex mac of the right length (no crash on odd bytes)", () => {
    expect(mod.parseIngestToken(`asc_otel.acme.${"z".repeat(32)}`)).toBeNull();
    expect(mod.parseIngestToken(`asc_otel.acme.${"é".repeat(32)}`)).toBeNull();
  });
});

describe("bearerToken", () => {
  it("extracts the token from an Authorization header, case-insensitively", () => {
    expect(mod.bearerToken("Bearer abc123")).toBe("abc123");
    expect(mod.bearerToken("bearer abc123")).toBe("abc123");
    expect(mod.bearerToken("Bearer   abc123  ")).toBe("abc123");
  });

  it("falls back to the custom header when Authorization is absent or not a bearer", () => {
    expect(mod.bearerToken(null, "abc123")).toBe("abc123");
    expect(mod.bearerToken("Basic zzz", "abc123")).toBe("abc123");
    expect(mod.bearerToken(null)).toBeNull();
    expect(mod.bearerToken(null, null)).toBeNull();
  });
});
