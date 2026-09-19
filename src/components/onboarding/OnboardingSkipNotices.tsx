import { countSkips, type ImportNotice } from "@/components/onboarding/skipReason";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";

// The done screen's "what didn't get scanned, and what do I do about it" disclosures.
//
// One banner used to cover every case: "N repositories were skipped (out of credits). Top up your
// prepaid balance." That is right for exactly one of the three reasons the server actually reports.
// A public-funnel user who ran out of FREE monthly scans was told to top up a prepaid balance the
// select step had just promised they wouldn't need; a repo skipped because another run already held
// its claim was reported as a billing failure and would "recover" on its own a minute later.
//
// Extracted into its own file (rather than growing OnboardingScanStep.tsx, at 253 of its 300-LOC cap)
// so the copy lives beside the vocabulary it uses. No hooks or handlers here — deliberately NOT a
// client component, so it can render inside a server tree unchanged.

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 type-body-sm text-amber-300">
      {children}
    </p>
  );
}

/** "1 repository was" / "3 repositories were" — the subject every banner below opens with. */
function repos(n: number) {
  return `${n} ${n === 1 ? "repository was" : "repositories were"}`;
}

/** Per-reason banners for the rows this run did not scan, plus any batch-level notice that isn't
 *  represented by a row at all. Renders nothing when everything scanned. */
export function SkipNotices({ rows, notices = [] }: { rows: Record<string, ScanRow>; notices?: ImportNotice[] }) {
  const counts = countSkips(Object.values(rows));
  const credits = counts.insufficient_credits ?? 0;
  const quota = counts.monthly_quota ?? 0;
  const inProgress = counts.in_progress ?? 0;
  const notScanned = counts.not_scanned ?? 0;
  // Batch-level notices with no per-row expression. `listing_truncated` only ever fires on a
  // server-side listing (the wizard always sends an explicit repo list), but surfacing it costs
  // nothing and silence would be the same failure this whole change is about.
  const truncated = notices.find((n) => n.reason === "listing_truncated");
  const tooMany = notices.find((n) => n.reason === "too_many_repos" && n.skipped > 0);

  return (
    <>
      {credits > 0 && (
        <Banner>
          {repos(credits)} <strong>skipped: out of credits</strong>. Top up your prepaid balance, then
          scan the rest from the dashboard.
        </Banner>
      )}
      {quota > 0 && (
        <Banner>
          {repos(quota)} <strong>skipped: you&apos;ve used this month&apos;s free scans</strong>. Nothing was
          charged. The allowance resets next month, or you can install the GitHub App and scan with credits now.
        </Banner>
      )}
      {inProgress > 0 && (
        <Banner>
          {repos(inProgress)} <strong>already being scanned</strong> by another run, so this one left them
          alone (no double charge). Their results land on the dashboard when that run finishes.
        </Banner>
      )}
      {notScanned > 0 && (
        // The server ended the stream without reporting these and without a reason we can attribute.
        // Say exactly that — a guess ("out of credits") is what made the old banner misleading.
        <Banner>
          {repos(notScanned)} <strong>not scanned</strong> and the server gave no reason. Nothing was charged
          for them; you can retry them from the dashboard.
        </Banner>
      )}
      {tooMany && (
        <Banner>
          Only the first {tooMany.scanning} repositories of this batch were scanned ({tooMany.skipped} over the
          per-import limit). Scan the rest from the dashboard.
        </Banner>
      )}
      {truncated && (
        <Banner>
          This account has more repositories than one listing pass could read, so the scan covered the first{" "}
          {truncated.scanning}. The dashboard can scan the rest.
        </Banner>
      )}
    </>
  );
}
