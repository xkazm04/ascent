// GitHub Actions repository secrets — the ONE write door Ascent uses to provision a customer repo's
// report-back credentials (`node .ai/doctor.mjs --json` → /api/report/conformance). Layered on
// `githubAppFetch` exactly like github/write.ts: same installation-token flow, same headers, same
// AppApiError taxonomy, so a missing `secrets: write` permission surfaces as a 403 the PR-write error
// mapper already knows how to phrase.
//
// TWO SAFETY PROPERTIES ARE STRUCTURAL HERE, not conventions a call site is asked to remember:
//
//   1. **The name allowlist lives in the TYPE.** `putRepoSecret`/`deleteRepoSecret` take a
//      `ConformanceSecretName`, a union of exactly two literals. No call site — present or future —
//      can put an arbitrary secret into a customer repo without changing this file, and `tsc` is the
//      thing that says no. A runtime check would have been one careless `as string` from being lost.
//   2. **Nothing loads at import time.** libsodium is a WASM module; `next build` traces this file
//      from a route, and a top-level `import` (or a module-scope `await sodium.ready`) drags that
//      into the build graph and can break the client/server boundary at build time while tsc + tests
//      stay green (the `build-not-in-gate` failure mode). The dynamic import + `await sodium.ready`
//      both live INSIDE encryptSecret, so the cost is paid on the first real provisioning call.
//
// Why a dependency at all: GitHub Actions secrets must be sealed with libsodium `crypto_box_seal`
// (X25519-XSalsa20-Poly1305) against the repo's public key. `node:crypto` has X25519 but neither
// XSalsa20 nor Poly1305, so there is no stdlib path; `libsodium-wrappers` is the octokit-documented
// choice and the minimal addition.

import { AppApiError, githubAppFetch } from "@/lib/github/app";
import type * as SodiumModule from "libsodium-wrappers";

/**
 * Load libsodium LAZILY and through Node's own CommonJS resolver.
 *
 * Two separate reasons, both load-bearing:
 *
 *  - **Lazy.** A top-level import of a WASM module gets traced into the build graph from every route
 *    that reaches this file. Paying the load on the first real provisioning call keeps the module
 *    inert everywhere else (`build-not-in-gate`).
 *  - **CommonJS, deliberately.** libsodium-wrappers@0.7.16 ships a BROKEN ESM entry: its
 *    `dist/modules-esm/libsodium-wrappers.mjs` imports `./libsodium.mjs`, a file that lives in the
 *    sibling `libsodium` package and is not present in that directory. `await import(...)` therefore
 *    picks the `"import"` condition and throws ERR_MODULE_NOT_FOUND — in Node, in vitest, and in the
 *    server runtime. `require()` picks the `"require"` condition, which is correct and works. The
 *    specifier is a LITERAL so Next's file tracing still sees the dependency; `libsodium-wrappers` is
 *    listed in `serverExternalPackages` so the bundler leaves this to Node rather than re-resolving
 *    the broken ESM entry itself.
 */
async function loadSodium(): Promise<typeof SodiumModule> {
  const { createRequire } = await import("node:module");
  const sodium = createRequire(import.meta.url)("libsodium-wrappers") as typeof SodiumModule;
  await sodium.ready;
  return sodium;
}

/** The only two secret names Ascent will ever write into a customer repo. */
export const CONFORMANCE_SECRETS = ["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"] as const;
export type ConformanceSecretName = (typeof CONFORMANCE_SECRETS)[number];

/** A repo's Actions secrets public key, as GitHub returns it. `key` is standard base64. */
export interface RepoSecretPublicKey {
  key_id: string;
  key: string;
}

export async function getRepoSecretPublicKey(
  token: string,
  owner: string,
  repo: string,
): Promise<RepoSecretPublicKey> {
  return githubAppFetch<RepoSecretPublicKey>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/secrets/public-key`,
    token,
  );
}

/**
 * Sealed-box encrypt `value` under `publicKeyB64` (standard base64, as GitHub serves it) and return
 * the base64 ciphertext GitHub expects in `encrypted_value`. Decryptable only by the repo's private
 * key, which GitHub holds — Ascent cannot read back what it wrote, by construction.
 */
export async function encryptSecret(publicKeyB64: string, value: string): Promise<string> {
  const sodium = await loadSodium();
  const key = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/**
 * A 2xx with an EMPTY body is the success shape for both writes below (GitHub answers 201 on create,
 * 204 on update, 204 on delete). `githubAppFetch` always calls `res.json()`, which throws a
 * SyntaxError on an empty body — and only on an empty body, because a non-2xx has already become an
 * AppApiError before the parse. Narrowing the swallow to SyntaxError keeps the audited fetch path
 * (headers, timeout, error taxonomy) instead of forking a second client for two verbs.
 */
async function appFetchNoContent(path: string, token: string, init: RequestInit): Promise<void> {
  try {
    await githubAppFetch(path, token, init);
  } catch (err) {
    if (err instanceof SyntaxError) return; // 2xx, empty body — the documented success shape
    throw err;
  }
}

const secretPath = (owner: string, repo: string, name: ConformanceSecretName) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/secrets/${name}`;

/**
 * Create or update ONE of the two conformance secrets. Fetches the repo's public key per call: the
 * key is per-repo and rotates, and a stale key produces a secret the runner cannot decrypt — a
 * silent failure far more expensive than the extra round trip.
 *
 * A 403 here means the installation lacks `secrets: write`; it propagates as an AppApiError so the
 * caller can surface the "update the GitHub App's permissions" copy the PR routes already use.
 */
export async function putRepoSecret(
  token: string,
  owner: string,
  repo: string,
  name: ConformanceSecretName,
  value: string,
): Promise<void> {
  const pk = await getRepoSecretPublicKey(token, owner, repo);
  const encrypted_value = await encryptSecret(pk.key, value);
  await appFetchNoContent(secretPath(owner, repo, name), token, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
  });
}

/**
 * Remove one conformance secret. A 404 is treated as SUCCESS: "the secret is not there" is the
 * caller's goal, and the revoke path must be idempotent so a half-provisioned repo can always be
 * cleaned up rather than leaving a credential behind because the first of two deletes 404'd.
 */
export async function deleteRepoSecret(
  token: string,
  owner: string,
  repo: string,
  name: ConformanceSecretName,
): Promise<void> {
  try {
    await appFetchNoContent(secretPath(owner, repo, name), token, { method: "DELETE" });
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return;
    throw err;
  }
}
