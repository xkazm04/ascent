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
  if (/^[=+\-@]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
  if (alwaysQuote || /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
