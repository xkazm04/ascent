// @vitest-environment jsdom
//
// scan-pipeline-ingestion 2026-07-16 #1: a signed-in viewer whose GitHub account exposes NO email used
// to be shown the "Email me when it's done" checkbox plus a custom-address field — but the stream
// route's open-relay hardening only ever sends to the viewer's own verified account address, silently
// dropping a client-supplied one. The promised completion email never sent. These pin the honest UI:
// no opt-in is offered when there is no address the server would actually use, and the replacement copy
// explains why; the opt-in still works normally when an account email exists.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The signed-out nudge renders auth chrome irrelevant here; stub it.
vi.mock("@/components/auth/SignInButtonFor", () => ({
  SignInButtonFor: () => <button type="button">sign in</button>,
}));

import { NotifyToggle } from "./NotifyToggle";

describe("NotifyToggle — signed-in viewer with NO account email (server can't send)", () => {
  it("offers no notify checkbox and no custom email field — the server would drop the address", () => {
    render(
      <NotifyToggle signedIn viewerEmail={null} notifyOn={false} onNotifyChange={() => {}} auth="supabase" />,
    );
    // Old behavior: a checkbox, and (once checked) an email input the server silently ignored.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("explains WHY notification isn't available and how to fix it (add a GitHub email)", () => {
    render(
      <NotifyToggle signedIn viewerEmail={null} notifyOn={false} onNotifyChange={() => {}} auth="supabase" />,
    );
    expect(screen.getByText(/no email address/i)).toBeInTheDocument();
    expect(screen.getByText(/GitHub account/i)).toBeInTheDocument();
  });

  it("never renders a custom-address input even if notifyOn is somehow true (legacy state)", () => {
    render(<NotifyToggle signedIn viewerEmail={null} notifyOn onNotifyChange={() => {}} auth="supabase" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/email address for the report notification/i)).toBeNull();
  });
});

describe("NotifyToggle — signed-in viewer WITH an account email (the working path is unchanged)", () => {
  it("offers the checkbox and confirms the verified account address once checked", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NotifyToggle signedIn viewerEmail="dev@example.com" notifyOn={false} onNotifyChange={onChange} auth="supabase" />,
    );
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <NotifyToggle signedIn viewerEmail="dev@example.com" notifyOn onNotifyChange={onChange} auth="supabase" />,
    );
    expect(screen.getByText("dev@example.com")).toBeInTheDocument();
  });
});

describe("NotifyToggle — signed out", () => {
  it("renders the sign-in nudge when an auth backend exists, nothing otherwise", () => {
    const { unmount } = render(
      <NotifyToggle signedIn={false} notifyOn={false} onNotifyChange={() => {}} auth="supabase" />,
    );
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    unmount();

    const { container } = render(
      <NotifyToggle signedIn={false} notifyOn={false} onNotifyChange={() => {}} auth={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
