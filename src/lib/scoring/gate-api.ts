// The PUBLIC gate endpoint's wire contract — its path and the two statuses CI branches on — in one place.
//
// `GET /api/gate/:owner/:repo` is the only part of the gate other people's build scripts key on: 200 when
// the repo passes, 422 when it fails, so `curl --fail` exits non-zero. The route that produces the status,
// the governance brief, the security snippets and the landing band all RESTATE it; they read it from here
// so the contract is not a typed literal in each of them.
//
// DEPENDENCY-FREE on purpose (no imports): it is read by the unauthenticated route, whose module graph is
// kept lean, and by client-bundled components. NOT the evaluator — policy and verdict are `./gate.ts`'s.
// (The route's 503 "could not run" status is its own failure mode, not part of this pass/fail pair.)

/** Public route pattern of the CI gate; callers append `owner/repo` (or the `:owner/:repo` placeholders). */
export const GATE_API_PATH = "/api/gate";

/** The repo cleared the bar. */
export const GATE_PASS_STATUS = 200;

/** The repo failed the bar — non-2xx on purpose, so `curl --fail` trips and the caller's build stops. */
export const GATE_FAIL_STATUS = 422;
