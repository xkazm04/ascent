// @vitest-environment jsdom
//
// The sweep in the DOM: present only when the library actually has a prune candidate, naming what each
// retirement costs BEFORE the ask, quoting the count in the confirm, reconciling that count against the
// server's answer, and offering one undo for the rest of the session.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SkillRetireSweep } from "./SkillRetireSweep";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillUsage, SkillUsageState } from "@/lib/org/skill-usage";

const skill = (id: string, o: Partial<SkillRow> = {}) =>
  ({ id, name: id, origin: "hosted", registryPath: null, ...o }) as SkillRow;

const usage = (id: string, state: SkillUsageState, o: Partial<SkillUsage> = {}): SkillUsage =>
  ({
    skillId: id,
    verdict: state === "new" || state === "active" ? state : "dormant",
    state,
    lastUsedAt: "2026-02-01T00:00:00.000Z",
    lastUsedType: "invoke",
    lastUsedSource: "cli",
    daysSinceUse: 44,
    useCount: 3,
    invokes: 3,
    eventCount: 3,
    anchorAt: "2026-01-01T00:00:00.000Z",
    ageDays: 90,
    windowDays: 30,
    ...o,
  }) as SkillUsage;

function library() {
  const states: [string, SkillUsageState][] = [
    ["a1", "abandoned"],
    ["a2", "abandoned"],
    ["a3", "abandoned"],
    ["u1", "unused"],
    ["u2", "unused"],
    ["m1", "unmeasured"],
    ["m2", "unmeasured"],
    ["m3", "unmeasured"],
    ["m4", "unmeasured"],
  ];
  const u: Record<string, SkillUsage> = {};
  for (const [id, s] of states) u[id] = usage(id, s);
  return { skills: states.map(([id]) => skill(id)), usage: u };
}

function mount(
  o: {
    skills?: SkillRow[];
    usage?: Record<string, SkillUsage>;
    adoption?: Record<string, SkillAdoption>;
    sweep?: ReturnType<typeof vi.fn>;
    isAdmin?: boolean;
  } = {},
) {
  const sweep = o.sweep ?? vi.fn().mockResolvedValue({ retired: 3, skipped: [] });
  const lib = library();
  render(
    <SkillRetireSweep
      skills={o.skills ?? lib.skills}
      usage={o.usage ?? lib.usage}
      adoption={o.adoption ?? {}}
      isAdmin={o.isAdmin ?? true}
      sweep={sweep}
    />,
  );
  return { sweep };
}

beforeEach(cleanup);

describe("SkillRetireSweep - scope", () => {
  it("lists exactly the abandoned ids and no other state", () => {
    mount();
    const rows = screen.getAllByTestId(/^retire-candidate-/);
    expect(rows.map((r) => r.getAttribute("data-skill"))).toEqual(["a1", "a2", "a3"]);
    for (const absent of ["u1", "u2", "m1", "m2", "m3", "m4"]) {
      expect(screen.queryByTestId(`retire-candidate-${absent}`)).toBeNull();
    }
  });

  it("states in one line that never-used and never-measured skills are not offered", () => {
    mount();
    const scope = screen.getByTestId("retire-scope");
    expect(scope.textContent).toMatch(/never used/i);
    expect(scope.textContent).toMatch(/never measured/i);
  });

  it("renders no panel at all when nothing is abandoned (no empty card)", () => {
    mount({ skills: [skill("u1")], usage: { u1: usage("u1", "unused") } });
    expect(screen.queryByTestId("skill-retire-sweep")).toBeNull();
  });

  it("renders nothing for a non-admin", () => {
    mount({ isAdmin: false });
    expect(screen.queryByTestId("skill-retire-sweep")).toBeNull();
  });
});

describe("SkillRetireSweep - blast radius before the ask", () => {
  it("shows the adopted repo count, the last use with days since, and the judged window", () => {
    mount({ adoption: { a1: { repos: 2, adoptedRepos: ["o/one", "o/two"] } } });
    const first = screen.getByTestId("retire-candidate-a1");
    expect(within(first).getByTestId("retire-blast").textContent).toBe("2 repos recorded this");
    expect(first.textContent).toContain("last used 2026-02-01, 44 days ago");
    expect(first.textContent).toContain("judged against 30 days of silence");
    const second = screen.getByTestId("retire-candidate-a2");
    expect(within(second).getByTestId("retire-blast").textContent).toBe("no repo recorded this");
  });

  it("lists a registry-origin candidate as not retirable, with its reason, and excludes it from the ask", async () => {
    const u = { a1: usage("a1", "abandoned"), r1: usage("r1", "abandoned") };
    mount({ skills: [skill("a1"), skill("r1", { origin: "registry" })], usage: u });
    const reg = screen.getByTestId("retire-candidate-r1");
    expect(within(reg).getByTestId("retire-refusal").textContent).toMatch(/registry/i);
    fireEvent.click(screen.getByTestId("retire-start"));
    expect(screen.getByTestId("retire-confirm").textContent).toBe("Retire 1 skill?");
  });
});

describe("SkillRetireSweep - confirm, accounting, undo", () => {
  it("quotes the count in the confirm and does not post until it is confirmed", async () => {
    const { sweep } = mount();
    fireEvent.click(screen.getByTestId("retire-start"));
    expect(screen.getByTestId("retire-confirm").textContent).toBe("Retire 3 skills?");
    expect(sweep).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("retire-cancel"));
    expect(screen.queryByTestId("retire-confirm")).toBeNull();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("posts the model's own candidate set, then reports the server's count", async () => {
    const sweep = vi.fn().mockResolvedValue({ retired: 3, skipped: [] });
    mount({ sweep });
    fireEvent.click(screen.getByTestId("retire-start"));
    fireEvent.click(screen.getByTestId("retire-go"));
    await waitFor(() => screen.getByTestId("retire-result"));
    expect(sweep).toHaveBeenCalledWith(["a1", "a2", "a3"], false);
    expect(screen.getByTestId("retire-result").textContent).toBe("Retired 3 skills.");
  });

  it("shows the DIFFERENCE, not the optimistic number, when the server retired fewer", async () => {
    const sweep = vi.fn().mockResolvedValue({ retired: 2, skipped: [{ id: "a3", reason: "registry-origin" }] });
    mount({ sweep });
    fireEvent.click(screen.getByTestId("retire-start"));
    fireEvent.click(screen.getByTestId("retire-go"));
    await waitFor(() => screen.getByTestId("retire-result"));
    const result = screen.getByTestId("retire-result").textContent ?? "";
    expect(result).toContain("2 of 3");
    expect(result).not.toBe("Retired 3 skills.");
    expect(screen.getByTestId("retire-skipped").textContent).toContain("a3");
  });

  it("offers one undo after the sweep and restores through the same door", async () => {
    const sweep = vi.fn().mockResolvedValue({ retired: 3, skipped: [] });
    mount({ sweep });
    fireEvent.click(screen.getByTestId("retire-start"));
    fireEvent.click(screen.getByTestId("retire-go"));
    await waitFor(() => screen.getByTestId("retire-result"));
    fireEvent.click(screen.getByTestId("retire-undo"));
    await waitFor(() => expect(screen.getByTestId("retire-result").textContent).toMatch(/restored/i));
    expect(sweep).toHaveBeenLastCalledWith(["a1", "a2", "a3"], true);
    expect(screen.getByTestId("retire-result").textContent).toMatch(/restored/i);
  });

  it("surfaces a failed sweep instead of claiming a retirement", async () => {
    const sweep = vi.fn().mockResolvedValue(null);
    mount({ sweep });
    fireEvent.click(screen.getByTestId("retire-start"));
    fireEvent.click(screen.getByTestId("retire-go"));
    await waitFor(() => screen.getByTestId("retire-result"));
    expect(screen.getByTestId("retire-result").textContent).toMatch(/could not/i);
  });
});
