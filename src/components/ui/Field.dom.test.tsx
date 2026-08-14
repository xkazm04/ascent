// @vitest-environment jsdom
//
// The form kit's two load-bearing accessibility claims, pinned so a restyle can't quietly drop them:
// the label is really associated with its control (the kit deliberately relies on IMPLICIT association
// — the control wrapped by its `<label>` — instead of id plumbing, and "looks like a label" is not the
// same as "is one"), and CheckCard's sr-only input keeps real checkbox semantics while a drawn `<span>`
// carries the visuals. A card that only LOOKED checked would be unusable by keyboard and invisible to AT.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckCard, Field, TextInput } from "./Field";

describe("Field", () => {
  it("associates its label with the control it wraps", () => {
    render(
      <Field label="Work email">
        <TextInput defaultValue="" />
      </Field>,
    );
    // getByLabelText resolves through the implicit association — it fails if the wrapper stops being
    // a <label>, or if the control moves outside it.
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });

  // Read at different moments: the hint before you type (so it precedes the control — under a group of
  // checkboxes an instruction arrives after you've already answered), the error after you act.
  it("puts the hint above the control and the error below it", () => {
    const { container } = render(
      <Field label="Company" hint="Optional" error="Required">
        <TextInput />
      </Field>,
    );
    const order = [...container.querySelectorAll("legend, span, p, input")].filter((el) =>
      ["Optional", "Required"].includes(el.textContent ?? "") || el.tagName === "INPUT",
    );
    expect(order.map((el) => el.textContent || el.tagName)).toEqual(["Optional", "INPUT", "Required"]);
  });

  // One error, one announcement: the caller's summary (e.g. a modal footer) is the live region, so the
  // per-field marker must not be a second one.
  it("does not make the field error a live region", () => {
    render(
      <Field label="Company" error="Required">
        <TextInput />
      </Field>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names a control GROUP through a real fieldset/legend", () => {
    render(
      <Field as="fieldset" label="What should we scope?">
        <CheckCard checked={false} onChange={() => {}} label="Hosting" />
      </Field>,
    );
    expect(screen.getByRole("group", { name: "What should we scope?" })).toBeInTheDocument();
  });
});

describe("CheckCard", () => {
  it("is a real checkbox with an accessible name, not a styled div", () => {
    render(<CheckCard checked={false} onChange={() => {}} label="SSO & directory" hint="SAML/OIDC" />);
    const box = screen.getByRole("checkbox", { name: /SSO & directory/ });
    expect(box).not.toBeChecked();
  });

  it("reports its checked state to AT (the drawn tick is aria-hidden decoration)", () => {
    render(<CheckCard checked onChange={() => {}} label="Hosting" />);
    expect(screen.getByRole("checkbox", { name: "Hosting" })).toBeChecked();
  });

  it("fires onChange when the card is activated", () => {
    const onChange = vi.fn();
    render(<CheckCard checked={false} onChange={onChange} label="Support & SLA" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Support & SLA" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Asserted on the ATTRIBUTE, not by firing a click: `fireEvent.click` dispatches the event directly
  // and does not model a browser's activation behavior, so it fires onChange even on a disabled input.
  // `disabled` is what actually stops a real click (and the label click that would forward to it), so
  // that is the contract worth pinning — a click-based assertion here would only test the test library.
  it("is disabled while a submit is in flight", () => {
    render(<CheckCard checked={false} onChange={() => {}} label="Hosting" disabled />);
    expect(screen.getByRole("checkbox", { name: "Hosting" })).toBeDisabled();
  });
});
