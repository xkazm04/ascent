import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/auth";
import { resolveInstallView } from "./installRouting";

// Pins the install-routing derivation extracted from connect/page.tsx (finding #4): for an
// `?org=&installation_id=` arriving from the GitHub install redirect, decide whether to render a live
// <InstallationRepos> panel (org in `installs`) or a "Finish connecting / Re-sync" prompt
// (`pendingInstall`). The headline invariant: when auth is ON and the org isn't yet in the session, the
// org must NEVER appear in `installs` (else /api/app/repos 403s the panel) — it surfaces as
// `pendingInstall` instead. Auth-off pushes the query-carried org directly.

function session(installations: Session["installations"]): Session {
  return { login: "me", installations, exp: 0 };
}

describe("resolveInstallView", () => {
  it("org already in session (matched by login) → panel renders, no pendingInstall", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "acme" }]),
      org: "acme",
      installationId: undefined,
      authConfigured: true,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs.map((i) => i.login)).toContain("acme");
  });

  it("login match is case-insensitive", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "Acme" }]),
      org: "acme",
      installationId: undefined,
      authConfigured: true,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs).toHaveLength(1);
  });

  it("installation_id match is exact (id present takes precedence over login)", () => {
    // Same login, but a different installation_id → NOT in session: must be pending under auth.
    const view = resolveInstallView({
      session: session([{ id: 1, login: "acme" }]),
      org: "acme",
      installationId: "999",
      authConfigured: true,
    });
    expect(view.pendingInstall).toBe("acme");
    // Auth-ON never pushes the query org; installs equal the session's installations verbatim (the
    // login `acme` present here is the session's own entry, id "1" — not the unmatched query install).
    expect(view.installs).toEqual([{ login: "acme", id: "1" }]);

    // Matching installation_id → in session, panel renders.
    const matched = resolveInstallView({
      session: session([{ id: 1, login: "acme" }]),
      org: "acme",
      installationId: "1",
      authConfigured: true,
    });
    expect(matched.pendingInstall).toBeNull();
    expect(matched.installs.map((i) => i.id)).toContain("1");
  });

  it("auth ON + org NOT in session → pendingInstall set, org NEVER pushed into installs", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "other" }]),
      org: "acme",
      installationId: "42",
      authConfigured: true,
    });
    expect(view.pendingInstall).toBe("acme");
    // INVARIANT: authConfigured && !orgInSession ⇒ org absent from installs (no 403-prone panel).
    expect(view.installs.map((i) => i.login)).not.toContain("acme");
    expect(view.installs.map((i) => i.login)).toEqual(["other"]);
  });

  it("auth OFF + org NOT in session → org pushed into installs, no pendingInstall", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "other" }]),
      org: "acme",
      installationId: "42",
      authConfigured: false,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs).toContainEqual({ login: "acme", id: "42" });
  });

  it("auth OFF with no session → query-carried org becomes the sole install", () => {
    const view = resolveInstallView({
      session: null,
      org: "acme",
      installationId: undefined,
      authConfigured: false,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs).toEqual([{ login: "acme", id: undefined }]);
  });

  it("no org param → orgInSession is true, nothing pending, installs mirror the session", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "acme" }, { id: 2, login: "globex" }]),
      org: undefined,
      installationId: undefined,
      authConfigured: true,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs).toEqual([
      { login: "acme", id: "1" },
      { login: "globex", id: "2" },
    ]);
  });

  it("multiple installations, query org matches one of them → panel renders, no pending", () => {
    const view = resolveInstallView({
      session: session([{ id: 1, login: "acme" }, { id: 2, login: "globex" }]),
      org: "globex",
      installationId: undefined,
      authConfigured: true,
    });
    expect(view.pendingInstall).toBeNull();
    expect(view.installs).toHaveLength(2);
  });
});
