// normalizePlanEnquiry is the ONE validator both the modal and POST /api/plan-enquiry run, so these
// pin the contract that makes that sharing safe: the same input must be accepted (or rejected, with the
// same field named) on either side. A rule that only the client enforces is a spam hole; a rule only the
// server enforces is a form that fails after the user has already typed everything.

import { describe, it, expect } from "vitest";
import { ENQUIRY_AREAS, ENQUIRY_LIMITS, normalizePlanEnquiry, areaLabel, fleetSizeLabel } from "./plan-enquiry";

const valid = {
  name: "Dana Reyes",
  email: "dana@acme.dev",
  company: "Acme",
  fleetSize: "51-200",
  areas: ["sso", "hosting"],
  message: "We need inference inside our own VPC and SAML sign-in for 40 engineers.",
};

describe("normalizePlanEnquiry — required fields", () => {
  it("accepts a complete enquiry", () => {
    const r = normalizePlanEnquiry(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ name: "Dana Reyes", email: "dana@acme.dev", fleetSize: "51-200" });
  });

  it("names the FIRST failing field so the dialog can focus it", () => {
    expect(normalizePlanEnquiry({ ...valid, name: " " })).toMatchObject({ ok: false, field: "name" });
    expect(normalizePlanEnquiry({ ...valid, email: "dana@acme" })).toMatchObject({ ok: false, field: "email" });
    expect(normalizePlanEnquiry({ ...valid, message: "hi" })).toMatchObject({ ok: false, field: "message" });
  });

  it("rejects a missing body entirely rather than storing a blank lead", () => {
    expect(normalizePlanEnquiry(undefined)).toMatchObject({ ok: false, field: "name" });
    expect(normalizePlanEnquiry({})).toMatchObject({ ok: false, field: "name" });
  });

  it("trims before measuring, so whitespace can't satisfy a minimum", () => {
    expect(normalizePlanEnquiry({ ...valid, message: "          " })).toMatchObject({ ok: false, field: "message" });
  });
});

describe("normalizePlanEnquiry — the areas checklist", () => {
  it("keeps only known ids, dedupes, and returns them in catalog order", () => {
    const r = normalizePlanEnquiry({ ...valid, areas: ["sso", "bogus", "hosting", "sso", 7] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.areas).toEqual(["hosting", "sso"]);
  });

  it("treats a missing / non-array areas field as 'none selected', not an error", () => {
    for (const areas of [undefined, null, "sso", 3]) {
      const r = normalizePlanEnquiry({ ...valid, areas });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.areas).toEqual([]);
    }
  });

  it("accepts every advertised area — the form's checkboxes are built from the same list", () => {
    const r = normalizePlanEnquiry({ ...valid, areas: ENQUIRY_AREAS.map((a) => a.id) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.areas).toHaveLength(ENQUIRY_AREAS.length);
  });
});

describe("normalizePlanEnquiry — optional fields degrade instead of failing", () => {
  it("drops an unknown fleet size to '' rather than rejecting the whole enquiry", () => {
    const r = normalizePlanEnquiry({ ...valid, fleetSize: "10000 repos" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.fleetSize).toBe("");
  });

  it("truncates an over-long company / message instead of erroring on a paste", () => {
    const r = normalizePlanEnquiry({ ...valid, company: "x".repeat(500), message: "y".repeat(9000) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.company).toHaveLength(ENQUIRY_LIMITS.company.max);
      expect(r.value.message).toHaveLength(ENQUIRY_LIMITS.message.max);
    }
  });

  it("ignores anything else in the body — a client can't smuggle an extra field into the row", () => {
    const r = normalizePlanEnquiry({ ...valid, viewerLogin: "attacker", plan: "team", emailStatus: "sent" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value).sort()).toEqual(["areas", "company", "email", "fleetSize", "message", "name"]);
  });
});

describe("labels", () => {
  it("resolves known ids and passes unknown ones through (an old row never renders blank)", () => {
    expect(areaLabel("sso")).toBe("SSO & directory");
    expect(areaLabel("legacy-thing")).toBe("legacy-thing");
    expect(fleetSizeLabel("51-200")).toBe("51–200 repositories");
    expect(fleetSizeLabel("")).toBe("");
  });
});
