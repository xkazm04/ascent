// Pins every redirect of GET /api/app/setup, the GitHub App post-install "Setup URL". The route writes
// an owner -> installation mapping that every later token mint and webhook owner check trusts, so who
// may write it, and what gets written, is the security surface: the login stored is the one GitHub
// resolves for the installation (never a query param), and with auth on only the account itself or a
// GitHub-confirmed org admin may store it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { redirect: (url: URL) => Response.redirect(url, 307) },
}));

const m = vi.hoisted(() => ({
  isAppConfigured: vi.fn(() => true),
  getInstallation: vi.fn(),
  isOrgAdminViaInstallation: vi.fn(),
  isAuthConfigured: vi.fn(() => false),
  authGateEnabled: vi.fn(() => true),
  resolveViewerLogin: vi.fn(),
  upsertInstallation: vi.fn(),
}));

vi.mock("@/lib/github/app", () => ({
  isAppConfigured: m.isAppConfigured,
  getInstallation: m.getInstallation,
  isOrgAdminViaInstallation: m.isOrgAdminViaInstallation,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: m.isAuthConfigured }));
vi.mock("@/lib/access", () => ({ authGateEnabled: m.authGateEnabled, resolveViewerLogin: m.resolveViewerLogin }));
vi.mock("@/lib/db", () => ({ upsertInstallation: m.upsertInstallation }));

import { GET } from "./route";

async function setup(query: string): Promise<URL> {
  const res = await GET(new Request(`https://ascent.example/api/app/setup${query}`));
  expect(res.status).toBe(307);
  return new URL(res.headers.get("location")!);
}

const errorOf = (u: URL) => (u.pathname === "/onboarding" ? u.searchParams.get("error") : `not onboarding: ${u.pathname}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.isAppConfigured.mockReturnValue(true);
  m.isAuthConfigured.mockReturnValue(false);
  m.authGateEnabled.mockReturnValue(true);
  m.resolveViewerLogin.mockResolvedValue("octocat");
  m.getInstallation.mockResolvedValue({ id: 42, account: "Acme", type: "Organization", suspendedAt: null });
  m.isOrgAdminViaInstallation.mockResolvedValue(true);
  m.upsertInstallation.mockResolvedValue(undefined);
});

describe("GET /api/app/setup — refusals", () => {
  it("not_configured when the App env is absent, before anything else runs", async () => {
    m.isAppConfigured.mockReturnValue(false);
    expect(errorOf(await setup("?installation_id=42&setup_action=install"))).toBe("not_configured");
    expect(m.resolveViewerLogin).not.toHaveBeenCalled();
    expect(m.getInstallation).not.toHaveBeenCalled();
  });

  it("missing_installation when installation_id is absent", async () => {
    expect(errorOf(await setup("?setup_action=install"))).toBe("missing_installation");
    expect(m.getInstallation).not.toHaveBeenCalled();
  });

  it("auth_required when the auth gate is on and there is no viewer: no GitHub round-trip, no write", async () => {
    m.resolveViewerLogin.mockResolvedValue(null);
    expect(errorOf(await setup("?installation_id=42"))).toBe("auth_required");
    expect(m.getInstallation).not.toHaveBeenCalled();
    expect(m.upsertInstallation).not.toHaveBeenCalled();
  });

  it("auth_required under the custom-OAuth stack alone (gate off, isAuthConfigured on)", async () => {
    m.authGateEnabled.mockReturnValue(false);
    m.isAuthConfigured.mockReturnValue(true);
    m.resolveViewerLogin.mockResolvedValue(null);
    expect(errorOf(await setup("?installation_id=42"))).toBe("auth_required");
    expect(m.getInstallation).not.toHaveBeenCalled();
  });

  it("forbidden when the viewer is neither the account nor a confirmed admin", async () => {
    m.resolveViewerLogin.mockResolvedValue("mallory");
    m.isOrgAdminViaInstallation.mockResolvedValue(false);
    expect(errorOf(await setup("?installation_id=42"))).toBe("forbidden");
    expect(m.isOrgAdminViaInstallation).toHaveBeenCalledWith("42", "Acme", "mallory");
    expect(m.upsertInstallation).not.toHaveBeenCalled();
  });

  it("forbidden when the admin check throws: an error is not an authorization", async () => {
    m.resolveViewerLogin.mockResolvedValue("mallory");
    m.isOrgAdminViaInstallation.mockRejectedValue(new Error("GitHub 502"));
    expect(errorOf(await setup("?installation_id=42"))).toBe("forbidden");
    expect(m.upsertInstallation).not.toHaveBeenCalled();
  });

  it("setup_failed when getInstallation throws, with nothing written", async () => {
    m.getInstallation.mockRejectedValue(new Error("GitHub App API 404"));
    expect(errorOf(await setup("?installation_id=42"))).toBe("setup_failed");
    expect(m.upsertInstallation).not.toHaveBeenCalled();
  });

  it("setup_failed when the upsert throws", async () => {
    m.upsertInstallation.mockRejectedValue(new Error("db down"));
    expect(errorOf(await setup("?installation_id=42"))).toBe("setup_failed");
  });
});

describe("GET /api/app/setup — success", () => {
  it("the account itself (any casing) stores GitHub's resolved login and redirects with org + installation_id", async () => {
    m.resolveViewerLogin.mockResolvedValue("acme");
    const dest = await setup("?installation_id=42&setup_action=install&org=victim");
    expect(m.isOrgAdminViaInstallation).not.toHaveBeenCalled();
    expect(m.upsertInstallation).toHaveBeenCalledWith({ login: "Acme", installationId: "42" });
    expect(dest.origin).toBe("https://ascent.example");
    expect(dest.pathname).toBe("/onboarding");
    expect(dest.searchParams.get("org")).toBe("Acme"); // GitHub's answer, never the ?org= param
    expect(dest.searchParams.get("installation_id")).toBe("42");
    expect(dest.searchParams.get("error")).toBeNull();
  });

  it("a GitHub-confirmed org admin may store the mapping", async () => {
    m.resolveViewerLogin.mockResolvedValue("octocat");
    const dest = await setup("?installation_id=42");
    expect(m.isOrgAdminViaInstallation).toHaveBeenCalledWith("42", "Acme", "octocat");
    expect(m.upsertInstallation).toHaveBeenCalledWith({ login: "Acme", installationId: "42" });
    expect(dest.searchParams.get("org")).toBe("Acme");
  });

  it("with no auth stack at all the prior open behaviour holds: no viewer, no ownership check", async () => {
    m.authGateEnabled.mockReturnValue(false);
    m.isAuthConfigured.mockReturnValue(false);
    const dest = await setup("?installation_id=42");
    expect(m.resolveViewerLogin).not.toHaveBeenCalled();
    expect(m.isOrgAdminViaInstallation).not.toHaveBeenCalled();
    expect(m.upsertInstallation).toHaveBeenCalledWith({ login: "Acme", installationId: "42" });
    expect(dest.searchParams.get("installation_id")).toBe("42");
  });
});

// Codebase security scan (2026-10-09): installation_id went into the GitHub API path and into the
// stored mapping unvalidated. fetch() resolves `..` segments and drops `#…`, so a value such as
// `42%3Fx` resolved to installation 42 for the ownership check, then stored the raw string `42?x` as
// the org's install id: every later token mint for that org then POSTs to the wrong path, and the
// webhook's stored-mapping check fails closed on every delivery. With no auth stack, any caller could
// do that to any org. A GitHub installation id is a positive integer; anything else is refused.
describe("GET /api/app/setup — installation_id must be a GitHub installation id", () => {
  it.each([
    ["42%3Fx", "a query smuggled into the API path"],
    ["42%23frag", "a fragment that fetch() drops"],
    ["..%2F..%2Fapp", "dot segments that fetch() resolves"],
    ["42%2F", "a trailing slash"],
    ["-42", "a negative number"],
    ["0", "zero"],
    ["4e2", "an exponent"],
    [" 42", "whitespace"],
  ])("refuses %s (%s) as missing_installation, with no GitHub call and no write", async (raw) => {
    m.authGateEnabled.mockReturnValue(false); // the open mode, where nothing else stands in the way
    expect(errorOf(await setup(`?installation_id=${raw}`))).toBe("missing_installation");
    expect(m.getInstallation).not.toHaveBeenCalled();
    expect(m.upsertInstallation).not.toHaveBeenCalled();
  });
});
