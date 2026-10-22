// @vitest-environment jsdom
//
// The share panel as the developer meets it: paste, preview, commit, and delete behind a confirm.
// A preview fixture (`view.demo`) can be pasted against but never pushed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { CareShareUpload } from "./CareShareUpload";
import { DeveloperCompanion } from "./DeveloperCompanion";
import { emptyDeveloperView, type DeveloperView } from "@/lib/org/developer-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const SHARE = JSON.stringify({
  contract: 1,
  shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { planModePct: 40 } },
});

function stored(over: Partial<DeveloperView> = {}): DeveloperView {
  const v = emptyDeveloperView("ada");
  v.setup = { ...v.setup, mentorInstalled: true, lastShareAt: "2026-10-20T00:00:00.000Z" };
  return { ...v, ...over };
}

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const button = (c: HTMLElement, name: RegExp) =>
  [...c.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CareShareUpload", () => {
  it("shows the consent choice OFF by default, and the preview of what leaves", () => {
    const { container, getByLabelText } = render(<CareShareUpload view={stored()} />);
    const consent = getByLabelText(/anonymous org bands/i) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.change(getByLabelText(/share json/i), { target: { value: SHARE } });
    expect(container.textContent).toContain("Plan mode");
    expect(button(container, /^Commit/)?.disabled).toBe(false);
  });

  it("refuses in the browser before anything leaves, naming the path", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, getByLabelText } = render(<CareShareUpload view={stored()} />);
    fireEvent.change(getByLabelText(/share json/i), { target: { value: JSON.stringify({ contract: 1, journal: [{ prompt: "x" }] }) } });
    expect(container.textContent).toContain("never-sent field: journal[0].prompt");
    expect(button(container, /^Commit/)?.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("commits through the share route and refreshes the page", async () => {
    const fetchMock = respond(200, { ok: true, sharedAt: "2026-10-22T00:00:00.000Z" });
    vi.stubGlobal("fetch", fetchMock);
    const { container, getByLabelText } = render(<CareShareUpload view={stored()} />);
    fireEvent.change(getByLabelText(/share json/i), { target: { value: SHARE } });
    await act(async () => void fireEvent.click(button(container, /^Commit/)!));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(SHARE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Shared.");
  });

  it("asks before deleting: the first click sends nothing", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CareShareUpload view={stored()} />);
    fireEvent.click(button(container, /^Delete my share/)!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete your stored share?");
    await act(async () => void fireEvent.click(button(container, /^Delete it/)!));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("names a delete with nothing stored as nothing-stored", async () => {
    vi.stubGlobal("fetch", respond(404, { error: "No share is stored for you." }));
    const { container } = render(<CareShareUpload view={stored()} />);
    fireEvent.click(button(container, /^Delete my share/)!);
    await act(async () => void fireEvent.click(button(container, /^Delete it/)!));
    expect(container.textContent).toContain("Nothing was stored for you");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables commit and delete on a preview fixture and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, getByLabelText } = render(<CareShareUpload view={stored({ demo: "steady" })} />);
    fireEvent.change(getByLabelText(/share json/i), { target: { value: SHARE } });
    const commit = button(container, /^Commit/)!;
    const del = button(container, /^Delete my share/)!;
    expect(commit.disabled).toBe(true);
    expect(del.disabled).toBe(true);
    fireEvent.click(commit);
    fireEvent.click(del);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The shared MatrixGrid kit captions its accessible table itself; that string is the kit's, not
  // this panel's, so the ban reads the panel with the kit caption removed.
  const ownText = (c: HTMLElement) => {
    const copy = c.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("caption").forEach((n) => n.remove());
    return copy.textContent ?? "";
  };

  it("opens from the Setup card's Share again button, which used to only log its intent", () => {
    const { container } = render(<DeveloperCompanion view={stored()} slug="acme" />);
    expect(container.textContent).not.toContain("Bring your share in");
    fireEvent.click(button(container, /^Share again/)!);
    expect(container.textContent).toContain("Bring your share in");
  });

  it("writes no em dash in any state it renders", () => {
    const { container, getByLabelText } = render(<CareShareUpload view={stored({ demo: "steady" })} />);
    expect(ownText(container)).not.toContain("\u2014");
    const box = getByLabelText(/share json/i);
    for (const value of ["{bad", JSON.stringify({ contract: 1, moves: [{ diff: "x" }] }), SHARE]) {
      fireEvent.change(box, { target: { value } });
      expect(ownText(container)).not.toContain("\u2014");
    }
    expect(ownText(container)).toContain("What leaves");
  });
});
