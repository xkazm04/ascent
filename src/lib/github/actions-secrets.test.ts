// Pins the three properties that make writing a credential into a customer repo safe:
//
//   1. The sealed box is REAL — a round trip through libsodium's `crypto_box_seal_open` with a test
//      keypair recovers the exact plaintext. A silently-wrong ciphertext would look like success here
//      and fail only inside the customer's runner, where nobody is watching.
//   2. The name allowlist is enforced by the TYPE, not at runtime — the `@ts-expect-error` below is
//      the assertion, and `npx tsc --noEmit` is what runs it. If someone widens the parameter to
//      `string`, that line stops erroring and the compile fails.
//   3. A missing `secrets: write` permission arrives as AppApiError(403), so the routes can map it to
//      the "update the GitHub App's permissions" copy instead of a generic 502.
//
// githubAppFetch is mocked (routed by path + method) but AppApiError is the real class, so the
// instanceof branches inside actions-secrets.ts fire.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { AppApiError } = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");

vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return { ...actual, githubAppFetch: vi.fn() };
});

import {
  CONFORMANCE_SECRETS,
  deleteRepoSecret,
  encryptSecret,
  getRepoSecretPublicKey,
  putRepoSecret,
} from "./actions-secrets";
import { githubAppFetch } from "@/lib/github/app";

const mockFetch = vi.mocked(githubAppFetch);
const TOKEN = "ghs_test";
const OWNER = "acme";
const REPO = "app";

interface Call {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

async function sodiumLib() {
  // Same CommonJS door the module uses — the published ESM entry of libsodium-wrappers@0.7.16 is
  // broken (see loadSodium in actions-secrets.ts).
  const { createRequire } = await import("node:module");
  const sodium = createRequire(import.meta.url)("libsodium-wrappers") as typeof import("libsodium-wrappers");
  await sodium.ready;
  return sodium;
}

/** A real X25519 keypair, so the round trip proves the ciphertext, not the mock. */
async function testKeypair() {
  const sodium = await sodiumLib();
  const kp = sodium.crypto_box_keypair();
  return {
    sodium,
    publicKeyB64: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  };
}

let calls: Call[];

function routeFetch(publicKeyB64: string, over: (c: Call) => unknown = () => undefined) {
  mockFetch.mockImplementation(async (path: string, _auth: string, init: RequestInit = {}) => {
    const call: Call = {
      path,
      method: (init.method as string) ?? "GET",
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const overridden = over(call);
    if (overridden !== undefined) return overridden as never;
    if (path.endsWith("/actions/secrets/public-key")) {
      return { key_id: "kid-1", key: publicKeyB64 } as never;
    }
    // Every real write answers 2xx with an EMPTY body, which githubAppFetch surfaces as a JSON
    // SyntaxError — the exact shape actions-secrets.ts must treat as success.
    throw new SyntaxError("Unexpected end of JSON input");
  });
}

beforeEach(() => {
  calls = [];
  mockFetch.mockReset();
});

describe("encryptSecret", () => {
  it("produces a sealed box the repo's private key can open", async () => {
    const { sodium, publicKeyB64, publicKey, privateKey } = await testKeypair();
    const sealed = await encryptSecret(publicKeyB64, "askl_supersecret");
    const opened = sodium.crypto_box_seal_open(
      sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL),
      publicKey,
      privateKey,
    );
    expect(sodium.to_string(opened)).toBe("askl_supersecret");
  });

  it("is non-deterministic (a sealed box carries a fresh ephemeral key each time)", async () => {
    const { publicKeyB64 } = await testKeypair();
    const a = await encryptSecret(publicKeyB64, "same");
    const b = await encryptSecret(publicKeyB64, "same");
    expect(a).not.toBe(b);
  });
});

describe("putRepoSecret", () => {
  it("fetches the repo key, then PUTs the sealed value under the allowlisted name", async () => {
    const { sodium, publicKeyB64, publicKey, privateKey } = await testKeypair();
    routeFetch(publicKeyB64);
    await putRepoSecret(TOKEN, OWNER, REPO, "ASCENT_CONFORMANCE_TOKEN", "askl_abc");

    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(calls[1]!.path).toBe(`/repos/${OWNER}/${REPO}/actions/secrets/ASCENT_CONFORMANCE_TOKEN`);
    expect(calls[1]!.body!.key_id).toBe("kid-1");
    // The value on the wire is the SEALED box — never the raw token.
    const wire = calls[1]!.body!.encrypted_value as string;
    expect(wire).not.toContain("askl_abc");
    const opened = sodium.crypto_box_seal_open(
      sodium.from_base64(wire, sodium.base64_variants.ORIGINAL),
      publicKey,
      privateKey,
    );
    expect(sodium.to_string(opened)).toBe("askl_abc");
  });

  it("surfaces a missing secrets:write permission as AppApiError 403", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64, (c) => {
      if (c.method === "PUT") throw new AppApiError(403, c.path, "Resource not accessible by integration");
      return undefined;
    });
    await expect(putRepoSecret(TOKEN, OWNER, REPO, "ASCENT_CONFORMANCE_URL", "https://x")).rejects.toMatchObject({
      name: "AppApiError",
      status: 403,
    });
  });

  it("only the two conformance names are writable — enforced by the TYPE (tsc runs this)", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64);
    // @ts-expect-error an arbitrary secret name is not a ConformanceSecretName
    await expect(putRepoSecret(TOKEN, OWNER, REPO, "NPM_TOKEN", "npm_evil")).resolves.toBeUndefined();
    expect(CONFORMANCE_SECRETS).toEqual(["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"]);
  });
});

describe("deleteRepoSecret", () => {
  it("DELETEs the named secret", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64);
    await deleteRepoSecret(TOKEN, OWNER, REPO, "ASCENT_CONFORMANCE_URL");
    expect(calls).toEqual([
      { path: `/repos/${OWNER}/${REPO}/actions/secrets/ASCENT_CONFORMANCE_URL`, method: "DELETE", body: null },
    ]);
  });

  it("treats 404 as success — the revoke path must be idempotent", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64, (c) => {
      if (c.method === "DELETE") throw new AppApiError(404, c.path, "Not Found");
      return undefined;
    });
    await expect(deleteRepoSecret(TOKEN, OWNER, REPO, "ASCENT_CONFORMANCE_TOKEN")).resolves.toBeUndefined();
  });

  it("does NOT swallow a 403 — a permission failure must be visible", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64, (c) => {
      if (c.method === "DELETE") throw new AppApiError(403, c.path, "Resource not accessible by integration");
      return undefined;
    });
    await expect(deleteRepoSecret(TOKEN, OWNER, REPO, "ASCENT_CONFORMANCE_TOKEN")).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("getRepoSecretPublicKey", () => {
  it("reads the per-repo Actions public key", async () => {
    const { publicKeyB64 } = await testKeypair();
    routeFetch(publicKeyB64);
    const pk = await getRepoSecretPublicKey(TOKEN, OWNER, REPO);
    expect(pk).toEqual({ key_id: "kid-1", key: publicKeyB64 });
  });
});
