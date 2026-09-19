// The GatePolicy numeric contract(s) — pulled out of gate.ts into their own dependency-free module
// (no imports) so a CLIENT component (GatePolicyEditor) can import the exact rule it needs without
// pulling gate.ts's other imports (@/lib/maturity/model, etc.) into the client bundle. This repo has
// been bitten before by a client/server boundary break from exactly that kind of accidental pull.
//
// There are TWO distinct numeric rules here, not one — they look similar but answer different
// questions, and flattening them into a single function would change behavior:
//
//   - `parseFloor` — "is this a usable FLOOR?" Used by the server: sanitizeGatePolicy's floorScore
//     (persisted policy) and explicitPolicyFromParams's floorParam (query-param overlay) both need the
//     identical answer to this, because a floor of 0 (or out-of-range) is an always-pass gate that
//     still LOOKS configured — so both treat it as "not set" and DROP the field entirely rather than
//     storing/requesting a 0 floor. Returns `undefined` (never a value) on anything unusable.
//
//   - `clampToDisplayRange` — the client editor's OWN rule for the security-floor NUMBER INPUT: it
//     must always produce a concrete int to put in the request body (the field is only shown enabled
//     next to a checkbox; there's no "unset" state for it to fall back to), so it coerces an invalid
//     entry (NaN) to 0 and clamps out-of-range values to the nearest boundary instead of rejecting
//     them. That 0 is not asserted as a valid floor — sanitizeGatePolicy's parseFloor still rejects it
//     server-side (droppedFields in GatePolicyEditor.tsx surfaces exactly that as "saved, but NOT
//     enforced"). This is why it is a SEPARATE function rather than reusing parseFloor.

/** A valid "floor" value for a GatePolicy numeric field: finite, truncated to an int, and STRICTLY
 *  positive (0 < n <= 100). Anything else — missing, NaN, <= 0, > 100, or a non-numeric string — is
 *  "not a usable floor" and returns `undefined` so the caller drops the field / falls back to a
 *  default, rather than installing an always-pass (<= 0) or unreachable (> 100) bar. */
export function parseFloor(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.trunc(n) : undefined;
}

/** Clamp a raw form-input value into the displayable 0..100 int range, coercing an invalid (NaN)
 *  entry to 0 rather than rejecting it — the client editor's number input always needs SOME value to
 *  send, never "unset" (see the module doc above for why this can't reuse `parseFloor`). */
export function clampToDisplayRange(v: unknown): number {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}
