// Tests for the secret-box (BYOM secret-at-rest, §2.3) — the dominant-risk component. Pins the security
// contract: round-trip fidelity, tamper detection (GCM auth), wrong-key rejection, fail-closed when
// ENCRYPTION_KEY is absent/short, and non-deterministic ciphertext (fresh IV per call). Keys are read
// from process.env at call time, so the tests just set/clear ENCRYPTION_KEY around each case.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";

const KEY_A = Buffer.alloc(32, 7).toString("base64"); // valid 32-byte key
const KEY_B = Buffer.alloc(32, 9).toString("base64"); // a DIFFERENT valid key
const original = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

describe("secret-box round-trip", () => {
  it("decrypts what it encrypted", () => {
    const secret = "AKIAEXAMPLE/very+secret/key";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("uses a fresh IV → two encryptions of the same plaintext differ (no deterministic leak)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("emits the versioned 4-part format", () => {
    const blob = encryptSecret("x");
    const parts = blob.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });
});

describe("secret-box tamper + wrong-key detection", () => {
  it("THROWS on a tampered ciphertext", () => {
    const blob = encryptSecret("secret");
    const parts = blob.split(":");
    // Flip the ciphertext segment (still valid base64, different bytes).
    const ct = Buffer.from(parts[2]!, "base64");
    ct[0] = ct[0]! ^ 0xff;
    parts[2] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("THROWS when decrypted with the wrong key", () => {
    const blob = encryptSecret("secret");
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(blob)).toThrow();
  });

  it("THROWS on a malformed / unversioned blob", () => {
    expect(() => decryptSecret("not-a-blob")).toThrow();
    expect(() => decryptSecret("v2:a:b:c")).toThrow();
  });
});

describe("secret-box fail-closed", () => {
  it("isEncryptionConfigured is true for a valid 32-byte key, false otherwise", () => {
    expect(isEncryptionConfigured()).toBe(true);
    delete process.env.ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64"); // too short
    expect(isEncryptionConfigured()).toBe(false);
  });

  it("encrypt/decrypt THROW when the key is unconfigured", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow();
    expect(() => decryptSecret("v1:a:b:c")).toThrow();
  });
});
