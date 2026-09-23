// Fleet pointing is derived from the header rows the conformance sweep already writes: a repo points
// here when its manifest's `registry.remote` names this registry. What is defended: never swept is
// ABSENT (not 0), a repo pointing at another registry is a different state from one with no pointer,
// and "synced 30d" needs a real map regenerated inside the window.

import { describe, expect, it } from "vitest";
import { fleetPointing, type FleetMapRow } from "./fleet-pointing";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const row = (over: Partial<FleetMapRow> & { repoFullName: string }): FleetMapRow => ({
  mapSha: "sha",
  generatedAt: daysAgo(1),
  hasManifest: true,
  registryRemote: null,
  ...over,
});

const A = row({ repoFullName: "acme/web", registryRemote: "Acme/AI-Registry", mapSha: "s1", generatedAt: daysAgo(5) });
const B = row({ repoFullName: "acme/api", registryRemote: "other/registry", mapSha: "s2" });
const C = row({ repoFullName: "acme/cli", hasManifest: false, registryRemote: null, mapSha: null });

const byName = (roster: { repoFullName: string }[]) => Object.fromEntries(roster.map((r) => [r.repoFullName, r]));

describe("fleetPointing", () => {
  it("counts pointing case-insensitively, names every swept repo's state, and the unswept remainder", () => {
    const r = fleetPointing({ maps: [A, B, C], registryFullName: "acme/ai-registry", reposTotal: 5, now: NOW });
    expect(r.reposPointing).toBe(1);
    expect(r.reposSynced30d).toBe(1);
    expect(r.unswept).toBe(2);
    const by = byName(r.roster ?? []);
    expect(by["acme/web"]).toEqual({ repoFullName: "acme/web", state: "pointing" });
    expect(by["acme/api"]).toEqual({ repoFullName: "acme/api", state: "elsewhere", remote: "other/registry" });
    expect(by["acme/cli"]).toEqual({ repoFullName: "acme/cli", state: "no-manifest" });
  });

  it("a pointing repo with a 45-day-old map, or no map at all, points but has not synced in 30d", () => {
    const old = row({ repoFullName: "acme/old", registryRemote: "acme/ai-registry", generatedAt: daysAgo(45) });
    const mapless = row({ repoFullName: "acme/bare", registryRemote: "acme/ai-registry", mapSha: null, generatedAt: daysAgo(0) });
    const r = fleetPointing({ maps: [old, mapless], registryFullName: "acme/ai-registry", reposTotal: 2, now: NOW });
    expect(r.reposPointing).toBe(2);
    expect(r.reposSynced30d).toBe(0);
  });

  it("an org that was never swept stays unmeasured: no pointing or synced keys at all", () => {
    const r = fleetPointing({ maps: [], registryFullName: "acme/ai-registry", reposTotal: 5, now: NOW });
    expect("reposPointing" in r).toBe(false);
    expect("reposSynced30d" in r).toBe(false);
  });

  it("a manifest read with no pointer is 'no-pointer' and a measured 0, not a hatch", () => {
    const r = fleetPointing({
      maps: [row({ repoFullName: "acme/x", registryRemote: "" })],
      registryFullName: "acme/ai-registry",
      reposTotal: 1,
      now: NOW,
    });
    expect(r.reposPointing).toBe(0);
    expect(r.roster).toEqual([{ repoFullName: "acme/x", state: "no-pointer" }]);
  });

  it("a row swept before the pointer was read (manifest present, pointer null) is unread, not 'no pointer'", () => {
    const legacy = row({ repoFullName: "acme/legacy", registryRemote: null });
    const only = fleetPointing({ maps: [legacy], registryFullName: "acme/ai-registry", reposTotal: 3, now: NOW });
    expect("reposPointing" in only).toBe(false);
    const mixed = fleetPointing({ maps: [legacy, A], registryFullName: "acme/ai-registry", reposTotal: 3, now: NOW });
    expect(mixed.reposPointing).toBe(1);
    expect(mixed.unswept).toBe(2);
    expect(byName(mixed.roster ?? [])["acme/legacy"]).toBeUndefined();
  });

  it("the registry repo itself counts as pointing: it cannot carry a pointer to itself", () => {
    const self = row({ repoFullName: "acme/ai-registry", registryRemote: "", mapSha: null });
    const r = fleetPointing({ maps: [self], registryFullName: "acme/ai-registry", reposTotal: 1, now: NOW });
    expect(r.reposPointing).toBe(1);
    expect(r.roster).toEqual([{ repoFullName: "acme/ai-registry", state: "pointing" }]);
  });

  it("lists the repos that need work first, then the pointing ones, each group by name", () => {
    const r = fleetPointing({ maps: [A, C, B], registryFullName: "acme/ai-registry", reposTotal: 3, now: NOW });
    expect((r.roster ?? []).map((e) => e.repoFullName)).toEqual(["acme/api", "acme/cli", "acme/web"]);
  });
});
