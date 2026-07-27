// Content fingerprint for the practice preview → apply contract. Preview and apply are two
// INDEPENDENT generations (the server re-runs fetchRepoContext → buildArtifact at apply time), so
// without a fingerprint the "review-then-commit" promise held for repo IDENTITY but not for CONTENT:
// repo metadata changing between preview and apply (description edited, primary language flipped,
// default branch renamed) would land a starter the user never reviewed. The client fingerprints the
// exact body it rendered; the server fingerprints what it is about to commit and refuses on mismatch
// (409 → "re-preview"). Isomorphic + dependency-free on purpose: this is drift DETECTION, not
// security, so a fast non-cryptographic hash is the right tool.

/** FNV-1a 32-bit over the artifact body, as 8 hex chars. Stable across client/server. */
export function artifactFingerprint(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
