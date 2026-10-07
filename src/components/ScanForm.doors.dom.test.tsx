// @vitest-environment jsdom
//
// ScanForm probes /api/auth/viewer on mount to decide whether to offer the "email me the report link"
// opt-in. When that read fails the toggle stays hidden — the safe degrade, and it must not change. The
// door sweep only took away the silence: a rejected read now reaches a console.warn naming it, so a
// hidden toggle on a signed-in session is explained instead of looking like a signed-out answer. The
// quiet twin is pinned too: a genuine signed-out answer hides the same toggle WITHOUT a warn.
//
// Harness follows ScanForm.dom.test.tsx, except NotifyToggle is the REAL one (auth unset, so its
// signed-out branch renders nothing and the signed-in branch is a labelled checkbox we can look for).

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ScanForm } from "./ScanForm";

const NETWORK = new TypeError("Failed to fetch");
const TOGGLE = /email me the report link/i;
const viewerReply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let warn: MockInstance<typeof console.warn>;
const formWarns = () => warn.mock.calls.filter((c) => String(c[0]).startsWith("[scan form]"));
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  push.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScanForm doors — the viewer read (the notify toggle)", () => {
  it("a rejected viewer read keeps the notify toggle hidden and warns naming the read", async () => {
    const fetchMock = vi.fn().mockRejectedValue(NETWORK);
    vi.stubGlobal("fetch", fetchMock);
    render(<ScanForm showExamples={false} />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[scan form] viewer read failed; hiding the notify toggle:", NETWORK),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/viewer");
    expect(screen.queryByRole("checkbox", { name: TOGGLE })).toBeNull();
    // The form itself is untouched by the failed probe.
    expect(screen.getByRole("textbox", { name: /repository/i })).toBeInTheDocument();
  });

  it("a 200 whose body is unreadable takes the same door", async () => {
    const badBody = new SyntaxError("Unexpected end of JSON input");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(badBody) } as unknown as Response),
    );
    render(<ScanForm showExamples={false} />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[scan form] viewer read failed; hiding the notify toggle:", badBody),
    );
    expect(screen.queryByRole("checkbox", { name: TOGGLE })).toBeNull();
  });

  it("an HTTP 500 from the viewer route (it always answers 200) takes the same door", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(viewerReply({ error: "boom" }, 500)));
    render(<ScanForm showExamples={false} />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[scan form] viewer read failed; hiding the notify toggle:",
        expect.objectContaining({ message: "viewer read failed: HTTP 500" }),
      ),
    );
    expect(screen.queryByRole("checkbox", { name: TOGGLE })).toBeNull();
  });

  it("twin: a signed-out answer hides the same toggle with NO warn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(viewerReply({ signedIn: false, email: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ScanForm showExamples={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole("checkbox", { name: TOGGLE })).toBeNull();
    expect(formWarns()).toEqual([]);
  });

  it("control: a signed-in viewer with an email gets the toggle, quietly — so its absence above is the degrade", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(viewerReply({ signedIn: true, email: "dev@example.com" })));
    render(<ScanForm showExamples={false} />);

    expect(await screen.findByRole("checkbox", { name: TOGGLE })).toBeInTheDocument();
    expect(formWarns()).toEqual([]);
  });
});
