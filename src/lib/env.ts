// Canonical reader for boolean environment-variable flags.
//
// Historically the four-character idiom `const v = process.env.X; return v === "1" || v === "true";`
// was hand-rolled in ~10 places (auth bypass, org-dashboard open, plan/credit-grant gates, the public
// scan-quota kill switch, etc.), so the accepted truthy set lived in ten copies. This is the one place
// that defines it. The accepted truthy set is exactly `"1"` and `"true"` (case-sensitive, no
// whitespace trimming) — the form the majority of call sites used — so routing them here is
// behavior-preserving.
//
// Pure (reads only `process.env`); safe to import from server modules, client-adjacent modules, and
// the next/headers-free proxy alike.

/** True iff the given env var is set to one of the accepted truthy tokens (`"1"` or `"true"`). */
export function envBool(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}
