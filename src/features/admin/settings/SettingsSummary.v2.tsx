// The Prism Settings masthead and the ruled "account" rows. The masthead states where inference runs now
// (the one answer an owner opens this tab for); the rows below it are the first real use of the kit's
// SettingRow: plan, secret encryption, retention. Server-safe: the plan switcher is a client component
// passed in as the row's control.
import { Frame, Masthead, SectionHead, SettingRow, type MastheadFigure } from "@/components/kit";
import { PlanControl } from "./PlanControl";
import type { SettingsData } from "./settingsData";

function inferenceFigures(d: SettingsData): { statement: string; figures: MastheadFigure[] } {
  const lanes = d.laneRouting?.current ?? null;
  const yours = lanes ? lanes.filter((l) => l.account === "yours").length : null;
  const platform = lanes ? lanes.filter((l) => l.account === "platform").length : null;
  const byom = d.config?.enabled ? d.config.provider : null;
  return {
    statement: byom ? `Inference runs on your ${byom} account` : "Inference runs on the Ascent platform",
    figures: [
      { label: "Plan", value: d.plan.charAt(0).toUpperCase() + d.plan.slice(1) },
      {
        label: "Provider",
        value: byom ?? "Ascent",
        detail: byom ? "Your connected account" : d.planAllowed ? "No provider connected" : "Connecting your own needs the Custom plan",
      },
      lanes
        ? { label: "Lanes on the platform", value: `${platform} of ${lanes.length}`, detail: yours ? `${yours} on your account` : "None on your account" }
        : { label: "Lanes on the platform", value: "Unread", detail: "Lane routing could not be read" },
    ],
  };
}

export function SettingsMastheadV2({ d }: { d: SettingsData }) {
  const { statement, figures } = inferenceFigures(d);
  return <Masthead eyebrow="Admin · owner only" statement={statement} lede="Where scans and lanes run, what the organization keeps, and what it can erase." figures={figures} pattern="dots" />;
}

// Called as a function by settingsV2 (not rendered as an element) so PlanControl stays visible to the placement tests.
export function settingsAccountV2(d: SettingsData) {
  return (
    <Frame id="account" pattern="dots" aria-label="Account">
      <SectionHead eyebrow="Account" title="Plan and keys," named="at a glance." level="section" />
      <div className="mt-4">
        <SettingRow
          label="Plan"
          description="The tier sets the monthly scan allowance and whether you can connect your own model."
          status={d.planChangesEnabled ? "Manual tier changes are on for this deployment." : undefined}
          control={<PlanControl org={d.slug} plan={d.plan} enabled={d.planChangesEnabled} portalEnabled={d.portalEnabled} />}
        />
        <SettingRow
          label="Secret encryption"
          description="Provider credentials are stored encrypted, or not at all."
          control={<span className="type-body-sm text-slate-200">{d.encryptionConfigured ? "✓ Configured" : "✕ Not configured"}</span>}
          status={d.encryptionConfigured ? undefined : "Set ENCRYPTION_KEY to store credentials."}
        />
        <SettingRow
          label="Retention policy"
          description="How long scans and audit entries are kept."
          control={<a href="#retention" className="type-body-sm text-slate-200 underline underline-offset-4">Jump to retention</a>}
        />
      </div>
    </Frame>
  );
}
