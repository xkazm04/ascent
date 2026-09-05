// Canonical CSV cell encoder shared by every CSV export route (audit, history, org/export,
// org/repositories). Previously each route hand-rolled its own copy and they had drifted — most
// dangerously, the org/repositories copy was MISSING the formula-injection guard the others carried.
// One source of truth keeps the security mitigation uniform across every download.

/**
 * Encode a value as one RFC-4180 CSV field, with spreadsheet formula-injection neutralization.
 *
 * - **Formula injection**: a cell whose first char is `=`, `+`, `-`, or `@` is executed as a live
 *   formula by Excel / Google Sheets when the CSV is opened. Such values are prefixed with a single
 *   quote (the standard neutralizer) and quoted, so the leading `'` is unambiguously data, not syntax.
 *   A plain number is EXEMPT: a legitimate negative/signed value (e.g. a `-40` avgDelta or `+3`) begins
 *   with `-`/`+` but is data, not a formula — neutralizing it would corrupt the exported figure. Only a
 *   non-numeric leading `=`/`+`/`-`/`@` (e.g. `-1+cmd`, `=HYPERLINK(...)`) is guarded.
 * - **RFC-4180 quoting**: by default a field is quoted only when it contains `"`, `,`, or newline
 *   (embedded quotes doubled). Pass `alwaysQuote` to quote every field uniformly (the audit trail
 *   does this so a value that later gains a comma can't shift the column count).
 * - **Total**: a value whose `String()` throws degrades to an empty cell rather than failing the
 *   whole export.
 */
export function csvField(v: unknown, alwaysQuote = false): string {
  let s: string;
  try {
    s = v == null ? "" : String(v);
  } catch {
    s = "";
  }
  // A pure signed number (integer, decimal, or scientific) can't be a formula — leave it intact.
  const isNumeric = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
  if (!isNumeric && /^[=+\-@]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
  if (alwaysQuote || /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Canonical CSV table assembly, built on {@link csvField}: a header row (raw column names, never
 * user-supplied so never itself passed through the cell encoder) followed by one line per data row,
 * each cell encoded via csvField, terminated with a single trailing newline. This is the exact
 * "header.join(',') + rows.map(...).join('\n') + '\n'" shape that org/export, org/repositories,
 * history, and usage each hand-rolled separately (G8-35) — extracted so a future export can't drift on
 * quoting/line-ending shape the way org/repositories once drifted on the formula-injection guard.
 *
 * No BOM, no CRLF: every call site this replaces emitted plain "\n"-joined, un-BOM'd text, so this
 * preserves that byte-for-byte (history's route additionally content-hashes the resulting string for an
 * integrity header — unaffected, since it still hashes the same bytes this produces).
 */
export function csvTable(header: readonly string[], rows: readonly unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map((v) => csvField(v)).join(","))].join("\n") + "\n";
}
