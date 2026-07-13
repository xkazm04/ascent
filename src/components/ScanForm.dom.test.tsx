// @vitest-environment jsdom
//
// scan-pipeline-ingestion #3: a client-side validation error ("Enter a GitHub repo as owner/repo…")
// appears only AFTER a submit, with focus still on the input/Scan button. A bare <p> in the a11y tree
// is never announced on insertion, so a screen-reader user got the shake animation with no idea WHY the
// scan didn't start. These pin the two things that make it audible: the message is a live alert
// (role="alert"), and it stays programmatically associated with the field (aria-describedby + aria-invalid).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// The notify slot pulls in auth chrome irrelevant to the validation path; stub it to nothing.
vi.mock("@/components/scan/NotifyToggle", () => ({ NotifyToggle: () => null }));

import { ScanForm } from "./ScanForm";

beforeEach(() => {
  push.mockClear();
  // The mount effect probes /api/auth/viewer; there is no server here, so reject and let its .catch swallow.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no viewer in test")));
  // submit() re-arms the shake via rAF; run it synchronously so the error state is settled by assert time.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScanForm validation error accessibility", () => {
  it("has no alert before the user submits — nothing is announced until there is an error", () => {
    render(<ScanForm showExamples={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    const input = screen.getByRole("textbox", { name: /github repository/i });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("announces an un-coercible repo as a live alert AND links it to the input, without navigating", () => {
    render(<ScanForm showExamples={false} />);
    const input = screen.getByRole("textbox", { name: /github repository/i });

    // A single bare word can't be coerced to owner/repo → validation fails.
    fireEvent.change(input, { target: { value: "not-a-repo" } });
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));

    // The message is exposed through the accessibility tree as a live alert, not silent decorative text.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/owner\/repo/i);

    // …and it is programmatically tied to the field: a SR user focused on the input hears WHY it's invalid.
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);

    // Invalid input must not have kicked off a scan navigation.
    expect(push).not.toHaveBeenCalled();
  });

  it("clears the alert and the invalid state once the field is edited again", () => {
    render(<ScanForm showExamples={false} />);
    const input = screen.getByRole("textbox", { name: /github repository/i });

    fireEvent.change(input, { target: { value: "not-a-repo" } });
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Typing dismisses the error (onChange clears it), so the alert region goes away too.
    fireEvent.change(input, { target: { value: "facebook/react" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
