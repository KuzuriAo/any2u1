// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_NOZZLE, NOZZLE_CHOICES } from "any2orca";
import { describe, expect, it } from "vitest";
import { convertOptions, DEFAULT_NOZZLE_SIZE, defaultSettings, describePrinter, isQuiet, NOZZLE_HELP, NOZZLE_SIZES, nozzleFor, parseSettings } from "../../src/core/settings";

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
      convert: { snapmakerOrcaVersion: "../../x", nozzle: "0.5", highFlowToolheads: [true, false], hardenedNozzles: 1, filamentNames: "other" },
    });
    expect(parsed).toEqual({ ...defaultSettings(), enabled: false, offerStyle: "badge", quietSites: ["a.example"] });
  });
  it("keeps a well-formed choice", () => {
    const convert = { snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", highFlowToolheads: [true, false, false, true], hardenedNozzles: true, filamentNames: "snapmaker" };
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

describe("the nozzle size", () => {
  it("offers the library's choices, with its default", () => {
    expect(NOZZLE_SIZES).toEqual(NOZZLE_CHOICES);
    expect(DEFAULT_NOZZLE_SIZE).toBe(DEFAULT_NOZZLE);
  });
  it("is 0.4 mm by default", () => {
    expect(defaultSettings().convert.nozzle).toBe("0.4");
    expect(parseSettings({ convert: {} }).convert.nozzle).toBe("0.4");
  });
  it("keeps each size and Match the file, through a store and read back", () => {
    for (const nozzle of NOZZLE_SIZES) {
      const parsed = parseSettings({ convert: { nozzle } });
      expect(parsed.convert.nozzle).toBe(nozzle);
      expect(parseSettings(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });
  it("falls back to 0.4 mm on anything else stored", () => {
    for (const stored of ["0.5", "0.40", " 0.4", "0.4 mm", "Match", "MATCH", "", "1.0", "../0.6", 0.6, 0.4, true, null, ["0.6"], { size: "0.6" }]) {
      expect(parseSettings({ convert: { nozzle: stored } }).convert.nozzle).toBe("0.4");
    }
  });
  it("has one sentence of help, saying what it changes", () => {
    expect(NOZZLE_HELP).toBe(
      "The converted file is made for this nozzle size. The U1's stock nozzles are 0.4 mm, and Snapmaker Orca uses one size for all four toolheads. A project made for another size is converted anyway and you're told; 'Match the file' converts for the size the creator used.",
    );
  });
  it("is the size a file is made for, or with Match the file the creator's, and 0.4 where the file gives none", () => {
    expect(nozzleFor("0.6", "0.4")).toBe("0.6");
    expect(nozzleFor("0.4", null)).toBe("0.4");
    expect(nozzleFor("match", "0.6")).toBe("0.6");
    expect(nozzleFor("match", null)).toBe("0.4");
  });
});

describe("convertOptions", () => {
  const releases = ["2.4.1", "2.4.0"];
  it("asks for nothing extra by default, and for 0.4 mm nozzles", () => {
    expect(convertOptions(defaultSettings().convert, releases)).toEqual({ nozzle: "0.4", highFlowHotends: false, hardenedNozzles: false });
  });
  it("passes each choice on", () => {
    expect(
      convertOptions({ snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", highFlowToolheads: [true, false, false, false], hardenedNozzles: true, filamentNames: "generic" }, releases),
    ).toEqual({ snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", highFlowHotends: [true, false, false, false], hardenedNozzles: true, filamentComplianceMode: "generic" });
    expect(convertOptions({ ...defaultSettings().convert, nozzle: "match" }, releases).nozzle).toBe("match");
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

describe("high-flow only where the size the file is made for supports it", () => {
  const convert = { ...defaultSettings().convert, highFlowToolheads: [true, false, true, false] as [boolean, boolean, boolean, boolean], hardenedNozzles: true };
  it("is sent when the nozzle supports it, and left out when it doesn't", () => {
    expect(convertOptions(convert, ["2.4.1"], true).highFlowHotends).toEqual([true, false, true, false]);
    expect(convertOptions(convert, ["2.4.1"], false).highFlowHotends).toBe(false);
    expect(convertOptions(convert, ["2.4.1"]).highFlowHotends).toEqual([true, false, true, false]);
  });
  it("is described only where it applied", () => {
    expect(describePrinter(convert, "0.4", true)).toEqual(["high-flow on T1, T3", "hardened steel nozzles"]);
    expect(describePrinter(convert, "0.6", false)).toEqual([]);
    expect(describePrinter(convert, "0.2", false)).toEqual([]);
    expect(describePrinter(defaultSettings().convert, "0.4", true)).toEqual([]);
  });
});
