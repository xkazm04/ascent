// Reconciles measured per-repo spend against the set AI delivery can actually draw. Pure: no db, no
// React. Delivery draws a row only for a repo with scanned pull-request signals
// (getOrgPrSignals.perRepo) and looks spend up by the lower-cased fullName, so a measured repo outside
// that set is spend that lands nowhere. The join here is that same lower-case join, on purpose.
import type { ImportScanRequest } from "@/components/onboarding/importScan";
import type { AttributionWire } from "@/lib/db/integrations-attribution";

export type { AttributionWire };

export type ReconcileBucket = "landed" | "inFleetNoSignals" | "outsideFleet";
export type ReconcileAction = "none" | "rescan" | "add" | "connect-gitlab";

export interface ReconcileRow {
  repo: string;
  costCents: number;
  bucket: ReconcileBucket;
  action: ReconcileAction;
}

export interface Reconciliation {
  /** none = no measured repo rows at all (unknown, not zero); clear = all of it lands; hidden = some does not. */
  state: "none" | "clear" | "hidden";
  windowTitle: string;
  rows: ReconcileRow[];
  landed: string[];
  inFleetNoSignals: string[];
  outsideFleet: string[];
  totalCostCents: number;
  hiddenCostCents: number;
  /** hidden / total, or null when no measured cost is known. */
  hiddenShare: number | null;
}

export interface ScanPlan {
  request: ImportScanRequest;
  /** Disclosed before the action runs: the number of one-shot scans the owner is asking for. */
  scans: number;
}

const isGitlab = (repo: string) => repo.toLowerCase().startsWith("gitlab:");

export function reconcile(input: Omit<AttributionWire, "windowTitle"> & { windowTitle?: string }): Reconciliation {
  const delivery = new Set(input.deliverySet.map((r) => r.toLowerCase()));
  const fleet = new Set(input.fleet.map((r) => r.toLowerCase()));
  const byKey = new Map<string, { repo: string; costCents: number }>();
  for (const m of input.measured) {
    const key = m.repo.toLowerCase();
    const e = byKey.get(key);
    if (e) e.costCents += m.costCents;
    else byKey.set(key, { repo: m.repo, costCents: m.costCents });
  }
  const rows: ReconcileRow[] = [...byKey.entries()].map(([key, m]) => {
    if (delivery.has(key)) return { ...m, bucket: "landed", action: "none" };
    if (fleet.has(key)) return { ...m, bucket: "inFleetNoSignals", action: "rescan" };
    const action: ReconcileAction = isGitlab(m.repo) && !input.gitlabConnected ? "connect-gitlab" : "add";
    return { ...m, bucket: "outsideFleet", action };
  });
  rows.sort((a, b) => b.costCents - a.costCents || a.repo.localeCompare(b.repo));
  const names = (bucket: ReconcileBucket) => rows.filter((r) => r.bucket === bucket).map((r) => r.repo);
  const totalCostCents = rows.reduce((s, r) => s + r.costCents, 0);
  const hiddenCostCents = rows.filter((r) => r.bucket !== "landed").reduce((s, r) => s + r.costCents, 0);
  const hiddenRows = rows.some((r) => r.bucket !== "landed");
  return {
    state: rows.length === 0 ? "none" : hiddenRows ? "hidden" : "clear",
    windowTitle: input.windowTitle ?? "",
    rows,
    landed: names("landed"),
    inFleetNoSignals: names("inFleetNoSignals"),
    outsideFleet: names("outsideFleet"),
    totalCostCents,
    hiddenCostCents,
    hiddenShare: totalCostCents > 0 ? hiddenCostCents / totalCostCents : null,
  };
}

/**
 * The one-shot scan for the outside-fleet repos that can be scanned now, most hidden cost first.
 * watch:false and schedule:"off": the owner asks for one scan, never a recurring draw. A real scan
 * (mock:false) because a preview would not put the repo on Delivery; the import route keeps its own
 * auth, credit and capacity rules. Null when nothing can be scanned, so the action is disabled.
 */
export function scanPlan(org: string, rows: ReconcileRow[]): ScanPlan | null {
  const repos = rows
    .filter((r) => r.bucket === "outsideFleet" && r.action === "add")
    .sort((a, b) => b.costCents - a.costCents || a.repo.localeCompare(b.repo))
    .map((r) => r.repo);
  if (!repos.length) return null;
  return { request: { org, repos, watch: false, schedule: "off", mock: false }, scans: repos.length };
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The hidden-spend sentence, or null in the none / clear states (no "$0 hidden" claim). */
export function hiddenLine(rec: Reconciliation): string | null {
  if (rec.state !== "hidden") return null;
  const count = rec.rows.filter((r) => r.bucket !== "landed").length;
  const share = rec.hiddenShare === null ? "" : ` (${Math.round(rec.hiddenShare * 100)}%)`;
  const where = plural(count, "repository", "repositories");
  return `${dollars(rec.hiddenCostCents)} of ${dollars(rec.totalCostCents)} measured spend${share} lands on ${where} AI delivery cannot show.`;
}

export function clearLine(rec: Reconciliation): string | null {
  if (rec.state !== "clear") return null;
  return `All ${dollars(rec.totalCostCents)} of measured spend lands on ${plural(rec.landed.length, "repository", "repositories")} AI delivery shows.`;
}

export function remedyText(action: ReconcileAction): string {
  if (action === "rescan") return "In the fleet with no pull-request signals yet: rescan it from Repositories.";
  if (action === "connect-gitlab") return "Connect GitLab first, then it can be scanned.";
  if (action === "add") return "Not in the fleet: scan it to add it.";
  return "Shown on AI delivery.";
}

export function scanLabel(plan: ScanPlan): string {
  return `Scan ${plural(plan.scans, "repository", "repositories")}`;
}

/** Said before the button runs: what it costs and what it does not subscribe the org to. */
export function scanDisclosure(plan: ScanPlan): string {
  return `One-shot scan: not watched and not scheduled. Uses 1 scan credit per repository, ${plan.scans} in all, from this organization's monthly allowance or prepaid credits, under the same rules as any import.`;
}

/** The ladder's read of the reconciliation: null when there is nothing to judge by. */
export function ladderAttribution(wire: AttributionWire | null | undefined): { landed: boolean; detail: string } | null {
  if (!wire) return null;
  const rec = reconcile(wire);
  if (rec.state === "none") return null;
  if (rec.landed.length > 0) {
    const more = rec.state === "hidden" ? ` ${dollars(rec.hiddenCostCents)} more lands where it cannot.` : "";
    return { landed: true, detail: `Telemetry landed on a repository AI delivery shows.${more}` };
  }
  return { landed: false, detail: `Received, but ${dollars(rec.hiddenCostCents)} of measured spend lands on repositories AI delivery cannot show.` };
}
