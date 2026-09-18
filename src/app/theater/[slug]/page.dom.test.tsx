// @vitest-environment jsdom
//
// /theater/<slug> gives the SAME outcome as an org page for a viewer who may not watch it — the org
// shell's gates, in its order — renders the theater shell for one who may, and renders the fixture for
// `?demo=` without reading anything about the org (so without the gates).

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ db: true, gate: false, viewer: null as { login: string } | null, authConfigured: false, session: null as unknown, canRead: true }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => env.db }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => env.gate, getViewer: async () => env.viewer }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => env.authConfigured, getSessionState: async () => ({ session: env.session, status: "none" }) }));
vi.mock("@/lib/authz", () => ({ canReadOrg: vi.fn(async () => env.canRead) }));
vi.mock("@/components/Brand", () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock("@/components/SignInNotice", () => ({ SignInNotice: (p: { next: string }) => <div data-testid="sign-in">{p.next}</div> }));
vi.mock("@/components/org/shared/ui", () => ({ OrgEmpty: (p: { title: string }) => <div data-testid="org-empty">{p.title}</div> }));
vi.mock("@/features/inflight/live/theater/TheaterShell", () => ({
  TheaterShell: (p: { source: { kind: string; scenario?: string }; soundPreselect?: boolean; heroId?: string | null }) => (
    <div data-testid="theater">{`${p.source.kind}:${p.source.scenario ?? ""}:${p.soundPreselect ? "sound" : "quiet"}:${p.heroId ?? ""}`}</div>
  ),
}));

const { canReadOrg } = await import("@/lib/authz");
const { default: TheaterPage } = await import("./page");
const open = async (slug: string, sp: Record<string, string> = {}) =>
  render(<>{await TheaterPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) })}</>);

beforeEach(() => {
  Object.assign(env, { db: true, gate: false, viewer: null, authConfigured: false, session: null, canRead: true });
  vi.mocked(canReadOrg).mockClear();
});

describe("/theater/[slug]", () => {
  it("renders the theater for a viewer who may read the org, carrying ?sound=1 and ?hero=", async () => {
    await open("acme", { sound: "1", hero: "orbit" });
    expect(screen.getByTestId("theater")).toHaveTextContent("org::sound:orbit");
    expect(screen.queryByTestId("site-header")).toBeNull(); // chrome-less
  });

  it("a signed-out viewer behind the login wall gets the org pages' sign-in, returning to the theater", async () => {
    env.gate = true;
    await open("acme");
    expect(screen.getByTestId("sign-in")).toHaveTextContent("/theater/acme");
    expect(screen.queryByTestId("theater")).toBeNull();
  });

  it("the retired session stack without a session gets the same sign-in", async () => {
    env.authConfigured = true;
    await open("acme");
    expect(screen.getByTestId("sign-in")).toHaveTextContent("/theater/acme");
  });

  it("a foreign org (canReadOrg false) gets the org pages' 'No access', never the theater", async () => {
    env.canRead = false;
    await open("someone-else");
    expect(screen.getByTestId("org-empty")).toHaveTextContent("No access to someone-else");
    expect(canReadOrg).toHaveBeenCalledWith("someone-else");
    expect(screen.queryByTestId("theater")).toBeNull();
  });

  it("no database: the same calm notice, not a broken theater", async () => {
    env.db = false;
    await open("acme");
    expect(screen.getByTestId("org-empty")).toHaveTextContent("Theater needs a database");
  });

  it("?demo= renders the fixture scenario and reads nothing about the org", async () => {
    env.db = false;
    env.gate = true;
    await open("anything", { demo: "paused-spend" });
    expect(screen.getByTestId("theater")).toHaveTextContent("demo:paused-spend:quiet:");
    expect(canReadOrg).not.toHaveBeenCalled();
    await open("anything", { demo: "1" });
    expect(screen.getAllByTestId("theater")[1]).toHaveTextContent("demo:running");
  });
});
