// @vitest-environment jsdom
// The report-foot CTA branches on the effective viewer (/api/auth/viewer). An unknown viewer reads as
// signed out — the sign-in funnel is the safe default, and that degrade must not change. The door
// sweep only took away the silence: a rejected read now reaches a console.warn naming it, so a
// signed-in viewer shown the sign-in CTA is explained instead of indistinguishable from a real
// signed-out answer. The quiet twin is pinned too: a genuine signed-out answer renders the same CTA
// WITHOUT a warn.
//
// Harness follows ReportConversionCta.dom.test.tsx (next/link stub, per-URL fetch stub).

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ReportConversionCta } from "@/components/report/ReportConversionCta";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const NETWORK = new TypeError("Failed to fetch");
const REPO = "sindresorhus/slugify";

/** Only the viewer probe is expected; anything else (e.g. a stray /api/me/watch) is a test failure. */
function stubViewer(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/auth/viewer")) return answer();
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The signed-out funnel: its kicker, the sign-in link, and no individual-tier track button. */
function expectSignedOutCta() {
  expect(screen.getByTestId("report-conversion-cta")).toBeInTheDocument();
  expect(screen.getByText("Make this more than a one-off")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /sign in to track over time/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /track this repo/i })).toBeNull();
}

let warn: MockInstance<typeof console.warn>;
const ctaWarns = () => warn.mock.calls.filter((c) => String(c[0]).startsWith("[report cta]"));
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportConversionCta doors — the viewer read", () => {
  it("a rejected viewer read renders the signed-out CTA and warns naming the read", async () => {
    stubViewer(() => {
      throw NETWORK;
    });
    render(<ReportConversionCta repo={REPO} />);

    await screen.findByTestId("report-conversion-cta");
    expectSignedOutCta();
    expect(warn).toHaveBeenCalledWith("[report cta] viewer read failed; showing the signed-out CTA:", NETWORK);
  });

  it("a 200 whose body is unreadable takes the same door", async () => {
    const badBody = new SyntaxError("Unexpected end of JSON input");
    stubViewer(() => ({ ok: true, status: 200, json: () => Promise.reject(badBody) }) as unknown as Response);
    render(<ReportConversionCta repo={REPO} />);

    await screen.findByTestId("report-conversion-cta");
    expectSignedOutCta();
    expect(warn).toHaveBeenCalledWith("[report cta] viewer read failed; showing the signed-out CTA:", badBody);
  });

  it("an HTTP 500 from the viewer route (it always answers 200) takes the same door", async () => {
    stubViewer(() => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    render(<ReportConversionCta repo={REPO} />);

    await screen.findByTestId("report-conversion-cta");
    expectSignedOutCta();
    expect(warn).toHaveBeenCalledWith(
      "[report cta] viewer read failed; showing the signed-out CTA:",
      expect.objectContaining({ message: "viewer read failed: HTTP 500" }),
    );
  });

  it("twin: a genuine signed-out answer renders the same CTA with NO warn", async () => {
    stubViewer(() => new Response(JSON.stringify({ signedIn: false }), { status: 200 }));
    render(<ReportConversionCta repo={REPO} />);

    await screen.findByTestId("report-conversion-cta");
    await settle();
    expectSignedOutCta();
    expect(ctaWarns()).toEqual([]);
  });

  it("control: a signed-in answer gets the fleet CTA, quietly — so the funnel above is the degrade", async () => {
    stubViewer(() => new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    render(<ReportConversionCta repo={REPO} />);

    expect(await screen.findByRole("button", { name: /track this repo/i })).toBeInTheDocument();
    expect(screen.getByText("Go fleet-wide")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("link", { name: /sign in to track over time/i })).toBeNull());
    expect(ctaWarns()).toEqual([]);
  });
});
