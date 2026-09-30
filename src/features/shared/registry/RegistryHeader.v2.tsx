"use client";

// Indexed-state header: re-index, the repo, or the capability note when those are the only ways in.

import { GhostAction } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { visibleActions } from "./registryActionRules";
import { RegistryCapability, RegistryPairLink } from "./RegistryCapability.v2";
import { RegistryOutcome, RegistryOutbound } from "./RegistryOutcome.v2";
import { num, str, useRegistryMutation } from "./useRegistryMutation";

export function RegistryHeader({ view, slug }: { view: RegistryView; slug: string }) {
  const m = useRegistryMutation();
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });

  function reindex() {
    void m.run("reindex", `/api/org/${encodeURIComponent(slug)}/registry/index`, {
      describe: (d) => {
        const c = (d.counts ?? {}) as Record<string, unknown>;
        const sha = str(d.headSha);
        const warnings = Array.isArray(d.warnings) ? d.warnings.length : 0;
        return {
          message: `Indexed at ${sha ? sha.slice(0, 7) : "HEAD"}: ${num(c.skills) ?? 0} skills · ${num(c.practices) ?? 0} practices · ${num(c.memory) ?? 0} notes${warnings ? ` · ${warnings} file${warnings === 1 ? "" : "s"} skipped` : ""}`,
          ...(view.registry && sha && !view.registry.localPath ? { href: `${view.registry.url}/tree/${sha}`, hrefLabel: "view tree" } : {}),
        };
      },
    });
  }

  if (!actions.some((a) => a !== "install-app" && a !== "pair-local")) {
    return <RegistryCapability view={view} slug={slug} />;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("pair-local") ? <RegistryPairLink slug={slug} /> : null}
        {actions.includes("reindex") ? (
          <GhostAction onClick={reindex} disabled={m.pending !== null}>
            {m.pending === "reindex" ? "Re-indexing\u2026" : "Re-index"}
          </GhostAction>
        ) : null}
        {actions.includes("open-repo") && view.registry ? (
          <RegistryOutbound href={view.registry.url}>Open on GitHub</RegistryOutbound>
        ) : null}
      </div>
      <RegistryOutcome m={m} />
    </div>
  );
}
