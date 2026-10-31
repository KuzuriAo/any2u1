// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { convertOptions, defaultSettings, isQuiet, parseSettings } from "../../src/core/settings";

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
  it("bounds the list of sites", () => {
    const quietSites = Array.from({ length: 2000 }, (_, index) => `s${index}.example`);
    expect(parseSettings({ quietSites }).quietSites.length).toBe(500);
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
  it("falls back to the newest when a saved release is gone", () => {
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "1.0.0" }, releases)).not.toHaveProperty("snapmakerOrcaVersion");
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
