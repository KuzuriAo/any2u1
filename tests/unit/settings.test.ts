// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { convertOptions, defaultSettings, describePrinter, isQuiet, parseSettings } from "../../src/core/settings";

describe("parseSettings", () => {
  it("defaults to on, with the small window", () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings());
    expect(defaultSettings()).toMatchObject({ enabled: true, offerStyle: "window" });
  });
  it.each([null, 7, "x", [], { enabled: "yes", offerStyle: "<img>", quietSites: "all", convert: 3 }])("falls back on %j", (stored) => {
    expect(parseSettings(stored)).toEqual(defaultSettings());
  });
  it("keeps what's valid and drops what isn't", () => {
    const parsed = parseSettings({
      enabled: false,
      offerStyle: "badge",
      quietSites: ["a.example", "a.example", 4, "", "x".repeat(300)],
      convert: { snapmakerOrcaVersion: "../../x", highFlowToolheads: [true, false], hardenedNozzles: 1, filamentNames: "other" },
    });
    expect(parsed).toEqual({ ...defaultSettings(), enabled: false, offerStyle: "badge", quietSites: ["a.example"] });
  });
  it("keeps a well-formed choice", () => {
    const convert = { snapmakerOrcaVersion: "2.4.0", highFlowToolheads: [true, false, false, true], hardenedNozzles: true, filamentNames: "snapmaker" };
    expect(parseSettings({ convert }).convert).toEqual(convert);
  });
  it("bounds the list of sites, keeping the newest", () => {
    const quietSites = Array.from({ length: 2000 }, (_, index) => `s${index}.example`);
    const kept = parseSettings({ quietSites }).quietSites;
    expect(kept.length).toBe(500);
    expect(kept.at(-1)).toBe("s1999.example");
  });
  it("is a fixed point, so what's stored after a change is what's read back", () => {
    const parsed = parseSettings({ quietSites: ["a.example", "a.example", "b.example"], offerStyle: "badge", askWhereToSave: true });
    expect(parseSettings(parsed)).toEqual(parsed);
  });
  it("asks where to save only when that was chosen, as a plain true", () => {
    expect(defaultSettings().askWhereToSave).toBe(false);
    expect(parseSettings({ askWhereToSave: true }).askWhereToSave).toBe(true);
    for (const stored of [false, "true", 1, {}, null]) expect(parseSettings({ askWhereToSave: stored }).askWhereToSave).toBe(false);
  });
});

describe("the Snapmaker Orca version", () => {
  it("is null (Newest) or an exact release number, and anything else falls back to Newest", () => {
    expect(parseSettings({ convert: {} }).convert.snapmakerOrcaVersion).toBeNull();
    expect(parseSettings({ convert: { snapmakerOrcaVersion: null } }).convert.snapmakerOrcaVersion).toBeNull();
    expect(parseSettings({ convert: { snapmakerOrcaVersion: "2.4.1" } }).convert.snapmakerOrcaVersion).toBe("2.4.1");
    for (const stored of ["newest", "", "2", "2.4.1 ", "v2.4.1", 2.4, true, ["2.4.1"], { version: "2.4.1" }]) {
      expect(parseSettings({ convert: { snapmakerOrcaVersion: stored } }).convert.snapmakerOrcaVersion).toBeNull();
    }
  });
  it("sends the exact newest when it was chosen by number, and nothing for Newest", () => {
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "2.4.2" }, ["2.4.2", "2.4.1"]).snapmakerOrcaVersion).toBe("2.4.2");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "2.4.1" }, ["2.4.2", "2.4.1"]).snapmakerOrcaVersion).toBe("2.4.1");
    expect(convertOptions(defaultSettings().convert, ["2.4.2", "2.4.1"])).not.toHaveProperty("snapmakerOrcaVersion");
  });
});

describe("convertOptions", () => {
  const releases = ["2.4.1", "2.4.0"];
  it("asks for nothing extra by default", () => {
    expect(convertOptions(defaultSettings().convert, releases)).toEqual({ highFlowHotends: false, hardenedNozzles: false });
  });
  it("passes each choice on", () => {
    expect(
      convertOptions({ snapmakerOrcaVersion: "2.4.0", highFlowToolheads: [true, false, false, false], hardenedNozzles: true, filamentNames: "generic" }, releases),
    ).toEqual({ snapmakerOrcaVersion: "2.4.0", highFlowHotends: [true, false, false, false], hardenedNozzles: true, filamentComplianceMode: "generic" });
  });
  it("sends the next release up when a saved one is gone, so the result names what was used", () => {
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "1.0.0" }, releases).snapmakerOrcaVersion).toBe("2.4.0");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "9.0.0" }, releases).snapmakerOrcaVersion).toBe("2.4.1");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "1.0.0" }, [])).not.toHaveProperty("snapmakerOrcaVersion");
  });
});

describe("isQuiet", () => {
  it("matches exact hosts only", () => {
    expect(isQuiet(["site.example"], ["site.example"])).toBe(true);
    expect(isQuiet(["cdn.example", "site.example"], ["site.example"])).toBe(true);
    expect(isQuiet(["other.store.example"], ["bucket.store.example"])).toBe(false);
    expect(isQuiet([], ["site.example"])).toBe(false);
  });
});

describe("high-flow only where the nozzle supports it", () => {
  const convert = { ...defaultSettings().convert, highFlowToolheads: [true, false, true, false] as [boolean, boolean, boolean, boolean], hardenedNozzles: true };
  it("is sent when the nozzle supports it, and left out when it doesn't", () => {
    expect(convertOptions(convert, ["2.4.1"], true).highFlowHotends).toEqual([true, false, true, false]);
    expect(convertOptions(convert, ["2.4.1"], false).highFlowHotends).toBe(false);
    expect(convertOptions(convert, ["2.4.1"]).highFlowHotends).toEqual([true, false, true, false]);
  });
  it("is described only where it applied", () => {
    expect(describePrinter(convert, "0.4", true)).toEqual(["high-flow on T1, T3", "hardened steel nozzles"]);
    expect(describePrinter(convert, "0.6", false)).toEqual([]);
    expect(describePrinter(convert, null, true)).toEqual(["high-flow on T1, T3", "hardened steel nozzles"]);
    expect(describePrinter(defaultSettings().convert, "0.4", true)).toEqual([]);
  });
});
