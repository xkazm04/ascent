// @vitest-environment jsdom
//
// The Custom tier's CTA is the only price card that opens a dialog instead of navigating, so the whole
// conversion path lives in client state that SSR can't show: open → fill → submit → receipt. These pin
// the three things that would silently break it — the dialog actually opens, client validation refuses
// a submission the SERVER would have refused (so no round-trip and no lost typing), and a success
// swaps the form for a receipt naming the address we'll reply to.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanEnquiryCta } from "./PlanEnquiryCta";
import { ENQUIRY_AREAS } from "@/lib/plan-enquiry";

afterEach(() => vi.restoreAllMocks());

const CTA = /tell us what you need/i;

function openDialog() {
  render(<PlanEnquiryCta className="cta" />);
  fireEvent.click(screen.getByRole("button", { name: CTA }));
}

function fillValid() {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Dana Reyes" } });
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "dana@acme.dev" } });
  fireEvent.change(screen.getByLabelText("What do you need?"), {
    target: { value: "Inference has to stay in our VPC and we need SAML for 40 engineers." },
  });
}

describe("PlanEnquiryCta", () => {
  it("opens a dialog offering exactly the areas the price card advertises", () => {
    openDialog();
    expect(screen.getByRole("dialog", { name: /custom plan/i })).toBeInTheDocument();
    for (const area of ENQUIRY_AREAS) {
      expect(screen.getByRole("checkbox", { name: new RegExp(area.label) })).toBeInTheDocument();
    }
  });

  it("refuses an incomplete submission client-side, without a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /send requirement/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    // The failing field is named, not just "something's wrong" — the same message the route would return.
    expect(screen.getByRole("alert")).toHaveTextContent(/who you are/i);
  });

  it("posts the validated enquiry and swaps the form for a receipt naming the reply address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    openDialog();
    fillValid();
    fireEvent.click(screen.getByRole("checkbox", { name: /Hosting/ }));
    fireEvent.click(screen.getByRole("button", { name: /send requirement/i }));

    await waitFor(() => expect(screen.getByText(/we've got it/i)).toBeInTheDocument());
    expect(screen.getByText("dana@acme.dev")).toBeInTheDocument();
    // The form is gone — a receipt that still showed an editable form would invite a double send.
    expect(screen.queryByLabelText("Work email")).toBeNull();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: "Dana Reyes", email: "dana@acme.dev", areas: ["hosting"] });
    expect(body.website).toBe(""); // the honeypot rides along empty
  });

  it("keeps the typed draft and surfaces the server's message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "We couldn't record it." }) }),
    );
    openDialog();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /send requirement/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We couldn't record it."));
    // Still editable, still holding what they typed — a failed send must not cost them the message.
    expect(screen.getByLabelText("Work email")).toHaveValue("dana@acme.dev");
  });
});
