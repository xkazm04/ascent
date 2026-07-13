// @vitest-environment jsdom
// Pins the individual-tier "Track this repo" exit on the report CTA (Phase 5.1):
//   • signed-in + repo → the track button renders beside the org CTA; clicking it POSTs the repo to
//     /api/me/watch and flips to an "In your workspace →" link into /me (the lens: a pointer write,
//     no re-scan).
//   • an API refusal (cap reached / not public) surfaces the server's message and re-arms the button.
//   • signed-out viewers keep the original two-path funnel (no track button).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportConversionCta } from "@/components/report/ReportConversionCta";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

function mockFetch(opts: { signedIn: boolean; watchStatus?: number; watchBody?: unknown }) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/auth/viewer")) {
      return new Response(JSON.stringify({ signedIn: opts.signedIn }), { status: 200 });
    }
    if (u.includes("/api/me/watch")) {
      return new Response(JSON.stringify(opts.watchBody ?? { ok: true }), { status: opts.watchStatus ?? 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("ReportConversionCta — Track this repo (individual tier)", () => {
  it("signed-in: tracks the repo via /api/me/watch and flips to a workspace link", async () => {
    const fetchMock = mockFetch({ signedIn: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportConversionCta repo="sindresorhus/slugify" />);

    const btn = await screen.findByRole("button", { name: /track this repo/i });
    fireEvent.click(btn);

    const link = await screen.findByRole("link", { name: /in your workspace/i });
    expect(link).toHaveAttribute("href", "/me");
    const watchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/me/watch"))!;
    expect(JSON.parse((watchCall[1] as RequestInit).body as string)).toEqual({
      repo: "sindresorhus/slugify",
      watched: true,
    });
  });

  it("surfaces the API's refusal (e.g. the free cap's 402) and re-arms the button", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ signedIn: true, watchStatus: 402, watchBody: { error: "Personal watchlists are capped at 10 repositories." } }),
    );
    render(<ReportConversionCta repo="sindresorhus/slugify" />);

    fireEvent.click(await screen.findByRole("button", { name: /track this repo/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/capped at 10/i);
    expect(screen.getByRole("button", { name: /track this repo/i })).toBeEnabled();
  });

  it("signed-out: no track button — the original sign-in funnel renders instead", async () => {
    vi.stubGlobal("fetch", mockFetch({ signedIn: false }));
    render(<ReportConversionCta repo="sindresorhus/slugify" />);

    expect(await screen.findByRole("link", { name: /sign in to track over time/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /track this repo/i })).toBeNull());
  });
});
