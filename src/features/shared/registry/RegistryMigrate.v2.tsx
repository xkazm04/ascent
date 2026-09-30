"use client";

// One migration PR per artifact type. Hosted mode is a stated reason, not a button.

import { Caption, GhostAction } from "@/components/kit";
import type { RegistryArtifact, RegistryView } from "@/lib/org/registry-view";
import { ARTIFACT_LABEL } from "./registryModel";
import { visibleActions } from "./registryActionRules";
import { RegistryOutcome, RegistryOutbound } from "./RegistryOutcome.v2";
import { num, str, useRegistryMutation } from "./useRegistryMutation";

export function RegistryMigrateV2({
  view,
  artifact,
  step,
  slug,
}: {
  view: RegistryView;
  artifact: RegistryArtifact;
  step: RegistryView["migration"]["skills"];
  slug: string;
}) {
  const m = useRegistryMutation();
  const allowed = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" }).includes("migrate");

  if (step.state === "merged") {
    return (
      <Caption>
        {step.moved}/{step.total} moved
      </Caption>
    );
  }
  if (step.state === "n/a") return <Caption>hosted mode</Caption>;
  if (step.state === "pr-open" && step.prUrl) {
    return <RegistryOutbound href={step.prUrl}>review PR</RegistryOutbound>;
  }
  if (!allowed) {
    return <Caption>{view.status === "unmapped" ? "map a registry first" : "admin only"}</Caption>;
  }

  function migrate() {
    void m.run("migrate", `/api/org/${encodeURIComponent(slug)}/registry/migrate?type=${artifact}`, {
      describe: (d) => {
        if (d.opened !== true) return { message: str(d.message) ?? `No hosted ${ARTIFACT_LABEL[artifact]} to migrate.` };
        const committed = Array.isArray(d.committed) ? d.committed.length : 0;
        return {
          message: `Migration PR #${num(d.prNumber) ?? "?"} opened: ${committed}/${num(d.total) ?? committed} files.`,
          ...(str(d.prUrl) ? { href: str(d.prUrl)!, hrefLabel: "review PR" } : {}),
        };
      },
    });
  }

  return (
    <div className="space-y-1">
      <GhostAction onClick={migrate} disabled={m.pending !== null}>
        {m.pending === "migrate" ? "opening PR\u2026" : "open migration PR"}
      </GhostAction>
      <RegistryOutcome m={m} />
    </div>
  );
}
