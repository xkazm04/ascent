"use client";

// The repositories offered in step 1's "map an existing repo" picker.
//
// Read LAZILY from `/api/app/repos?org=<slug>` — the same installation listing the connect and
// onboarding surfaces use — and only once the user actually opens the map panel. Deliberately NOT
// loaded into `RegistryView` on the server: the tab renders on every visit, the listing costs a live
// GitHub round-trip, and the overwhelming majority of those renders never open the picker.
//
// The route is authorized (`requireOrgRead`) and payload-cached for 30s per org, so reopening the
// panel is free. Failure is not fatal and must not be: the owner/repo text field remains the answer,
// so a 403/404/502 degrades to "type it yourself" rather than to a dead step.

import { useEffect, useMemo, useState } from "react";
import type { RegistryCandidate } from "@/lib/org/registry-view";

/** One row in the picker. A superset of what `/api/app/repos` returns and of `RegistryCandidate`. */
export interface RegistryRepoOption {
  fullName: string;
  private: boolean;
  pushedAt: string | null;
  /** Known only for seeded candidates — the repo listing does not probe file layout. */
  hasLayout?: boolean;
}

export type RegistryRepoOptions =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; repos: RegistryRepoOption[] };

/** Stable identities so a caller's `useMemo` over the returned state is not invalidated every render. */
const IDLE: RegistryRepoOptions = { status: "idle" };

/** Most recently pushed first — the repo someone is about to make their registry is a live one. A
 *  repo already carrying the registry layout outranks recency, because that is a certainty. */
function rank(repos: RegistryRepoOption[]): RegistryRepoOption[] {
  return [...repos].sort(
    (a, b) =>
      Number(Boolean(b.hasLayout)) - Number(Boolean(a.hasLayout)) ||
      (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "") ||
      a.fullName.localeCompare(b.fullName),
  );
}

/**
 * @param slug   the org whose installation is listed.
 * @param enabled  false until the map panel is open — nothing is fetched before that.
 * @param seed   `view.candidates`; when non-empty it IS the answer and no request is made (this is
 *               what keeps a previewed fixture state off the network).
 */
export function useRegistryRepoOptions({
  slug,
  enabled,
  seed,
}: {
  slug: string;
  enabled: boolean;
  seed?: readonly RegistryCandidate[];
}): RegistryRepoOptions {
  const seeded = seed && seed.length > 0 ? seed : null;
  const [state, setState] = useState<RegistryRepoOptions>(IDLE);
  const seededState = useMemo<RegistryRepoOptions | null>(
    () => (seeded ? { status: "done", repos: rank(seeded.map((c) => ({ ...c }))) } : null),
    [seeded],
  );

  useEffect(() => {
    if (!enabled || seeded) return;
    const controller = new AbortController();
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a changed org must not read as the previous org's repos
    setState({ status: "loading" });
    fetch(`/api/app/repos?org=${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { repos?: unknown; error?: unknown };
        if (!active) return;
        if (!r.ok) {
          setState({
            status: "error",
            message: typeof data.error === "string" ? data.error : `Could not list repositories (HTTP ${r.status}).`,
          });
          return;
        }
        const rows = Array.isArray(data.repos) ? (data.repos as Record<string, unknown>[]) : [];
        setState({
          status: "done",
          repos: rank(
            rows
              .filter((r0): r0 is Record<string, unknown> & { fullName: string } => typeof r0.fullName === "string")
              .map((r0) => ({
                fullName: r0.fullName,
                private: r0.private === true,
                pushedAt: typeof r0.pushedAt === "string" ? r0.pushedAt : null,
              })),
          ),
        });
      })
      .catch(() => {
        if (active) setState({ status: "error", message: "Could not reach GitHub to list repositories." });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [slug, enabled, seeded]);

  return seededState ?? (enabled ? state : IDLE);
}
