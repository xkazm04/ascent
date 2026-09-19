// Secret encryption at rest (BYOM, §2.3) — the first place Ascent persists a CUSTOMER secret (an org's
// Bedrock credentials). App-level AES-256-GCM with a 32-byte key from ENCRYPTION_KEY (base64), no new
// dependency (Node `crypto`). Authenticated encryption: decrypt THROWS on any tamper or wrong key.
// Versioned prefix ("v1:") leaves room for key rotation. Discipline (enforced by the callers): never
// log a decrypted secret, never return it to the client, decrypt ONLY at provider-construction time.
// FAIL CLOSED: with no/!32-byte ENCRYPTION_KEY, isEncryptionConfigured() is false and BYOM is disabled.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/** The configured key, or null when ENCRYPTION_KEY is absent / not a base64-encoded 32-byte value. */
function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  return key.length === KEY_BYTES ? key : null;
}

/** True when a valid 32-byte ENCRYPTION_KEY is configured — the gate for whether BYOM is available. */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt to "v1:<base64 iv>:<base64 ciphertext>:<base64 tag>". Throws if the key is unconfigured. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error("ENCRYPTION_KEY is not configured (expected a base64-encoded 32-byte key).");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), ct.toString("base64"), tag.toString("base64")].join(":");
}

/** Decrypt a blob produced by encryptSecret. THROWS on a malformed blob, a tampered payload (GCM auth
 *  failure), or the wrong key. Never log the return value. */
export function decryptSecret(blob: string): string {
  const key = getKey();
  if (!key) throw new Error("ENCRYPTION_KEY is not configured.");
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Malformed or unsupported secret blob.");
  const iv = Buffer.from(parts[1]!, "base64");
  const ct = Buffer.from(parts[2]!, "base64");
  const tag = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // final() throws "Unsupported state or unable to authenticate data" on tamper / wrong key.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
